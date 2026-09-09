/**
 * L1.c (Auth & Login Restructure) — CAS provider, built dark.
 *
 * Ships with CAS_ENABLED unset (false) — nothing about this class runs
 * against a real server until BYU confirms CAS as the protocol and answers
 * L0.1's institutional questions. CAS 2/3 is a published protocol, so this
 * is written and tested against a mocked CAS server now rather than waiting.
 *
 * `initiate()` is provider-specific, NOT part of the shared `AuthProvider`
 * interface (see `./types.ts`'s header for why): CAS is a flow OCI starts —
 * we build the redirect to the CAS login page and own the state that
 * correlates the eventual callback with this specific attempt.
 *
 * State reuses `createOneTimeToken`/`consumeOneTimeToken`
 * (`@/lib/lti/crypto`, backed by the `LtiOneTimeToken` table) with
 * `purpose: "state"` rather than hand-rolling a second one-time-token
 * mechanism — the table's `deploymentId` column is already nullable for
 * exactly this kind of non-LTI reuse. CAS itself has no request-scoped
 * "state" parameter the way OIDC/LTI do; our state token is carried by
 * embedding it in the `service` URL's own query string, which CAS is
 * required by spec to preserve verbatim through the login/ticket round
 * trip — the same service URL (state included) is then required again at
 * ticket-validation time, which is what makes it work as a CSRF binding.
 */
import { createOneTimeToken, consumeOneTimeToken } from '@/lib/lti/crypto';
import { resolveCasConfig, CasConfigError } from '@/lib/cas/config';
import { parseCasServiceResponse } from '@/lib/cas/xml';
import type { AuthProvider, ProviderCompletionResult } from './types';
import type { SessionRole } from '../token';

export { CasConfigError };

export class CasDisabledError extends Error {
  constructor() {
    super('CAS is not enabled (set CAS_ENABLED=true and the other CAS_* variables)');
    this.name = 'CasDisabledError';
  }
}

/**
 * One shape for every way a CAS callback can fail to verify — replayed/
 * unknown state, a ticket CAS itself rejects, a malformed service response,
 * or a subject the configured `CAS_ATTRIBUTE_MAP` can't resolve. Same
 * non-disclosure discipline as `InvalidCredentialsError`/
 * `LtiLaunchVerificationError`: one error type, details in the message for
 * logs, nothing a caller should branch on.
 */
export class CasVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CasVerificationError';
  }
}

export type CasCompleteParams = {
  ticket: string;
  state: string;
};

const RECOGNIZED_ROLES: SessionRole[] = ['socio', 'mentor', 'admin', 'course_lead'];

function resolveCasField(response: { user: string; attributes: Record<string, string> }, field: string): string | undefined {
  return field === 'user' ? response.user : response.attributes[field];
}

export class CasProvider implements AuthProvider<CasCompleteParams> {
  /**
   * Builds the CAS login redirect and issues the state token. `returnTo` is
   * stored as the one-time-token's `targetLinkUri` purely for audit/debug
   * symmetry with LTI's own state rows — CAS's own service-URL matching at
   * `serviceValidate` is what actually enforces the binding, not this field.
   */
  async initiate(returnTo: string = '/'): Promise<{ redirectUrl: string }> {
    const config = resolveCasConfig();
    if (!config.enabled) throw new CasDisabledError();

    const stateToken = await createOneTimeToken('state', returnTo);
    const serviceUrl = `${config.serviceUrl}?state=${encodeURIComponent(stateToken)}`;
    const redirectUrl = `${config.serverUrl}/login?service=${encodeURIComponent(serviceUrl)}`;
    return { redirectUrl };
  }

  async complete({ ticket, state }: CasCompleteParams): Promise<ProviderCompletionResult> {
    const config = resolveCasConfig();
    if (!config.enabled) throw new CasDisabledError();

    const consumedState = await consumeOneTimeToken(state, 'state');
    if (!consumedState) {
      throw new CasVerificationError('Invalid or replayed CAS state');
    }

    // Must exactly reproduce the service URL sent at /login — CAS enforces
    // this server-side, so we must reproduce it identically or a genuine
    // ticket gets rejected as a mismatch.
    const serviceUrl = `${config.serviceUrl}?state=${encodeURIComponent(state)}`;
    const validateUrl = `${config.serverUrl}${config.validatePath}?service=${encodeURIComponent(serviceUrl)}&ticket=${encodeURIComponent(ticket)}`;

    const response = await fetch(validateUrl);
    if (!response.ok) {
      throw new CasVerificationError(`CAS service validation request failed (HTTP ${response.status})`);
    }
    const xml = await response.text();
    const parsed = parseCasServiceResponse(xml);
    if (!parsed.success) {
      throw new CasVerificationError(`CAS denied the ticket${parsed.code ? ` (${parsed.code})` : ''}`);
    }

    const subject = resolveCasField(parsed, config.attributeMap.subject);
    if (!subject) {
      throw new CasVerificationError(
        `CAS_ATTRIBUTE_MAP.subject ("${config.attributeMap.subject}") was not present in the CAS response`,
      );
    }
    const name = (config.attributeMap.name && resolveCasField(parsed, config.attributeMap.name)) || subject;
    const roleValue = config.attributeMap.role && resolveCasField(parsed, config.attributeMap.role);
    const role: SessionRole = RECOGNIZED_ROLES.includes(roleValue as SessionRole) ? (roleValue as SessionRole) : 'socio';

    return {
      provider: 'cas',
      subject,
      attributes: {
        role,
        name,
        casUser: parsed.user,
        casAttributes: parsed.attributes,
      },
    };
  }
}
