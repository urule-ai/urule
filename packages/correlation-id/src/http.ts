import { getCorrelationId } from './storage.js';
import { CORRELATION_HEADER } from './plugin.js';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export async function fetchWithCorrelation(
  input: FetchInput,
  init: FetchInit = {},
): ReturnType<typeof fetch> {
  const id = getCorrelationId();
  if (!id) {
    return fetch(input, init);
  }
  const headers = new Headers(init.headers);
  if (!headers.has(CORRELATION_HEADER)) {
    headers.set(CORRELATION_HEADER, id);
  }
  return fetch(input, { ...init, headers });
}
