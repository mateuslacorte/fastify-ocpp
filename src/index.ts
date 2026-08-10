export {
  fastifyOcpp,
  registerOcppVersion,
  selectSubprotocol,
  type OcppDecorator,
} from './plugin.js';
export { default } from './plugin.js';

export { OcppConnection } from './connection.js';
export { ConnectionRegistry } from './registry.js';
export { SchemaValidator } from './schema-validator.js';
export {
  encodeCall,
  encodeCallResult,
  encodeCallError,
  parseOcppMessage,
  OcppProtocolError,
} from './framing.js';

export {
  OCPP_VERSIONS,
  OCPP_SUBPROTOCOLS,
  OCPP_DEFAULT_PATH,
  OCPP_VERSION_BY_SUBPROTOCOL,
  MessageType,
  OcppErrorCode,
  type OcppVersion,
  type OcppAction,
  type OcppMessage,
  type CallMessage,
  type CallResultMessage,
  type CallErrorMessage,
  type JsonObject,
  type JsonValue,
  type OcppErrorCodeName,
} from './constants.js';

export type {
  FastifyOcppOptions,
  OcppActionHandler,
  OcppCallContext,
  OcppConnectionInfo,
  OcppCallError,
  SendCallOptions,
} from './types.js';

export {
  VERSION_META,
  isKnownAction,
  OCPP16_ACTIONS,
  OCPP201_ACTIONS,
  OCPP21_ACTIONS,
  type Ocpp16Action,
  type Ocpp201Action,
  type Ocpp21Action,
} from './versions/index.js';
