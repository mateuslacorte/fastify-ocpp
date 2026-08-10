import Fastify from 'fastify';
import {
  fastifyOcpp,
  type JsonObject,
  type OcppCallContext,
} from '../src/index.js';

const port = Number(process.env.PORT ?? 9000);
const host = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(fastifyOcpp, {
  // Shared path; version comes from Sec-WebSocket-Protocol negotiation.
  // Preference order (first offered match wins): 2.1 > 2.0.1 > 1.6
  //   ws://host:9000/ocpp/:chargePointId
  versions: ['2.1', '2.0.1', '1.6'],
  path: '/ocpp',
  onConnect(info) {
    app.log.info(
      { chargePointId: info.chargePointId, version: info.version },
      'Charge Point connected',
    );
  },
  onDisconnect(info, code, reason) {
    app.log.info(
      { chargePointId: info.chargePointId, version: info.version, code, reason },
      'Charge Point disconnected',
    );
  },
});

// Shared BootNotification handler — response shape differs by version.
app.ocpp.onAction('BootNotification', async (payload: JsonObject, ctx: OcppCallContext) => {
  app.log.info({ version: ctx.version, payload }, 'BootNotification');

  if (ctx.version === '1.6') {
    return {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300,
    };
  }

  // OCPP 2.0.1 / 2.1
  return {
    currentTime: new Date().toISOString(),
    interval: 300,
    status: 'Accepted',
  };
});

app.ocpp.onAction('Heartbeat', async (_payload, ctx) => {
  app.log.info({ version: ctx.version, id: ctx.chargePointId }, 'Heartbeat');
  return { currentTime: new Date().toISOString() };
});

app.ocpp.onAction('StatusNotification', async (payload, ctx) => {
  app.log.info({ version: ctx.version, payload }, 'StatusNotification');
  return {};
});

// Catch-all for demos — returns {} which may fail schema validation for some
// actions. Prefer explicit handlers in production.
app.ocpp.onAny(async (payload, ctx) => {
  app.log.warn(
    { action: ctx.action, version: ctx.version, payload },
    'Unhandled OCPP action — returning empty payload',
  );
  return {};
});

app.get('/health', async () => ({
  ok: true,
  versions: app.ocpp.versions,
  path: app.ocpp.path,
  connections: app.ocpp.registry.list().map((c) => c.info),
}));

app.get('/connections', async () =>
  app.ocpp.registry.list().map((c) => ({
    chargePointId: c.chargePointId,
    version: c.version,
    connectedAt: c.connectedAt,
    remoteAddress: c.remoteAddress,
  })),
);

/**
 * Example: CSMS-initiated Reset against a connected station.
 * POST /api/CP001/Reset  { "type": "Soft" }
 */
app.post<{
  Params: { chargePointId: string; action: string };
  Body: JsonObject;
}>('/api/:chargePointId/:action', async (request, reply) => {
  const { chargePointId, action } = request.params;

  try {
    const result = await app.ocpp.call(
      chargePointId,
      action,
      (request.body ?? {}) as JsonObject,
    );
    return { result };
  } catch (err) {
    return reply.code(404).send({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

await app.listen({ port, host });
app.log.info(`OCPP CSMS listening on ws://${host}:${port}${app.ocpp.path}/:chargePointId`);
app.log.info(`Version preference: ${app.ocpp.versions.join(' > ')}`);
