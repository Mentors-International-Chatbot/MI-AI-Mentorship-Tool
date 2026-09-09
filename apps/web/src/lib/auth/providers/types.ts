/**
 * L1.b (Auth & Login Restructure) — shared provider contract.
 *
 * `complete()` only. No `initiate()` here, deliberately: Password and CAS
 * are flows OCI starts — we build the redirect (CAS) or the login form
 * (Password) and own whatever pre-auth state that requires — while LTI is
 * started by the platform: Canvas calls our login-initiation endpoint and
 * we never originate the handshake. An `LtiProvider` forced to implement an
 * `initiate()` it structurally cannot have would exist only to satisfy the
 * type, and a method like that gets worked around rather than used. The
 * two providers that do drive a redirect add their own `initiate()` as a
 * provider-specific method, not a shared one — CAS's lands at L1.c.
 *
 * `complete()` only proves identity and reports what the provider knows —
 * it does not decide account linkage. The caller (a route) takes the
 * result and calls `findOrCreatePrincipal` (`../principal.ts`) itself.
 */
import type { SessionRole } from '../token';
import type { PrincipalProvider } from '../principal';

export type ProviderCompletionResult = {
  provider: PrincipalProvider;
  subject: string;
  attributes: {
    role: SessionRole;
    name: string;
    socioId?: string;
    mentorId?: string;
    /** Room for provider-specific claims (LTI context, CAS-released attributes) without widening this type. */
    [key: string]: unknown;
  };
};

export interface AuthProvider<Params> {
  complete(params: Params): Promise<ProviderCompletionResult>;
}
