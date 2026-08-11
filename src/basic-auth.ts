import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OcppGetPassword } from './types.js';

export const OCPP_BASIC_AUTH_REALM = 'OCPP';

export interface BasicCredentials {
  username: string;
  password: string;
}

/**
 * Parse an `Authorization: Basic …` header.
 * Username is everything before the first colon (RFC 7617).
 */
export function parseBasicAuthorization(
  header: string | string[] | undefined,
): BasicCredentials | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;

  const match = /^Basic\s+(\S+)/i.exec(value.trim());
  const encoded = match?.[1];
  if (!encoded) return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return undefined;
  }

  const colon = decoded.indexOf(':');
  if (colon === -1) return undefined;

  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

/** Timing-safe string compare (length-independent via SHA-256). */
export function passwordsEqual(actual: string, expected: string): boolean {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function wwwAuthenticateHeader(realm: string): string {
  return `Basic realm="${realm.replaceAll('"', '')}"`;
}

function sendUnauthorized(reply: FastifyReply, wwwAuthenticate: string) {
  return reply
    .code(401)
    .header('WWW-Authenticate', wwwAuthenticate)
    .send();
}

/**
 * Route `preValidation` hook: require HTTP Basic on the WebSocket upgrade
 * (OCPP security profiles 1 and 2). Rejects with 401 *before*
 * `101 Switching Protocols`.
 */
export function createBasicAuthHook(
  getPassword: OcppGetPassword,
  realm: string,
) {
  const challenge = wwwAuthenticateHeader(realm);

  return async function basicAuthPreValidation(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const chargePointId = (request.params as { chargePointId?: string })
      .chargePointId;
    const credentials = parseBasicAuthorization(request.headers.authorization);

    if (
      !chargePointId ||
      !credentials ||
      credentials.username !== chargePointId
    ) {
      return sendUnauthorized(reply, challenge);
    }

    const expected = await getPassword(chargePointId, request);
    if (
      expected === undefined ||
      !passwordsEqual(credentials.password, expected)
    ) {
      return sendUnauthorized(reply, challenge);
    }
  };
}
