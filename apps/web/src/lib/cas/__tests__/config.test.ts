import { describe, it, expect, afterEach } from 'vitest';
import { resolveCasConfig, CasConfigError } from '../config';

describe('resolveCasConfig', () => {
  afterEach(() => {
    delete process.env.CAS_ENABLED;
    delete process.env.CAS_SERVER_URL;
    delete process.env.CAS_SERVICE_URL;
    delete process.env.CAS_VALIDATE_PATH;
    delete process.env.CAS_ATTRIBUTE_MAP;
  });

  it('returns disabled when CAS_ENABLED is unset — the shipped default', () => {
    expect(resolveCasConfig()).toEqual({ enabled: false });
  });

  it('returns disabled for any value other than the literal string "true"', () => {
    process.env.CAS_ENABLED = 'TRUE';
    expect(resolveCasConfig()).toEqual({ enabled: false });
  });

  it('throws CasConfigError when enabled but missing server/service URLs', () => {
    process.env.CAS_ENABLED = 'true';
    expect(() => resolveCasConfig()).toThrow(CasConfigError);
  });

  it('defaults attributeMap to {subject: "user"} and validatePath to /p3/serviceValidate', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/api/auth/cas/callback';

    expect(resolveCasConfig()).toEqual({
      enabled: true,
      serverUrl: 'https://cas.byu.edu/cas',
      serviceUrl: 'https://oci.example.com/api/auth/cas/callback',
      validatePath: '/p3/serviceValidate',
      attributeMap: { subject: 'user' },
    });
  });

  it('strips a trailing slash from CAS_SERVER_URL so path concatenation never double-slashes', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas/';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/callback';

    const config = resolveCasConfig();
    expect(config.enabled && config.serverUrl).toBe('https://cas.byu.edu/cas');
  });

  it('parses CAS_ATTRIBUTE_MAP — this is the config, not code, decision the whole design turns on', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/callback';
    process.env.CAS_ATTRIBUTE_MAP = JSON.stringify({ subject: 'byuId', name: 'displayName' });

    const config = resolveCasConfig();
    expect(config.enabled && config.attributeMap).toEqual({ subject: 'byuId', name: 'displayName' });
  });

  it('respects a custom CAS_VALIDATE_PATH for a CAS 2.0-only server', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/callback';
    process.env.CAS_VALIDATE_PATH = '/serviceValidate';

    const config = resolveCasConfig();
    expect(config.enabled && config.validatePath).toBe('/serviceValidate');
  });

  it('throws CasConfigError on invalid JSON in CAS_ATTRIBUTE_MAP', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/callback';
    process.env.CAS_ATTRIBUTE_MAP = '{not valid json';

    expect(() => resolveCasConfig()).toThrow(CasConfigError);
  });

  it('throws CasConfigError when CAS_ATTRIBUTE_MAP is valid JSON but missing "subject"', () => {
    process.env.CAS_ENABLED = 'true';
    process.env.CAS_SERVER_URL = 'https://cas.byu.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://oci.example.com/callback';
    process.env.CAS_ATTRIBUTE_MAP = JSON.stringify({ name: 'displayName' });

    expect(() => resolveCasConfig()).toThrow(CasConfigError);
  });
});
