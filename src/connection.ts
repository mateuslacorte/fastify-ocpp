import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  MessageType,
  OcppErrorCode,
  type JsonObject,
  type OcppVersion,
} from './constants.js';
import {
  encodeCall,
  encodeCallError,
  encodeCallResult,
  parseOcppMessage,
  OcppProtocolError,
} from './framing.js';
import type { SchemaValidator } from './schema-validator.js';
import type {
  OcppActionHandler,
  OcppCallContext,
  OcppConnectionInfo,
  PendingCall,
  SendCallOptions,
} from './types.js';

export interface OcppConnectionOptions {
  chargePointId: string;
  version: OcppVersion;
  socket: WebSocket;
  validator: SchemaValidator;
  validateIncoming: boolean;
  validateOutgoing: boolean;
  callTimeoutMs: number;
  remoteAddress?: string;
  handlers: Map<string, OcppActionHandler>;
  defaultHandler?: OcppActionHandler;
}

/**
 * One WebSocket session between the CSMS and a Charge Point / Charging Station.
 */
export class OcppConnection extends EventEmitter {
  readonly chargePointId: string;
  readonly version: OcppVersion;
  readonly connectedAt: Date;
  readonly remoteAddress?: string;

  private readonly socket: WebSocket;
  private readonly validator: SchemaValidator;
  private readonly validateIncoming: boolean;
  private readonly validateOutgoing: boolean;
  private readonly callTimeoutMs: number;
  private readonly handlers: Map<string, OcppActionHandler>;
  private defaultHandler?: OcppActionHandler;
  private readonly pending = new Map<string, PendingCall>();
  private closed = false;

  constructor(options: OcppConnectionOptions) {
    super();
    this.chargePointId = options.chargePointId;
    this.version = options.version;
    this.socket = options.socket;
    this.validator = options.validator;
    this.validateIncoming = options.validateIncoming;
    this.validateOutgoing = options.validateOutgoing;
    this.callTimeoutMs = options.callTimeoutMs;
    this.handlers = options.handlers;
    this.defaultHandler = options.defaultHandler;
    this.remoteAddress = options.remoteAddress;
    this.connectedAt = new Date();

    this.socket.on('message', (data: WebSocket.RawData) => {
      void this.onMessage(data);
    });
    this.socket.on('close', (code: number, reason: Buffer) => {
      this.onClose(code, reason.toString('utf8'));
    });
    this.socket.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  get info(): OcppConnectionInfo {
    return {
      chargePointId: this.chargePointId,
      version: this.version,
      connectedAt: this.connectedAt,
      remoteAddress: this.remoteAddress,
    };
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  /**
   * Register or replace a handler for an inbound Charge Point → CSMS action.
   */
  onAction(action: string, handler: OcppActionHandler): void {
    this.handlers.set(action, handler);
  }

  /** Replace the fallback handler used when no action-specific handler exists. */
  setDefaultHandler(handler: OcppActionHandler | undefined): void {
    this.defaultHandler = handler;
  }

  /**
   * Send a CALL from the CSMS to the Charge Point and wait for CALLRESULT.
   */
  async call<TRes extends JsonObject = JsonObject>(
    action: string,
    payload: JsonObject = {},
    options: SendCallOptions = {},
  ): Promise<TRes> {
    if (!this.isOpen) {
      throw new Error(
        `Connection to ${this.chargePointId} (${this.version}) is closed`,
      );
    }

    if (this.validateOutgoing) {
      const result = this.validator.validate(
        this.version,
        action,
        'request',
        payload,
      );
      if (!result.valid) {
        throw new Error(
          `Outgoing ${action} payload invalid: ${this.validator.formatErrors(result.errors)}`,
        );
      }
    }

    const uniqueId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.callTimeoutMs;

    const response = await new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(uniqueId);
        reject(
          new Error(
            `Timeout waiting for ${action} response from ${this.chargePointId}`,
          ),
        );
      }, timeoutMs);

      this.pending.set(uniqueId, { action, resolve, reject, timer });
      this.socket.send(encodeCall(uniqueId, action, payload), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(uniqueId);
          reject(err);
        }
      });
    });

    return response as TRes;
  }

  close(code = 1000, reason = 'Normal Closure'): void {
    if (this.closed) return;
    this.socket.close(code, reason);
  }

  private async onMessage(data: WebSocket.RawData): Promise<void> {
    let message;
    try {
      message = parseOcppMessage(
        typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer),
      );
    } catch (err) {
      const protocolErr =
        err instanceof OcppProtocolError
          ? err
          : new OcppProtocolError(String(err));
      // Without a UniqueId we cannot send CALLERROR; drop the frame.
      this.emit('protocolError', protocolErr);
      return;
    }

    const messageTypeId = message[0];
    const uniqueId = message[1];

    try {
      if (messageTypeId === MessageType.CALL) {
        await this.handleCall(uniqueId, message[2], message[3]);
        return;
      }
      if (messageTypeId === MessageType.CALLRESULT) {
        this.handleCallResult(uniqueId, message[2]);
        return;
      }
      if (messageTypeId === MessageType.CALLERROR) {
        this.handleCallError(uniqueId, message[2], message[3], message[4]);
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private async handleCall(
    uniqueId: string,
    action: string,
    payload: JsonObject,
  ): Promise<void> {
    const formatViolation =
      this.version === '1.6'
        ? OcppErrorCode.FormationViolation
        : OcppErrorCode.FormatViolation;

    if (this.validateIncoming) {
      const result = this.validator.validate(
        this.version,
        action,
        'request',
        payload,
      );
      if (!result.valid) {
        this.sendError(
          uniqueId,
          formatViolation,
          this.validator.formatErrors(result.errors),
          { errors: result.errors as unknown as JsonObject },
        );
        return;
      }
    }

    const handler = this.handlers.get(action) ?? this.defaultHandler;
    if (!handler) {
      this.sendError(
        uniqueId,
        OcppErrorCode.NotImplemented,
        `No handler registered for action ${action}`,
      );
      return;
    }

    const ctx: OcppCallContext = {
      chargePointId: this.chargePointId,
      version: this.version,
      uniqueId,
      action,
      socket: this.socket,
    };

    try {
      const responsePayload = (await handler(payload, ctx)) ?? {};

      if (this.validateOutgoing) {
        const result = this.validator.validate(
          this.version,
          action,
          'response',
          responsePayload,
        );
        if (!result.valid) {
          this.sendError(
            uniqueId,
            OcppErrorCode.InternalError,
            `Handler response for ${action} failed schema validation: ${this.validator.formatErrors(result.errors)}`,
          );
          return;
        }
      }

      this.socket.send(encodeCallResult(uniqueId, responsePayload));
      this.emit('call', { action, payload, response: responsePayload, ctx });
    } catch (err) {
      const description =
        err instanceof Error ? err.message : 'Unhandled handler error';
      this.sendError(uniqueId, OcppErrorCode.InternalError, description);
      this.emit('handlerError', err, action);
    }
  }

  private handleCallResult(uniqueId: string, payload: JsonObject): void {
    const pending = this.pending.get(uniqueId);
    if (!pending) {
      this.emit(
        'unexpectedResult',
        uniqueId,
        payload,
      );
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(uniqueId);

    if (this.validateIncoming) {
      const result = this.validator.validate(
        this.version,
        pending.action,
        'response',
        payload,
      );
      if (!result.valid) {
        pending.reject(
          new Error(
            `CALLRESULT for ${pending.action} failed schema validation: ${this.validator.formatErrors(result.errors)}`,
          ),
        );
        return;
      }
    }

    pending.resolve(payload);
  }

  private handleCallError(
    uniqueId: string,
    errorCode: string,
    errorDescription: string,
    errorDetails: JsonObject,
  ): void {
    const pending = this.pending.get(uniqueId);
    if (!pending) {
      this.emit('unexpectedError', uniqueId, errorCode, errorDescription);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(uniqueId);
    const err = new Error(
      `CALLERROR for ${pending.action}: [${errorCode}] ${errorDescription}`,
    );
    Object.assign(err, { errorCode, errorDescription, errorDetails });
    pending.reject(err);
  }

  private sendError(
    uniqueId: string,
    code: string,
    description: string,
    details: JsonObject = {},
  ): void {
    if (!this.isOpen) return;
    this.socket.send(encodeCallError(uniqueId, code, description, details));
  }

  private onClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          `Connection closed while waiting for ${pending.action} (${id})`,
        ),
      );
    }
    this.pending.clear();
    this.emit('close', code, reason);
  }
}
