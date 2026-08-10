import Fastify from 'fastify';
import WebSocket from 'ws';
import {
  fastifyOcpp,
  parseOcppMessage,
  MessageType,
  selectSubprotocol,
} from '../src/index.js';

const app = Fastify({ logger: false });

await app.register(fastifyOcpp, {
  versions: ['2.1', '2.0.1', '1.6'],
  path: '/ocpp',
});

app.ocpp.onAction('BootNotification', async (_payload, ctx) => {
  if (ctx.version === '1.6') {
    return {
      status: 'Accepted',
      currentTime: '2026-01-01T00:00:00.000Z',
      interval: 60,
    };
  }
  return {
    status: 'Accepted',
    currentTime: '2026-01-01T00:00:00.000Z',
    interval: 60,
  };
});

await app.listen({ port: 0, host: '127.0.0.1' });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('No address');
const port = address.port;

type Case = {
  name: string;
  chargePointId: string;
  /** Subprotocol(s) offered by the client. */
  protocols: string | string[];
  /** Expected negotiated protocol on the socket. */
  expectProtocol: string;
  payload: Record<string, unknown>;
};

const cases: Case[] = [
  {
    name: '1.6',
    chargePointId: 'CP16',
    protocols: 'ocpp1.6',
    expectProtocol: 'ocpp1.6',
    payload: {
      chargePointVendor: 'Acme',
      chargePointModel: 'Model-X',
    },
  },
  {
    name: '2.0.1',
    chargePointId: 'CS201',
    protocols: 'ocpp2.0.1',
    expectProtocol: 'ocpp2.0.1',
    payload: {
      reason: 'PowerUp',
      chargingStation: {
        model: 'Model-X',
        vendorName: 'Acme',
      },
    },
  },
  {
    name: '2.1',
    chargePointId: 'CS21',
    protocols: 'ocpp2.1',
    expectProtocol: 'ocpp2.1',
    payload: {
      reason: 'PowerUp',
      chargingStation: {
        model: 'Model-X',
        vendorName: 'Acme',
      },
    },
  },
  {
    name: 'prefer-2.1-over-1.6',
    chargePointId: 'CS_PREF',
    protocols: ['ocpp2.1', 'ocpp1.6'],
    expectProtocol: 'ocpp2.1',
    payload: {
      reason: 'PowerUp',
      chargingStation: {
        model: 'Model-X',
        vendorName: 'Acme',
      },
    },
  },
];

function callBoot(c: Case): Promise<{ protocol: string; msg: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ocpp/${c.chargePointId}`,
      c.protocols,
    );
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout for ${c.name}`));
    }, 5000);

    ws.on('open', () => {
      if (ws.protocol !== c.expectProtocol) {
        clearTimeout(timer);
        ws.close();
        reject(
          new Error(
            `${c.name}: expected protocol ${c.expectProtocol}, got ${ws.protocol || '(none)'}`,
          ),
        );
        return;
      }
      ws.send(JSON.stringify([2, 'test-1', 'BootNotification', c.payload]));
    });

    ws.on('message', (data) => {
      clearTimeout(timer);
      try {
        const msg = parseOcppMessage(data.toString());
        ws.close();
        resolve({ protocol: ws.protocol, msg });
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected response ${res.statusCode} for ${c.name}`));
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let failed = 0;

// Pure negotiation helper checks
const pref = selectSubprotocol(
  new Set(['ocpp1.6', 'ocpp2.1']),
  ['2.1', '2.0.1', '1.6'],
);
if (pref !== 'ocpp2.1') {
  console.error('FAIL selectSubprotocol preference:', pref);
  failed++;
} else {
  console.log('OK  selectSubprotocol prefers ocpp2.1');
}

const none = selectSubprotocol(new Set(['ocpp99']), ['2.1', '2.0.1', '1.6']);
if (none !== false) {
  console.error('FAIL selectSubprotocol should reject unknown:', none);
  failed++;
} else {
  console.log('OK  selectSubprotocol rejects unknown');
}

for (const c of cases) {
  try {
    const { protocol, msg } = await callBoot(c);
    const parsed = msg as unknown[];
    if (parsed[0] !== MessageType.CALLRESULT) {
      console.error(`FAIL ${c.name}: expected CALLRESULT, got`, msg);
      failed++;
      continue;
    }
    console.log(
      `OK  ${c.name} (${protocol}) ->`,
      JSON.stringify(parsed[2]),
    );
  } catch (err) {
    console.error(`FAIL ${c.name}:`, err);
    failed++;
  }
}

// Disabled / wrong subprotocol should fail handshake
await new Promise<void>((resolve) => {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ocpp/BAD`,
    'not-a-real-ocpp',
  );
  ws.on('open', () => {
    console.error('FAIL reject-unknown: unexpectedly open');
    failed++;
    ws.close();
    resolve();
  });
  ws.on('unexpected-response', (_r, res) => {
    console.log('OK  reject-unknown ->', res.statusCode);
    resolve();
  });
  ws.on('error', (e) => {
    console.log('OK  reject-unknown ->', e.message);
    resolve();
  });
});

await app.close();
process.exit(failed ? 1 : 0);
