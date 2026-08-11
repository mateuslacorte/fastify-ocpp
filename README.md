# fastify-ocpp

Fastify WebSocket **CSMS** for **OCPP-J 1.6**, **2.0.1**, and **2.1**.

All versions share one path. The Charge Point offers subprotocols in `Sec-WebSocket-Protocol`; the server picks the highest-preference match from your configured `versions` list.

Official OCA JSON schemas ship under [`schemas/`](schemas/).

## Endpoint

```text
ws://<host>/ocpp/:chargePointId
```

| Client offers | Negotiated version |
|---------------|--------------------|
| `ocpp1.6` | OCPP 1.6 |
| `ocpp2.0.1` | OCPP 2.0.1 |
| `ocpp2.1` | OCPP 2.1 |

Default preference: **`2.1` > `2.0.1` > `1.6`** (newest first).  
If the client offers several, the first entry in `versions` that appears in the offer wins.  
If nothing matches, the WebSocket upgrade is rejected.

```text
# Same URL for every station — version comes from the subprotocol header
ws://localhost:9000/ocpp/CP_001
  Sec-WebSocket-Protocol: ocpp1.6

ws://localhost:9000/ocpp/CS_001
  Sec-WebSocket-Protocol: ocpp2.0.1

ws://localhost:9000/ocpp/CS_002
  Sec-WebSocket-Protocol: ocpp2.1, ocpp2.0.1, ocpp1.6
  → selects ocpp2.1
```

## Install

```bash
npm install fastify-ocpp fastify
```

Requires Node.js 18+.

## Quick start

```ts
import Fastify from 'fastify';
import { fastifyOcpp } from 'fastify-ocpp';

const app = Fastify({ logger: true });

await app.register(fastifyOcpp, {
  // Allow-list + preference order (first offered match wins)
  versions: ['2.1', '2.0.1', '1.6'],
  path: '/ocpp',
});

app.ocpp.onAction('BootNotification', async (payload, ctx) => {
  // ctx.version is the negotiated OCPP version for this socket
  if (ctx.version === '1.6') {
    return {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  }
  return {
    status: 'Accepted',
    currentTime: new Date().toISOString(),
    interval: 300,
  };
});

app.ocpp.onAction('Heartbeat', async () => ({
  currentTime: new Date().toISOString(),
}));

await app.listen({ port: 9000, host: '0.0.0.0' });
```

## Configuration

```ts
// Accept only 1.6
await app.register(fastifyOcpp, { versions: ['1.6'] });

// Prefer 2.0.1 over 2.1 when both are offered; custom path
await app.register(fastifyOcpp, {
  versions: ['2.0.1', '2.1'],
  path: '/csms',
});

// Single-version helper (same shared path, one allowed subprotocol)
import { registerOcppVersion } from 'fastify-ocpp';
await registerOcppVersion(app, '2.1', { path: '/ocpp' });
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `versions` | `['2.1','2.0.1','1.6']` | Allowed protocols **and** negotiation preference order |
| `path` | `/ocpp` | Shared path prefix (`/:chargePointId` is appended) |
| `validateIncoming` | `true` | Validate inbound CALL / CALLRESULT against OCA schemas |
| `validateOutgoing` | `true` | Validate outbound CALL / CALLRESULT |
| `callTimeoutMs` | `30000` | Timeout for CSMS → Charge Point CALLs |
| `rejectDuplicateConnections` | `true` | Reject a second socket for the same `chargePointId` |
| `getPassword` | — | HTTP Basic (profiles 1 / 2). Return the station PSK, or `undefined` to reject |
| `basicAuthRealm` | `OCPP` | Realm sent in `WWW-Authenticate` on 401 |
| `schemasDir` | package `schemas/` | Override schema root |
| `onConnect` / `onDisconnect` | — | Lifecycle hooks |

## Authentication (profiles 1 / 2)

OCPP security **profile 1** (Basic) and **profile 2** (TLS + Basic) use the same handshake check. Profile 2 is just this auth over `wss://` (terminate TLS in Fastify or a reverse proxy).

When `getPassword` is set:

1. The Charge Point connects to `wss://csms.example/ocpp/{chargePointId}`.
2. It sends **HTTP Basic** on the upgrade request.
3. Username **must** equal `{chargePointId}` in the URL.
4. Password is a **pre-shared key you provisioned on that station** (not a user password).
5. The CSMS rejects the handshake with **`401 Unauthorized`** if user/password mismatch — **before** `101 Switching Protocols`.

```ts
const stationKeys = new Map([
  ['CP_001', 'shared-secret'],
]);

await app.register(fastifyOcpp, {
  versions: ['2.1', '2.0.1', '1.6'],
  path: '/ocpp',
  getPassword: (chargePointId) => stationKeys.get(chargePointId),
});
```

Example from a charger / wscat:

```http
GET /ocpp/CP_001 HTTP/1.1
Host: csms.example
Authorization: Basic <base64(CP_001:shared-secret)>
Sec-WebSocket-Protocol: ocpp2.0.1
Upgrade: websocket
```

```bash
wscat -c 'wss://csms.example/ocpp/CP_001' \
  -s ocpp2.0.1 \
  -H "Authorization: Basic $(printf 'CP_001:shared-secret' | base64)"
```

Omit `getPassword` for security profile 0 (no authentication).

## Handlers & outbound calls

```ts
// All enabled versions
app.ocpp.onAction('DataTransfer', handler);

// One version only
app.ocpp.onAction('Authorize', handler, '1.6');

// Fallback when no action handler is registered
app.ocpp.onAny(async (payload, ctx) => {
  throw new Error(`Not implemented: ${ctx.action} (${ctx.version})`);
});

// CSMS → station CALL (waits for CALLRESULT)
const result = await app.ocpp.call('CP_001', 'Reset', { type: 'Soft' });

const conn = app.ocpp.getConnection('CS_002');
console.log(conn?.version); // e.g. '2.1'
await conn?.call('RequestStartTransaction', { /* ... */ });

// Live connections
app.ocpp.registry.list();           // all
app.ocpp.registry.list('2.1');      // filtered by negotiated version
```

## Message framing (OCPP-J)

All three versions use the same RPC envelope:

| Type | Array |
|------|--------|
| CALL | `[2, uniqueId, action, payload]` |
| CALLRESULT | `[3, uniqueId, payload]` |
| CALLERROR | `[4, uniqueId, errorCode, errorDescription, errorDetails]` |

## Scripts

```bash
npm install
npm run build     # compile TypeScript → dist/
npm run example   # demo CSMS on :9000 (see /health)
npm run smoke     # BootNotification + negotiation checks
```

## Layout

```text
schemas/
  1.6/   2.0.1/   2.1/     # official OCA JSON schemas
src/
  plugin.ts                # Fastify plugin + subprotocol negotiation
  basic-auth.ts            # HTTP Basic (profiles 1 / 2) on the upgrade
  connection.ts            # per-socket session
  framing.ts               # CALL / CALLRESULT / CALLERROR
  schema-validator.ts
  registry.ts
  actions/                 # action name lists per version
examples/
  server.ts
  smoke-test.ts
```

## Notes

- Implements **OCPP JSON over WebSocket (OCPP-J)** only — not OCPP-S (SOAP) 1.6.
- Business logic (auth, transactions, device model, smart charging, …) lives in your handlers; this library handles transport, negotiation, framing, schema validation, and optional HTTP Basic on the upgrade (profiles 1 / 2).
- Specs: OCPP 1.6 JSON + ocpp-j-1.6; OCPP 2.0.1 / 2.1 part 3 schemas and part 4 OCPP-J (Open Charge Alliance).

## License

[GPL-3.0-only](LICENSE) — © Mateus M. Côrtes

Repository: [github.com/mateuslacorte/fastify-ocpp](https://github.com/mateuslacorte/fastify-ocpp)
