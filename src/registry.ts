import type { OcppVersion } from './constants.js';
import type { OcppConnection } from './connection.js';

/**
 * Tracks live Charge Point connections, keyed by identity.
 * The negotiated OCPP version is stored on each connection.
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, OcppConnection>();

  add(connection: OcppConnection): void {
    this.connections.set(connection.chargePointId, connection);
  }

  remove(connection: OcppConnection): void {
    const current = this.connections.get(connection.chargePointId);
    if (current === connection) {
      this.connections.delete(connection.chargePointId);
    }
  }

  get(chargePointId: string): OcppConnection | undefined {
    return this.connections.get(chargePointId);
  }

  has(chargePointId: string): boolean {
    return this.connections.has(chargePointId);
  }

  list(version?: OcppVersion): OcppConnection[] {
    const all = [...this.connections.values()];
    return version ? all.filter((c) => c.version === version) : all;
  }

  get size(): number {
    return this.connections.size;
  }
}
