import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import type { LlmEvent, LlmProvider, LlmStreamParams } from '../src/types.js';

class StubProvider implements LlmProvider {
  constructor(public readonly name: string) {}
  async *streamChat(_params: LlmStreamParams): AsyncIterable<LlmEvent> {
    yield { type: 'message_complete', finishReason: 'stop', fullText: '', toolCalls: [] };
  }
}

describe('createProviderRegistry', () => {
  it('looks up providers by name', () => {
    const a = new StubProvider('anthropic');
    const o = new StubProvider('openai');
    const reg = createProviderRegistry([a, o]);
    expect(reg.get('anthropic')).toBe(a);
    expect(reg.get('openai')).toBe(o);
  });

  it('returns undefined for unknown providers', () => {
    const reg = createProviderRegistry([new StubProvider('anthropic')]);
    expect(reg.get('gemini')).toBeUndefined();
  });

  it("`list()` returns every registered provider", () => {
    const a = new StubProvider('anthropic');
    const o = new StubProvider('openai');
    const reg = createProviderRegistry([a, o]);
    const all = reg.list();
    expect(all).toContain(a);
    expect(all).toContain(o);
    expect(all).toHaveLength(2);
  });

  it('later registrations override earlier ones with the same name', () => {
    const a1 = new StubProvider('anthropic');
    const a2 = new StubProvider('anthropic');
    const reg = createProviderRegistry([a1, a2]);
    expect(reg.get('anthropic')).toBe(a2);
    expect(reg.list()).toHaveLength(1);
  });
});
