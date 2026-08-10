import {
  MessageType,
  type CallErrorMessage,
  type CallMessage,
  type CallResultMessage,
  type JsonObject,
  type OcppMessage,
} from './constants.js';

export class OcppProtocolError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ProtocolError'
      | 'FormationViolation'
      | 'FormatViolation'
      | 'MessageTypeNotSupported' = 'ProtocolError',
  ) {
    super(message);
    this.name = 'OcppProtocolError';
  }
}

export function encodeCall(
  uniqueId: string,
  action: string,
  payload: JsonObject = {},
): string {
  const message: CallMessage = [MessageType.CALL, uniqueId, action, payload];
  return JSON.stringify(message);
}

export function encodeCallResult(
  uniqueId: string,
  payload: JsonObject = {},
): string {
  const message: CallResultMessage = [MessageType.CALLRESULT, uniqueId, payload];
  return JSON.stringify(message);
}

export function encodeCallError(
  uniqueId: string,
  errorCode: string,
  errorDescription: string,
  errorDetails: JsonObject = {},
): string {
  const message: CallErrorMessage = [
    MessageType.CALLERROR,
    uniqueId,
    errorCode,
    errorDescription,
    errorDetails,
  ];
  return JSON.stringify(message);
}

export function parseOcppMessage(raw: string | Buffer): OcppMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    throw new OcppProtocolError(
      'Message is not valid JSON',
      'FormationViolation',
    );
  }

  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new OcppProtocolError(
      'OCPP message must be a JSON array with at least 3 elements',
      'ProtocolError',
    );
  }

  const messageTypeId = parsed[0];
  const uniqueId = parsed[1];

  if (typeof messageTypeId !== 'number') {
    throw new OcppProtocolError(
      'MessageTypeId must be a number',
      'ProtocolError',
    );
  }
  if (typeof uniqueId !== 'string' || uniqueId.length === 0 || uniqueId.length > 36) {
    throw new OcppProtocolError(
      'UniqueId must be a non-empty string of at most 36 characters',
      'ProtocolError',
    );
  }

  switch (messageTypeId) {
    case MessageType.CALL: {
      if (parsed.length !== 4) {
        throw new OcppProtocolError(
          'CALL must have exactly 4 elements',
          'ProtocolError',
        );
      }
      const action = parsed[2];
      const payload = parsed[3];
      if (typeof action !== 'string' || action.length === 0) {
        throw new OcppProtocolError(
          'CALL action must be a non-empty string',
          'ProtocolError',
        );
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new OcppProtocolError(
          'CALL payload must be a JSON object',
          'ProtocolError',
        );
      }
      return [MessageType.CALL, uniqueId, action, payload as JsonObject];
    }
    case MessageType.CALLRESULT: {
      if (parsed.length !== 3) {
        throw new OcppProtocolError(
          'CALLRESULT must have exactly 3 elements',
          'ProtocolError',
        );
      }
      const payload = parsed[2];
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new OcppProtocolError(
          'CALLRESULT payload must be a JSON object',
          'ProtocolError',
        );
      }
      return [MessageType.CALLRESULT, uniqueId, payload as JsonObject];
    }
    case MessageType.CALLERROR: {
      if (parsed.length !== 5) {
        throw new OcppProtocolError(
          'CALLERROR must have exactly 5 elements',
          'ProtocolError',
        );
      }
      const errorCode = parsed[2];
      const errorDescription = parsed[3];
      const errorDetails = parsed[4];
      if (typeof errorCode !== 'string') {
        throw new OcppProtocolError(
          'CALLERROR errorCode must be a string',
          'ProtocolError',
        );
      }
      if (typeof errorDescription !== 'string') {
        throw new OcppProtocolError(
          'CALLERROR errorDescription must be a string',
          'ProtocolError',
        );
      }
      if (
        errorDetails === null ||
        typeof errorDetails !== 'object' ||
        Array.isArray(errorDetails)
      ) {
        throw new OcppProtocolError(
          'CALLERROR errorDetails must be a JSON object',
          'ProtocolError',
        );
      }
      return [
        MessageType.CALLERROR,
        uniqueId,
        errorCode,
        errorDescription,
        errorDetails as JsonObject,
      ];
    }
    default:
      throw new OcppProtocolError(
        `Unsupported MessageTypeId: ${messageTypeId}`,
        'MessageTypeNotSupported',
      );
  }
}
