/**
 * CasProvider: initiate() builds the CAS redirect and issues state via the
 * shared LTI one-time-token mechanism (not a second one); complete()
 * consumes that state, validates the ticket against a (mocked) CAS server,
 * and resolves subject/name/role purely from CAS_ATTRIBUTE_MAP — never
 * hardcoded, since that's the whole point of the design.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOneTimeToken: vi.fn(),
  consumeOneTimeToken: vi.fn(),
}));

vi.mock('@/lib/lti/crypto', () => ({
  createOneTimeToken: mocks.createOneTimeToken,
  consumeOneTimeToken: mocks.consumeOneTimeToken,
}));

const { CasProvider, CasDisabledError, CasVerificationError } = await import('../cas');

const ENABLED_ENV = {
  CAS_ENABLED: 'true',
  CAS_SERVER_URL: 'https://cas.byu.edu/cas',
  CAS_SERVICE_URL: 'https://oci.example.com/api/auth/cas/callback',
};

function successXml(user: string, attributes: Record<string, string> = {}) {
  const attrLines = Object.entries(attributes)
    .map(([key, value]) => `<cas:${key}>${value}</cas:${key}>`)
    .join('');
  return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
    <cas:authenticationSuccess>
      <cas:user>${user}</cas:user>
      ${attrLines ? `<cas:attributes>${attrLines}</cas:attributes>` : ''}
    </cas:authenticationSuccess>
  </cas:serviceResponse>`;
}

function failureXml(code: string) {
  return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
    <cas:authenticationFailure code="${code}">denied</cas:authenticationFailure>
  </cas:serviceResponse>`;
}

const provider = new CasProvider();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, ENABLED_ENV);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  delete process.env.CAS_ENABLED;
  delete process.env.CAS_SERVER_URL;
  delete process.env.CAS_SERVICE_URL;
  delete process.env.CAS_ATTRIBUTE_MAP;
  vi.unstubAllGlobals();
});

describe('CasProvider.initiate', () => {
  it('throws CasDisabledError when CAS_ENABLED is not set', async () => {
    delete process.env.CAS_ENABLED;
    await expect(provider.initiate('/dashboard')).rejects.toBeInstanceOf(CasDisabledError);
    expect(mocks.createOneTimeToken).not.toHaveBeenCalled();
  });

  it('issues a state token via the shared one-time-token mechanism, purpose "state"', async () => {
    mocks.createOneTimeToken.mockResolvedValue('state-token-abc');

    await provider.initiate('/dashboard');

    expect(mocks.createOneTimeToken).toHaveBeenCalledWith('state', '/dashboard');
  });

  it('builds a redirect to {server}/login?service=... with the state embedded in the service URL', async () => {
    mocks.createOneTimeToken.mockResolvedValue('state-token-abc');

    const { redirectUrl } = await provider.initiate('/dashboard');

    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe('https://cas.byu.edu/cas/login');
    const service = new URL(url.searchParams.get('service')!);
    expect(service.origin + service.pathname).toBe('https://oci.example.com/api/auth/cas/callback');
    expect(service.searchParams.get('state')).toBe('state-token-abc');
  });
});

describe('CasProvider.complete — happy path', () => {
  it('resolves subject from cas:user by default (CAS_ATTRIBUTE_MAP unset)', async () => {
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => successXml('jdoe123'),
    });

    const result = await provider.complete({ ticket: 'ST-1', state: 'state-token-abc' });

    expect(result.provider).toBe('cas');
    expect(result.subject).toBe('jdoe123');
    expect(result.attributes.role).toBe('socio');
    expect(result.attributes.name).toBe('jdoe123'); // no name mapping configured, falls back to subject
  });

  it('resolves subject from a configured attribute instead of cas:user — the BYU-ID-not-NetID case', async () => {
    process.env.CAS_ATTRIBUTE_MAP = JSON.stringify({ subject: 'byuId', name: 'displayName' });
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => successXml('jdoe123', { byuId: '123456789', displayName: 'Jane Doe' }),
    });

    const result = await provider.complete({ ticket: 'ST-1', state: 'state-token-abc' });

    expect(result.subject).toBe('123456789');
    expect(result.attributes.name).toBe('Jane Doe');
  });

  it('falls back role to "socio" when no role mapping is configured or the value is unrecognized', async () => {
    process.env.CAS_ATTRIBUTE_MAP = JSON.stringify({ subject: 'user', role: 'affiliation' });
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => successXml('jdoe123', { affiliation: 'staff' }), // not a recognized SessionRole
    });

    const result = await provider.complete({ ticket: 'ST-1', state: 'state-token-abc' });

    expect(result.attributes.role).toBe('socio');
  });

  it('reproduces the exact service URL (state included) at the validate call', async () => {
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, text: async () => successXml('jdoe123') });

    await provider.complete({ ticket: 'ST-1', state: 'state-token-abc' });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://cas.byu.edu/cas/p3/serviceValidate');
    const service = new URL(calledUrl.searchParams.get('service')!);
    expect(service.searchParams.get('state')).toBe('state-token-abc');
    expect(calledUrl.searchParams.get('ticket')).toBe('ST-1');
  });
});

describe('CasProvider.complete — failure modes', () => {
  it('throws CasDisabledError when CAS_ENABLED is not set', async () => {
    delete process.env.CAS_ENABLED;
    await expect(provider.complete({ ticket: 'ST-1', state: 's' })).rejects.toBeInstanceOf(CasDisabledError);
  });

  it('rejects an invalid/replayed state without ever calling fetch', async () => {
    mocks.consumeOneTimeToken.mockResolvedValue(null);

    await expect(provider.complete({ ticket: 'ST-1', state: 'bad-state' })).rejects.toBeInstanceOf(CasVerificationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-OK HTTP response from the CAS server', async () => {
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, text: async () => '' });

    await expect(provider.complete({ ticket: 'ST-1', state: 'state-token-abc' })).rejects.toBeInstanceOf(CasVerificationError);
  });

  it('rejects a CAS authenticationFailure response', async () => {
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => failureXml('INVALID_TICKET') });

    await expect(provider.complete({ ticket: 'ST-1', state: 'state-token-abc' })).rejects.toBeInstanceOf(CasVerificationError);
  });

  it('rejects when the configured subject attribute is not present in the response', async () => {
    process.env.CAS_ATTRIBUTE_MAP = JSON.stringify({ subject: 'byuId' });
    mocks.consumeOneTimeToken.mockResolvedValue({ id: 'token-row-1' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => successXml('jdoe123'), // no byuId attribute released
    });

    await expect(provider.complete({ ticket: 'ST-1', state: 'state-token-abc' })).rejects.toBeInstanceOf(CasVerificationError);
  });
});
