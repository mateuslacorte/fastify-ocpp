import { OCPP16_ACTIONS, type Ocpp16Action } from '../actions/v16.js';
import { OCPP201_ACTIONS, type Ocpp201Action } from '../actions/v201.js';
import { OCPP21_ACTIONS, type Ocpp21Action } from '../actions/v21.js';
import {
  OCPP_DEFAULT_PATH,
  OCPP_SUBPROTOCOLS,
  type OcppVersion,
} from '../constants.js';

export interface VersionMeta {
  version: OcppVersion;
  subprotocol: string;
  /** Shared WebSocket path used by all versions. */
  defaultPath: string;
  actions: readonly string[];
}

export const VERSION_META: Record<OcppVersion, VersionMeta> = {
  '1.6': {
    version: '1.6',
    subprotocol: OCPP_SUBPROTOCOLS['1.6'],
    defaultPath: OCPP_DEFAULT_PATH,
    actions: OCPP16_ACTIONS,
  },
  '2.0.1': {
    version: '2.0.1',
    subprotocol: OCPP_SUBPROTOCOLS['2.0.1'],
    defaultPath: OCPP_DEFAULT_PATH,
    actions: OCPP201_ACTIONS,
  },
  '2.1': {
    version: '2.1',
    subprotocol: OCPP_SUBPROTOCOLS['2.1'],
    defaultPath: OCPP_DEFAULT_PATH,
    actions: OCPP21_ACTIONS,
  },
};

export function isKnownAction(
  version: OcppVersion,
  action: string,
): boolean {
  return (VERSION_META[version].actions as readonly string[]).includes(action);
}

export type { Ocpp16Action, Ocpp201Action, Ocpp21Action };
export { OCPP16_ACTIONS, OCPP201_ACTIONS, OCPP21_ACTIONS };
