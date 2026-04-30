// Redaction patterns. Order matters: most-specific tokens first so they
// don't get partially eaten by broader rules.
const ANTHROPIC_KEY_RE = /sk-ant-[A-Za-z0-9_-]+/g;
const OPENAI_KEY_RE = /sk-[A-Za-z0-9_-]{20,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;
const AUTH_HEADER_RE = /authorization\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const X_API_KEY_HEADER_RE = /x-api-key\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const QUERY_API_KEY_RE = /([?&](?:api[_-]?key|access[_-]?token|token))=[^&\s"']+/gi;
const REDACTED = '[REDACTED]';

/**
 * Strips common credential shapes from a string before it is logged or
 * returned to a client. Covers Anthropic / OpenAI keys, Bearer tokens,
 * `authorization` and `x-api-key` headers (in either `: value` or `=value`
 * form), and common query-string credentials (`api_key`, `access_token`,
 * `token`).
 *
 * Used by service error handlers to avoid leaking secrets via stack traces
 * and error messages.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(ANTHROPIC_KEY_RE, REDACTED)
    .replace(OPENAI_KEY_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(AUTH_HEADER_RE, `authorization: ${REDACTED}`)
    .replace(X_API_KEY_HEADER_RE, `x-api-key: ${REDACTED}`)
    .replace(QUERY_API_KEY_RE, `$1=${REDACTED}`);
}
