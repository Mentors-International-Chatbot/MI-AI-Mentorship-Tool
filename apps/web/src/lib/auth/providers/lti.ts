/**
 * L1.b (Auth & Login Restructure) — LTI provider, built dark.
 *
 * "Wraps what exists" for LTI means something narrower than for password:
 * unlike PasswordProvider, this class is not called by anything live yet.
 * /api/lti/launch keeps its own inline verification and its own session
 * mechanism (LtiSession + sessionStorage bearer token, never the mi_session
 * cookie — see reports/l0-auth-login-investigation.md's "LTI bootstrap and
 * cookie behavior" finding) exactly as it is today. Rewiring that live,
 * working, iframe-sensitive flow onto Principal without a real Canvas to
 * launch against is L1.d's job ("LTI verification on your own Canvas ...
 * and the four-browser matrix"), not this one's.
 *
 * `complete()` is a faithful port of ONLY the identity-proving slice of
 * /api/lti/launch's POST handler: id_token signature/issuer/audience,
 * version, message type, deployment match, target-link match, and the
 * state/nonce one-time-token replay check. It deliberately stops short of
 * the LtiContext lookup, course-version/delivery checks, deep-linking and
 * resource-link handling, and provisionLaunch/createLtiSession — those are
 * "is this launch usable" (authorization/provisioning) and "how do we
 * respond" concerns layered on top of "is this really Canvas," the same
 * boundary PasswordProvider draws by returning as soon as the account is
 * verified rather than deciding what the caller does with it.
 *
 * `role`/`name` come straight from the id_token's own claims (roles, name/
 * given_name) exactly as provisionLaunch already reads them today — no new
 * behavior, just read earlier and returned instead of used inline.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ltiRuntimeRepo } from '@/lib/repo/ltiRuntimeRepo';
import { consumeOneTimeToken } from '@/lib/lti/crypto';
import {
  LTI_DEPLOYMENT_CLAIM,
  LTI_MESSAGE_TYPE_CLAIM,
  LTI_ROLES_CLAIM,
  LTI_TARGET_LINK_CLAIM,
  LTI_VERSION_CLAIM,
} from '@/lib/lti/constants';
import type { AuthProvider, ProviderCompletionResult } from './types';

export type LtiCompleteParams = {
  idToken: string;
  stateValue: string;
};

/**
 * One shape for every way an LTI launch can fail to verify — replayed
 * state/nonce, signature/issuer/audience mismatch, wrong version, wrong
 * message type, deployment mismatch, target-link mismatch. Callers that
 * need to distinguish these for logging can read `cause`; nothing about
 * this type promises a stable reason string to branch on, same as
 * `InvalidCredentialsError`'s refusal to disclose which half of a login
 * failed.
 */
export class LtiLaunchVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LtiLaunchVerificationError';
  }
}

function instructorRole(roles: string[]): boolean {
  return roles.some((role) => role.endsWith('/Instructor') || role.endsWith('/TeachingAssistant'));
}

export class LtiProvider implements AuthProvider<LtiCompleteParams> {
  async complete({ idToken, stateValue }: LtiCompleteParams): Promise<ProviderCompletionResult> {
    const state = await consumeOneTimeToken(stateValue, 'state');
    if (!state?.deployment?.platform) {
      throw new LtiLaunchVerificationError('Invalid or replayed launch state');
    }

    const platform = await ltiRuntimeRepo.ltiPlatform.findUnique({
      where: { id: state.deployment.platform.id },
      include: { deployments: { where: { active: true } } },
    });
    if (!platform) {
      throw new LtiLaunchVerificationError('LTI platform is inactive or unavailable');
    }

    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, createRemoteJWKSet(new URL(platform.jwksUrl)), {
        issuer: platform.issuer,
        audience: platform.clientId,
      });
      claims = verified.payload as Record<string, unknown>;
    } catch (cause) {
      throw new LtiLaunchVerificationError('LTI id_token failed signature/issuer/audience verification', { cause });
    }

    if (claims[LTI_VERSION_CLAIM] !== '1.3.0') {
      throw new LtiLaunchVerificationError('Unsupported LTI version');
    }
    const messageType = claims[LTI_MESSAGE_TYPE_CLAIM];
    if (messageType !== 'LtiResourceLinkRequest' && messageType !== 'LtiDeepLinkingRequest') {
      throw new LtiLaunchVerificationError('Unsupported LTI message type');
    }

    const deploymentId = claims[LTI_DEPLOYMENT_CLAIM];
    const deployment = typeof deploymentId === 'string'
      ? platform.deployments.find((item) => item.deploymentId === deploymentId)
      : undefined;
    if (!deployment) {
      throw new LtiLaunchVerificationError('Deployment mismatch');
    }
    if (claims[LTI_TARGET_LINK_CLAIM] !== state.targetLinkUri) {
      throw new LtiLaunchVerificationError('Target link mismatch');
    }
    if (typeof claims.nonce !== 'string') {
      throw new LtiLaunchVerificationError('Invalid or replayed nonce');
    }
    const nonce = await consumeOneTimeToken(claims.nonce, 'nonce');
    if (!nonce || nonce.deployment?.platformId !== platform.id || nonce.targetLinkUri !== state.targetLinkUri) {
      throw new LtiLaunchVerificationError('Invalid or replayed nonce');
    }
    if (typeof claims.sub !== 'string') {
      throw new LtiLaunchVerificationError('Missing platform subject');
    }

    const roles = Array.isArray(claims[LTI_ROLES_CLAIM])
      ? (claims[LTI_ROLES_CLAIM] as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];
    const names = claims.name ?? claims.given_name ?? 'Canvas user';
    const displayName = typeof names === 'string' ? names : 'Canvas user';

    return {
      provider: 'lti',
      subject: claims.sub,
      attributes: {
        role: instructorRole(roles) ? 'mentor' : 'socio',
        name: displayName,
        messageType,
        roles,
        deploymentId: deployment.id,
        platformId: platform.id,
        claims,
      },
    };
  }
}
