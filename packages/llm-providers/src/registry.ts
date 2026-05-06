import type { LlmProvider, LlmProviderRegistry } from './types.js';

/**
 * Build an `LlmProviderRegistry` from a list of provider impls.
 *
 * Lookup is by `provider.name`; later entries with the same name
 * override earlier ones, so a deployment can swap a default impl
 * (e.g., test-only mock anthropic) without forking the package.
 */
export function createProviderRegistry(providers: readonly LlmProvider[]): LlmProviderRegistry {
  const byName = new Map<string, LlmProvider>();
  for (const p of providers) byName.set(p.name, p);
  return {
    get: (name) => byName.get(name),
    list: () => Array.from(byName.values()),
  };
}
