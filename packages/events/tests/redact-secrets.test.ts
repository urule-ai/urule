import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redaction/redact-secrets.js';

describe('redactSecrets', () => {
  it('redacts Anthropic API keys', () => {
    expect(redactSecrets('key=sk-ant-api03-xY9Z_aBcDeFgHiJkLmNoPqRsTuVwXyZ')).toBe(
      'key=[REDACTED]',
    );
  });

  it('redacts OpenAI API keys (sk- prefix, >=20 chars)', () => {
    expect(redactSecrets('OPENAI_API_KEY=sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')).toBe(
      'OPENAI_API_KEY=[REDACTED]',
    );
  });

  it('does not redact short sk- prefixes (likely not a key)', () => {
    expect(redactSecrets('sk-short')).toBe('sk-short');
  });

  it('redacts Bearer tokens (case-insensitive)', () => {
    // When both `Authorization:` and `Bearer` are present the AUTH_HEADER and
    // BEARER patterns both fire — the resulting string is ugly
    // (`authorization: [REDACTED] [REDACTED]`) but, more importantly, the
    // raw token never survives, which is what we care about.
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig';
    const out = redactSecrets(input);
    expect(out).not.toContain('eyJhbGciOiJSUzI1NiJ9');
    expect(out).not.toContain('payload.sig');

    expect(redactSecrets('bearer abc.def.ghi')).toBe('Bearer [REDACTED]');
  });

  it('redacts authorization headers in : and = forms', () => {
    expect(redactSecrets('authorization: Token123')).toBe('authorization: [REDACTED]');
    expect(redactSecrets('authorization="Token123"')).toBe('authorization: [REDACTED]');
  });

  it('redacts x-api-key headers', () => {
    expect(redactSecrets('x-api-key: secret-value-here')).toBe('x-api-key: [REDACTED]');
  });

  it('redacts query-string credentials', () => {
    expect(redactSecrets('https://api.example.com/v1/users?api_key=abc123&name=foo')).toBe(
      'https://api.example.com/v1/users?api_key=[REDACTED]&name=foo',
    );
    expect(redactSecrets('?access_token=xyz789')).toBe('?access_token=[REDACTED]');
    expect(redactSecrets('?token=plain')).toBe('?token=[REDACTED]');
  });

  it('passes through strings with no secrets unchanged', () => {
    const safe = 'GET /api/v1/users 200 OK in 12ms';
    expect(redactSecrets(safe)).toBe(safe);
  });

  it('redacts multiple secret types in a single string', () => {
    const input =
      'POST /api/v1/x?api_key=foo authorization: Bearer eyJhbGciOiJSUzI1NiJ9 sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVw';
    const out = redactSecrets(input);
    expect(out).not.toContain('foo');
    expect(out).not.toContain('eyJhbGciOiJSUzI1NiJ9');
    expect(out).not.toContain('sk-ant-api03');
  });
});
