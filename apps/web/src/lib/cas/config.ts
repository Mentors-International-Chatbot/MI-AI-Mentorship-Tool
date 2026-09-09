/**
 * L1.c (Auth & Login Restructure). CAS config resolution.
 *
 * The one design choice that makes BYU's protocol answer cost five minutes
 * instead of two days: `CAS_ATTRIBUTE_MAP.subject` names WHICH field is the
 * stable identity key — the reserved value `"user"` for the top-level
 * `<cas:user>` element CAS 2/3 always return, or the name of a released
 * attribute (e.g. a BYU ID/person ID that survives a NetID change) inside
 * `<cas:attributes>`. BYU may answer with NetID, BYU ID, or person ID; as a
 * config value that answer is a deploy variable. Hardcoded, it would be a
 * change to the identity key after `Principal.@@unique([provider, subject])`
 * already has rows — a migration, not an edit.
 *
 * Resolved lazily (a function, not a module-level constant) so importing
 * this module has no side effect and CAS being disabled never throws at
 * cold start — same discipline as `token.ts`'s `resolveSecret()`.
 */
export type CasAttributeMap = {
  /** `"user"` (reserved) or the name of an attribute inside `<cas:attributes>`. */
  subject: string;
  /** Optional; falls back to the resolved subject value when absent or not released. */
  name?: string;
  /** Optional; unresolved or unrecognized values fall back to 'socio' — see CasProvider. */
  role?: string;
};

export type CasConfig =
  | { enabled: false }
  | {
      enabled: true;
      serverUrl: string;
      serviceUrl: string;
      validatePath: string;
      attributeMap: CasAttributeMap;
    };

export class CasConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CasConfigError';
  }
}

const DEFAULT_VALIDATE_PATH = '/p3/serviceValidate';

export function resolveCasConfig(): CasConfig {
  if (process.env.CAS_ENABLED !== 'true') {
    return { enabled: false };
  }

  const serverUrl = process.env.CAS_SERVER_URL;
  const serviceUrl = process.env.CAS_SERVICE_URL;
  if (!serverUrl || !serviceUrl) {
    throw new CasConfigError('CAS_ENABLED is "true" but CAS_SERVER_URL/CAS_SERVICE_URL are not both set');
  }

  let attributeMap: CasAttributeMap = { subject: 'user' };
  if (process.env.CAS_ATTRIBUTE_MAP) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(process.env.CAS_ATTRIBUTE_MAP);
    } catch (cause) {
      throw new CasConfigError('CAS_ATTRIBUTE_MAP is not valid JSON', { cause });
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { subject?: unknown }).subject !== 'string'
    ) {
      throw new CasConfigError('CAS_ATTRIBUTE_MAP must be a JSON object with at least a string "subject" field');
    }
    attributeMap = parsed as CasAttributeMap;
  }

  return {
    enabled: true,
    serverUrl: serverUrl.replace(/\/$/, ''),
    serviceUrl,
    validatePath: process.env.CAS_VALIDATE_PATH || DEFAULT_VALIDATE_PATH,
    attributeMap,
  };
}
