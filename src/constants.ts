import type { Ocpp16Action } from './actions/v16.js';
import type { Ocpp201Action } from './actions/v201.js';
import type { Ocpp21Action } from './actions/v21.js';

/**
 * Supported OCPP versions in default preference order (newest first).
 * Used as both the allow-list and negotiation preference when `versions`
 * is omitted from plugin options.
 */
export const OCPP_VERSIONS = ['2.1', '2.0.1', '1.6'] as const;
export type OcppVersion = (typeof OCPP_VERSIONS)[number];

/** WebSocket subprotocol negotiated during the handshake. */
export const OCPP_SUBPROTOCOLS: Record<OcppVersion, string> = {
  '1.6': 'ocpp1.6',
  '2.0.1': 'ocpp2.0.1',
  '2.1': 'ocpp2.1',
};

/** Default shared WebSocket path prefix (`/:chargePointId` is appended). */
export const OCPP_DEFAULT_PATH = '/ocpp';

/** Reverse map: subprotocol → OCPP version. */
export const OCPP_VERSION_BY_SUBPROTOCOL: Record<string, OcppVersion> = {
  'ocpp1.6': '1.6',
  'ocpp2.0.1': '2.0.1',
  'ocpp2.1': '2.1',
};

export const MessageType = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
} as const;

export type MessageTypeId = (typeof MessageType)[keyof typeof MessageType];

/** Error codes shared across OCPP-J versions (2.x uses FormatViolation). */
export const OcppErrorCode = {
  NotImplemented: 'NotImplemented',
  NotSupported: 'NotSupported',
  InternalError: 'InternalError',
  ProtocolError: 'ProtocolError',
  SecurityError: 'SecurityError',
  /** OCPP 1.6 name */
  FormationViolation: 'FormationViolation',
  /** OCPP 2.x name for the same concept */
  FormatViolation: 'FormatViolation',
  PropertyConstraintViolation: 'PropertyConstraintViolation',
  OccurenceConstraintViolation: 'OccurenceConstraintViolation',
  TypeConstraintViolation: 'TypeConstraintViolation',
  GenericError: 'GenericError',
  RpcFrameworkError: 'RpcFrameworkError',
  MessageTypeNotSupported: 'MessageTypeNotSupported',
} as const;

export type OcppErrorCodeName =
  (typeof OcppErrorCode)[keyof typeof OcppErrorCode];

export type OcppAction = Ocpp16Action | Ocpp201Action | Ocpp21Action;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type CallMessage = [typeof MessageType.CALL, string, string, JsonObject];
export type CallResultMessage = [
  typeof MessageType.CALLRESULT,
  string,
  JsonObject,
];
export type CallErrorMessage = [
  typeof MessageType.CALLERROR,
  string,
  string,
  string,
  JsonObject,
];
export type OcppMessage = CallMessage | CallResultMessage | CallErrorMessage;
