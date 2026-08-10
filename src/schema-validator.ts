import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { JsonObject, OcppVersion } from './constants.js';

const require = createRequire(import.meta.url);
// ajv is CJS; require keeps typings simple under NodeNext.
const Ajv = require('ajv') as typeof import('ajv').default;
const addFormats = require('ajv-formats') as (
  ajv: InstanceType<typeof import('ajv').default>,
  options?: unknown,
) => InstanceType<typeof import('ajv').default>;

export interface SchemaValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null | undefined;
}

type AjvInstance = InstanceType<typeof import('ajv').default>;

function defaultSchemasDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../schemas'),
    path.resolve(here, '../../schemas'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function createAjv(): AjvInstance {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  try {
    const draft6 = require('ajv/dist/refs/json-schema-draft-06.json') as object;
    ajv.addMetaSchema(draft6);
  } catch {
    // optional
  }
  addFormats(ajv);
  return ajv;
}

/**
 * OCPP 1.6 schemas are JSON Schema draft-04 (`id` instead of `$id`).
 * Normalize them so Ajv 8 can compile them.
 */
function normalizeSchema(schema: Record<string, unknown>): object {
  const copy: Record<string, unknown> = { ...schema };
  if (typeof copy.id === 'string' && copy.$id === undefined) {
    copy.$id = copy.id;
    delete copy.id;
  }
  if (typeof copy.$schema === 'string' && copy.$schema.includes('draft-04')) {
    copy.$schema = 'http://json-schema.org/draft-07/schema#';
  }
  return copy;
}

export class SchemaValidator {
  private readonly schemasDir: string;
  private readonly ajv: AjvInstance;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor(schemasDir = defaultSchemasDir()) {
    this.schemasDir = schemasDir;
    this.ajv = createAjv();
  }

  getSchemasDir(): string {
    return this.schemasDir;
  }

  validate(
    version: OcppVersion,
    action: string,
    kind: 'request' | 'response',
    payload: JsonObject,
  ): SchemaValidationResult {
    const validateFn = this.getValidator(version, action, kind);
    if (!validateFn) {
      return { valid: true, errors: null };
    }
    const valid = validateFn(payload) as boolean;
    return { valid, errors: validateFn.errors };
  }

  formatErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors?.length) return 'Payload failed schema validation';
    return errors
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
      .join('; ');
  }

  private resolveSchemaPath(
    version: OcppVersion,
    action: string,
    kind: 'request' | 'response',
  ): string | undefined {
    const dir = path.join(this.schemasDir, version);
    const candidates: string[] = [];

    if (version === '1.6') {
      candidates.push(
        kind === 'request' ? `${action}.json` : `${action}Response.json`,
      );
    } else if (kind === 'request') {
      candidates.push(`${action}Request.json`, `${action}.json`);
    } else {
      candidates.push(`${action}Response.json`);
    }

    for (const name of candidates) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
    return undefined;
  }

  private getValidator(
    version: OcppVersion,
    action: string,
    kind: 'request' | 'response',
  ): ValidateFunction | undefined {
    const cacheKey = `${version}:${action}:${kind}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const filePath = this.resolveSchemaPath(version, action, kind);
    if (!filePath) return undefined;

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >;
    const schema = normalizeSchema(raw);
    const validateFn = this.ajv.compile(schema);
    this.cache.set(cacheKey, validateFn);
    return validateFn;
  }
}
