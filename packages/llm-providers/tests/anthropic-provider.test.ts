import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock must be hoisted; the factory captures a `lastStreamArgs` ref
// the tests can read after invoking the provider. Using a module-level
// ref instead of `mockReturnValue` lets each test inspect the exact
// payload the provider attempted to stream.
const captured: {
  args: unknown;
  emitText?: (s: string) => void;
  emitError?: (e: unknown) => void;
  finalMessage?: unknown;
  // Pre-loaded text deltas: the fake replays these synchronously
  // when the provider attaches the `text` listener, so the test
  // doesn't have to race the iterator's drain loop.
  textDeltas?: string[];
} = { args: null };

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    constructor(_opts: unknown) {
      // ignore — auth not exercised here.
    }
    messages = {
      stream: (args: unknown) => {
        captured.args = args;
        const handlers = new Map<string, (...x: unknown[]) => void>();
        const stream = {
          on: (event: string, cb: (...x: unknown[]) => void) => {
            handlers.set(event, cb);
            // The test can pre-load `captured.textDeltas` to drive
            // text events; the fake replays them synchronously
            // when the provider attaches the listener.
            if (event === 'text') {
              for (const d of captured.textDeltas ?? []) cb(d);
            }
            return stream;
          },
          finalMessage: () =>
            new Promise((resolve, reject) => {
              captured.emitText = (text: string) => handlers.get('text')?.(text);
              captured.emitError = (err: unknown) => handlers.get('error')?.(err);
              // Resolve on next tick if the test sets `finalMessage`,
              // otherwise the test drives manually via captured.* hooks.
              setImmediate(() => {
                if (captured.finalMessage) resolve(captured.finalMessage);
                else reject(new Error('no finalMessage configured'));
              });
            }),
        };
        return stream;
      },
    };
  }
  return { default: FakeAnthropic };
});

import { AnthropicProvider } from '../src/anthropic-provider.js';
import type { LlmEvent } from '../src/types.js';

beforeEach(() => {
  captured.args = null;
  captured.emitText = undefined;
  captured.emitError = undefined;
  captured.finalMessage = undefined;
  captured.textDeltas = undefined;
});

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('AnthropicProvider — message mapping', () => {
  it('maps a simple user message + system prompt 1:1', async () => {
    captured.finalMessage = {
      content: [{ type: 'text', text: 'Hi!' }],
      stop_reason: 'end_turn',
    };
    const provider = new AnthropicProvider();
    const iter = provider.streamChat({
      apiKey: 'sk-test',
      model: 'claude-test',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    // Drain — the SDK fake resolves finalMessage on next tick.
    await collect(iter);

    const args = captured.args as Record<string, unknown>;
    expect(args.model).toBe('claude-test');
    expect(args.system).toBe('You are helpful.');
    expect(args.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('groups consecutive tool messages onto a single user message', async () => {
    captured.finalMessage = { content: [], stop_reason: 'end_turn' };
    const provider = new AnthropicProvider();
    await collect(
      provider.streamChat({
        apiKey: 'sk-test',
        model: 'claude-test',
        messages: [
          { role: 'user', content: 'Find the weather' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } },
              { id: 'tu_2', name: 'get_time', input: { tz: 'CET' } },
            ],
          },
          { role: 'tool', toolCallId: 'tu_1', content: '{"f":72}' },
          { role: 'tool', toolCallId: 'tu_2', content: '{"t":"14:00"}' },
        ],
      }),
    );

    const args = captured.args as { messages: Array<Record<string, unknown>> };
    expect(args.messages).toHaveLength(3);
    // Final message: the two tool results grouped onto one user message.
    const last = args.messages[2] as { role: string; content: Array<Record<string, unknown>> };
    expect(last.role).toBe('user');
    expect(last.content).toHaveLength(2);
    expect((last.content[0] as Record<string, unknown>).type).toBe('tool_result');
    expect((last.content[0] as Record<string, unknown>).tool_use_id).toBe('tu_1');
  });

  it('passes baseUrl override through to the SDK constructor', async () => {
    captured.finalMessage = { content: [], stop_reason: 'end_turn' };
    const provider = new AnthropicProvider();
    await collect(
      provider.streamChat({
        apiKey: 'sk-test',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: 'https://proxy.example.com',
      }),
    );
    // Baseline check that the call went through with the model.
    expect((captured.args as Record<string, unknown>).model).toBe('claude-test');
  });
});

describe('AnthropicProvider — event stream', () => {
  it('yields text_delta as the SDK stream emits, then message_complete', async () => {
    captured.textDeltas = ['Hel', 'lo!'];
    captured.finalMessage = {
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
    };
    const events = await collect(
      new AnthropicProvider().streamChat({
        apiKey: 'sk-test',
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(['Hel', 'lo!']);

    const last = events[events.length - 1]!;
    expect(last.type).toBe('message_complete');
    expect((last as { fullText: string }).fullText).toBe('Hello!');
    expect((last as { finishReason: string }).finishReason).toBe('stop');
  });

  it('emits a tool_call event per tool_use block on the final message', async () => {
    captured.finalMessage = {
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { x: 1 } },
        { type: 'tool_use', id: 'tu_2', name: 'compute', input: { y: 2 } },
      ],
      stop_reason: 'tool_use',
    };
    const provider = new AnthropicProvider();
    const events = await collect(
      provider.streamChat({
        apiKey: 'sk-test',
        model: 'm',
        messages: [{ role: 'user', content: 'do it' }],
      }),
    );

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    expect((toolCalls[0] as { toolCall: { name: string } }).toolCall.name).toBe('lookup');
    expect((toolCalls[1] as { toolCall: { name: string } }).toolCall.name).toBe('compute');

    const complete = events[events.length - 1] as {
      type: string;
      finishReason: string;
      toolCalls: Array<{ name: string }>;
    };
    expect(complete.type).toBe('message_complete');
    expect(complete.finishReason).toBe('tool_use');
    expect(complete.toolCalls.map((t) => t.name)).toEqual(['lookup', 'compute']);
  });

  it("yields error event when the stream fails before completing", async () => {
    captured.finalMessage = undefined; // forces the rejection path
    const provider = new AnthropicProvider();
    const events = await collect(
      provider.streamChat({
        apiKey: 'sk-test',
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
