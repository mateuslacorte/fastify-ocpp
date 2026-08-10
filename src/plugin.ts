import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fp from 'fastify-plugin';
import {
  OCPP_DEFAULT_PATH,
  OCPP_SUBPROTOCOLS,
  OCPP_VERSION_BY_SUBPROTOCOL,
  OCPP_VERSIONS,
  type JsonObject,
  type OcppVersion,
} from './constants.js';
import { OcppConnection } from './connection.js';
import { ConnectionRegistry } from './registry.js';
import { SchemaValidator } from './schema-validator.js';
import type { FastifyOcppOptions, OcppActionHandler } from './types.js';

export interface OcppDecorator {
  /** Live connections across all enabled versions. */
  registry: ConnectionRegistry;
  /** Shared JSON-schema validator backed by official OCA schemas. */
  validator: SchemaValidator;
  /**
   * Enabled versions in preference order (first match during negotiation wins).
   */
  versions: OcppVersion[];
  /** Shared WebSocket path prefix (`/:chargePointId` is appended). */
  path: string;
  /**
   * Register a handler for an inbound action on one version, or all versions
   * when `version` is omitted.
   */
  onAction: (
    action: string,
    handler: OcppActionHandler,
    version?: OcppVersion,
  ) => void;
  /** Fallback handler used when no action-specific handler exists. */
  onAny: (handler: OcppActionHandler, version?: OcppVersion) => void;
  /** Look up a connected Charge Point by identity. */
  getConnection: (chargePointId: string) => OcppConnection | undefined;
  /** Send a CALL to a connected Charge Point. */
  call: <TRes extends JsonObject = JsonObject>(
    chargePointId: string,
    action: string,
    payload?: JsonObject,
  ) => Promise<TRes>;
}

declare module 'fastify' {
  interface FastifyInstance {
    ocpp: OcppDecorator;
  }
}

/**
 * Pick the preferred subprotocol from those the client offered.
 * Preference follows `versions` order (first match wins).
 */
export function selectSubprotocol(
  offered: Set<string> | Iterable<string>,
  versions: readonly OcppVersion[],
): string | false {
  const offeredSet =
    offered instanceof Set ? offered : new Set(offered);
  for (const version of versions) {
    const sub = OCPP_SUBPROTOCOLS[version];
    if (offeredSet.has(sub)) return sub;
  }
  return false;
}

const ocppPluginImpl: FastifyPluginAsync<FastifyOcppOptions> = async (
  fastify,
  options,
) => {
  const versions = options.versions?.length
    ? options.versions
    : [...OCPP_VERSIONS];
  for (const v of versions) {
    if (!(OCPP_VERSIONS as readonly string[]).includes(v)) {
      throw new Error(`Unsupported OCPP version: ${v}`);
    }
  }
  if (versions.length === 0) {
    throw new Error('At least one OCPP version must be enabled');
  }

  const path = (options.path ?? OCPP_DEFAULT_PATH).replace(/\/$/, '');
  const validateIncoming = options.validateIncoming ?? true;
  const validateOutgoing = options.validateOutgoing ?? true;
  const callTimeoutMs = options.callTimeoutMs ?? 30_000;
  const rejectDuplicates = options.rejectDuplicateConnections ?? true;

  const validator = new SchemaValidator(options.schemasDir);
  const registry = new ConnectionRegistry();

  const handlersByVersion = new Map<
    OcppVersion,
    Map<string, OcppActionHandler>
  >();
  const defaultHandlers = new Map<OcppVersion, OcppActionHandler>();
  for (const version of versions) {
    handlersByVersion.set(version, new Map());
  }

  await fastify.register(websocket, {
    options: {
      handleProtocols: (protocols: Set<string>) =>
        selectSubprotocol(protocols, versions),
    },
  });

  fastify.get(
    `${path}/:chargePointId`,
    { websocket: true },
    (socket, request: FastifyRequest) => {
      const chargePointId = (request.params as { chargePointId?: string })
        .chargePointId;

      if (!chargePointId) {
        socket.close(1008, 'Missing chargePointId');
        return;
      }

      const protocol = socket.protocol;
      if (!protocol) {
        socket.close(
          1002,
          `Missing required WebSocket subprotocol (one of: ${versions
            .map((v) => OCPP_SUBPROTOCOLS[v])
            .join(', ')})`,
        );
        return;
      }

      const version = OCPP_VERSION_BY_SUBPROTOCOL[protocol];
      if (!version || !versions.includes(version)) {
        socket.close(1002, `Unsupported WebSocket subprotocol ${protocol}`);
        return;
      }

      if (rejectDuplicates && registry.has(chargePointId)) {
        socket.close(
          1008,
          `Charge Point ${chargePointId} already connected`,
        );
        return;
      }

      const existing = registry.get(chargePointId);
      if (existing) {
        existing.close(1000, 'Replaced by new connection');
        registry.remove(existing);
      }

      const versionHandlers = handlersByVersion.get(version)!;
      const connection = new OcppConnection({
        chargePointId,
        version,
        socket,
        validator,
        validateIncoming,
        validateOutgoing,
        callTimeoutMs,
        remoteAddress: request.ip,
        handlers: new Map(versionHandlers),
        defaultHandler: defaultHandlers.get(version),
      });

      registry.add(connection);

      connection.on('close', (code: number, reason: string) => {
        registry.remove(connection);
        void options.onDisconnect?.(connection.info, code, reason);
      });

      void options.onConnect?.(connection.info);
    },
  );

  fastify.log.info(
    `OCPP WebSocket endpoint: ${path}/:chargePointId (subprotocols: ${versions
      .map((v) => OCPP_SUBPROTOCOLS[v])
      .join(', ')}; preference order: ${versions.join(' > ')})`,
  );

  const decorator: OcppDecorator = {
    registry,
    validator,
    versions,
    path,
    onAction(action, handler, version) {
      const targets = version ? [version] : versions;
      for (const v of targets) {
        handlersByVersion.get(v)?.set(action, handler);
        for (const conn of registry.list(v)) {
          conn.onAction(action, handler);
        }
      }
    },
    onAny(handler, version) {
      const targets = version ? [version] : versions;
      for (const v of targets) {
        defaultHandlers.set(v, handler);
        for (const conn of registry.list(v)) {
          conn.setDefaultHandler(handler);
        }
      }
    },
    getConnection(chargePointId) {
      return registry.get(chargePointId);
    },
    async call(chargePointId, action, payload = {}) {
      const connection = registry.get(chargePointId);
      if (!connection) {
        throw new Error(
          `No active connection for Charge Point ${chargePointId}`,
        );
      }
      return connection.call(action, payload);
    },
  };

  fastify.decorate('ocpp', decorator);
};

/**
 * Fastify plugin that serves OCPP 1.6, 2.0.1 and/or 2.1 on a shared path,
 * selecting the version via WebSocket subprotocol negotiation.
 *
 * @example
 * ```ts
 * await app.register(fastifyOcpp, {
 *   versions: ['2.1', '2.0.1', '1.6'], // preference order
 *   path: '/ocpp',
 * });
 * app.ocpp.onAction('BootNotification', async (payload, ctx) => { ... });
 * ```
 */
export const fastifyOcpp = fp(ocppPluginImpl, {
  name: 'fastify-ocpp',
  fastify: '5.x',
});

export default fastifyOcpp;

/**
 * Register the shared OCPP endpoint accepting only a single protocol version.
 */
export async function registerOcppVersion(
  fastify: FastifyInstance,
  version: OcppVersion,
  options: Omit<FastifyOcppOptions, 'versions'> = {},
): Promise<void> {
  await fastify.register(fastifyOcpp, {
    ...options,
    versions: [version],
  });
}
