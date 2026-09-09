/**
 * LtiProvider: a faithful, standalone port of the identity-proving slice of
 * /api/lti/launch's POST handler (state/nonce replay check, id_token
 * signature/issuer/audience, version, message type, deployment and
 * target-link match). Nothing here is wired into the live route yet — see
 * the file's own header for why that's L1.d's job, not this test's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeOneTimeToken: vi.fn(),
  ltiPlatformFindUnique: vi.fn(),
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('@/lib/lti/crypto', () => ({ consumeOneTimeToken: mocks.consumeOneTimeToken }));
vi.mock('@/lib/repo/ltiRuntimeRepo', () => ({
  ltiRuntimeRepo: { ltiPlatform: { findUnique: mocks.ltiPlatformFindUnique } },
}));
vi.mock('jose', () => ({
  jwtVerify: mocks.jwtVerify,
  createRemoteJWKSet: mocks.createRemoteJWKSet,
}));

const { LtiProvider, LtiLaunchVerificationError } = await import('../lti');
const {
  LTI_VERSION_CLAIM,
  LTI_MESSAGE_TYPE_CLAIM,
  LTI_DEPLOYMENT_CLAIM,
  LTI_TARGET_LINK_CLAIM,
  LTI_ROLES_CLAIM,
} = await import('@/lib/lti/constants');

const provider = new LtiProvider();
const TARGET_LINK = 'https://oci.example/lti/launch';

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    [LTI_VERSION_CLAIM]: '1.3.0',
    [LTI_MESSAGE_TYPE_CLAIM]: 'LtiResourceLinkRequest',
    [LTI_DEPLOYMENT_CLAIM]: 'deployment-ext-1',
    [LTI_TARGET_LINK_CLAIM]: TARGET_LINK,
    [LTI_ROLES_CLAIM]: ['http://purl.imsglobal.org/vocab/lis/v2/membership/Learner'],
    nonce: 'nonce-value',
    sub: 'canvas-sub-1',
    name: 'Ana Learner',
    ...overrides,
  };
}

function mockStateAndNonce() {
  mocks.consumeOneTimeToken
    .mockResolvedValueOnce({
      deployment: { platform: { id: 'platform-1' } },
      targetLinkUri: TARGET_LINK,
    })
    .mockResolvedValueOnce({
      deployment: { platformId: 'platform-1' },
      targetLinkUri: TARGET_LINK,
    });
}

function setupHappyPath(claimsOverrides: Record<string, unknown> = {}) {
  mockStateAndNonce();
  mocks.ltiPlatformFindUnique.mockResolvedValue({
    id: 'platform-1',
    jwksUrl: 'https://canvas.example/api/lti/security/jwks',
    issuer: 'https://canvas.example',
    clientId: 'client-1',
    deployments: [{ id: 'deployment-1', deploymentId: 'deployment-ext-1', platformId: 'platform-1' }],
  });
  mocks.jwtVerify.mockResolvedValue({ payload: baseClaims(claimsOverrides) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LtiProvider.complete — happy path', () => {
  it('returns provider "lti", subject from claims.sub, role "socio" for a Learner launch', async () => {
    setupHappyPath();

    const result = await provider.complete({ idToken: 'id-token', stateValue: 'state-value' });

    expect(result.provider).toBe('lti');
    expect(result.subject).toBe('canvas-sub-1');
    expect(result.attributes.role).toBe('socio');
    expect(result.attributes.name).toBe('Ana Learner');
  });

  it('maps an Instructor role to "mentor", matching provisionLaunch\'s own instructorRole check', async () => {
    setupHappyPath({ [LTI_ROLES_CLAIM]: ['http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor'] });

    const result = await provider.complete({ idToken: 'id-token', stateValue: 'state-value' });

    expect(result.attributes.role).toBe('mentor');
  });

  it('maps a TeachingAssistant role to "mentor" too', async () => {
    setupHappyPath({ [LTI_ROLES_CLAIM]: ['http://purl.imsglobal.org/vocab/lis/v2/membership/TeachingAssistant'] });

    const result = await provider.complete({ idToken: 'id-token', stateValue: 'state-value' });

    expect(result.attributes.role).toBe('mentor');
  });

  it('falls back to given_name, then "Canvas user", when name is absent', async () => {
    setupHappyPath({ name: undefined, given_name: 'Given' });
    let result = await provider.complete({ idToken: 'id-token', stateValue: 'state-value' });
    expect(result.attributes.name).toBe('Given');

    setupHappyPath({ name: undefined, given_name: undefined });
    result = await provider.complete({ idToken: 'id-token', stateValue: 'state-value' });
    expect(result.attributes.name).toBe('Canvas user');
  });
});

describe('LtiProvider.complete — verification failures all raise LtiLaunchVerificationError', () => {
  it('rejects a replayed/invalid state', async () => {
    mocks.consumeOneTimeToken.mockResolvedValueOnce(null);

    await expect(
      provider.complete({ idToken: 'id-token', stateValue: 'bad-state' }),
    ).rejects.toBeInstanceOf(LtiLaunchVerificationError);
    expect(mocks.ltiPlatformFindUnique).not.toHaveBeenCalled();
  });

  it('rejects when the platform lookup comes back empty (inactive/unavailable)', async () => {
    mockStateAndNonce();
    mocks.ltiPlatformFindUnique.mockResolvedValue(null);

    await expect(
      provider.complete({ idToken: 'id-token', stateValue: 'state-value' }),
    ).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('wraps a jwtVerify failure (bad signature/issuer/audience) rather than letting it escape raw', async () => {
    mockStateAndNonce();
    mocks.ltiPlatformFindUnique.mockResolvedValue({
      id: 'platform-1',
      jwksUrl: 'https://canvas.example/api/lti/security/jwks',
      issuer: 'https://canvas.example',
      clientId: 'client-1',
      deployments: [{ id: 'deployment-1', deploymentId: 'deployment-ext-1', platformId: 'platform-1' }],
    });
    mocks.jwtVerify.mockRejectedValue(new Error('signature verification failed'));

    await expect(
      provider.complete({ idToken: 'id-token', stateValue: 'state-value' }),
    ).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects an unsupported LTI version', async () => {
    setupHappyPath({ [LTI_VERSION_CLAIM]: '1.1' });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects an unsupported message type', async () => {
    setupHappyPath({ [LTI_MESSAGE_TYPE_CLAIM]: 'SomethingElse' });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects a deployment_id in the id_token that does not match the state\'s deployment', async () => {
    setupHappyPath({ [LTI_DEPLOYMENT_CLAIM]: 'some-other-deployment' });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects a target_link_uri that does not match the one bound to the state', async () => {
    setupHappyPath({ [LTI_TARGET_LINK_CLAIM]: 'https://oci.example/lti/launch-different' });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects a missing/non-string nonce claim', async () => {
    setupHappyPath({ nonce: undefined });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects when the nonce one-time-token has already been consumed (replay)', async () => {
    mocks.consumeOneTimeToken
      .mockResolvedValueOnce({ deployment: { platform: { id: 'platform-1' } }, targetLinkUri: TARGET_LINK })
      .mockResolvedValueOnce(null); // nonce replayed
    mocks.ltiPlatformFindUnique.mockResolvedValue({
      id: 'platform-1',
      jwksUrl: 'https://canvas.example/api/lti/security/jwks',
      issuer: 'https://canvas.example',
      clientId: 'client-1',
      deployments: [{ id: 'deployment-1', deploymentId: 'deployment-ext-1', platformId: 'platform-1' }],
    });
    mocks.jwtVerify.mockResolvedValue({ payload: baseClaims() });

    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });

  it('rejects a missing sub claim', async () => {
    setupHappyPath({ sub: undefined });
    await expect(provider.complete({ idToken: 'id-token', stateValue: 'state-value' })).rejects.toBeInstanceOf(LtiLaunchVerificationError);
  });
});
