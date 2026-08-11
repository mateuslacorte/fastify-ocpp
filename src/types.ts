import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type {
  JsonObject,
  OcppErrorCodeName,
  OcppVersion,
} from './constants.js';

export interface OcppCallContext {
  /** Charge Point / Charging Station identity from the URL. */
  chargePointId: string;
  /** Negotiated OCPP version for this connection. */
  version: OcppVersion;
  /** UniqueId of the inbound CALL. */
  uniqueId: string;
  /** Action name of the inbound CALL. */
  action: string;
  /** Underlying WebSocket. */
  socket: WebSocket;
}

export type OcppActionHandler<TReq = JsonObject, TRes = JsonObject> = (
  payload: TReq,
  ctx: OcppCallContext,
) => Promise<TRes> | TRes;

export interface OcppCallError {
  code: OcppErrorCodeName;
  description: string;
  details?: JsonObject;
}

export interface SendCallOptions {
  /** Milliseconds to wait for CALLRESULT / CALLERROR. Default 30s. */
  timeoutMs?: number;
}

export interface PendingCall {
  action: string;
  resolve: (payload: JsonObject) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OcppConnectionInfo {
  chargePointId: string;
  version: OcppVersion;
  connectedAt: Date;
  remoteAddress?: string;
}

/**
 * Look up the pre-shared key provisioned on a Charge Point.
 * Return `undefined` to reject the WebSocket upgrade with 401.
 */
export type OcppGetPassword = (
  chargePointId: string,
  request: FastifyRequest,
) => string | undefined | Promise<string | undefined>;

export interface FastifyOcppOptions {
  /**
   * Which protocol versions to accept, in preference order.
   * During the WebSocket handshake the first entry that the client offers
   * in `Sec-WebSocket-Protocol` wins.
   * Default: `['2.1', '2.0.1', '1.6']`.
   */
  versions?: OcppVersion[];
  /**
   * Shared path prefix without trailing slash.
   * Final route is `${path}/:chargePointId`.
   * Default: `/ocpp`.
   */
  path?: string;
  /**
   * Absolute or module-relative path to the schemas root that contains
   * `1.6/`, `2.0.1/`, `2.1/`. Defaults to the package `schemas/` folder.
   */
  schemasDir?: string;
  /** Validate inbound CALL payloads with official JSON schemas. Default true. */
  validateIncoming?: boolean;
  /** Validate outbound CALL / CALLRESULT payloads. Default true. */
  validateOutgoing?: boolean;
  /** Default timeout for CSMS → Charge Point CALLs. Default 30000. */
  callTimeoutMs?: number;
  /**
   * Reject the upgrade when another connection already exists for the same
   * chargePointId. Default true.
   */
  rejectDuplicateConnections?: boolean;
  /**
   * HTTP Basic Authentication for OCPP security profiles 1 (Basic) and
   * 2 (TLS + Basic).
   *
   * When set, the Charge Point must send `Authorization: Basic` on the
   * WebSocket upgrade. Username **must** equal `{chargePointId}` in the URL.
   * Password is the pre-shared key provisioned on that station — not an
   * end-user password.
   *
   * Return the expected password, or `undefined` to reject. Comparison is
   * timing-safe. Missing / mismatched credentials are rejected with
   * `401 Unauthorized` **before** `101 Switching Protocols`.
   *
   * Omit for security profile 0 (no authentication). TLS for profile 2 is
   * provided by Fastify HTTPS or a reverse proxy, not by this option.
   */
  getPassword?: OcppGetPassword;
  /**
   * Realm advertised in `WWW-Authenticate` on 401 responses.
   * Default: `"OCPP"`.
   */
  basicAuthRealm?: string;
  /** Optional hook invoked after a connection is accepted. */
  onConnect?: (info: OcppConnectionInfo) => void | Promise<void>;
  /** Optional hook invoked after a connection closes. */
  onDisconnect?: (
    info: OcppConnectionInfo,
    code: number,
    reason: string,
  ) => void | Promise<void>;
}
