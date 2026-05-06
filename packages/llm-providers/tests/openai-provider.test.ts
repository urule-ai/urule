import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: { args: unknown; chunks: unknown[] } = { args: null, chunks: [] };

vi.mock('openai', () => {
  class FakeOpenAI {
    constructor(_opts: unknown) {}
    chat = {
      completions: {
        create: async (args: unknown) => {
          captured.args = args;
          // Return an async iterable yielding the configured chunks.
          const chunks = captured.chunks;
          return {
            async *[Symbol.asyncIterator]() {
              for (const c of chunks) yield c;
            },
          };
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

import { OpenAIProvider } from '../src/openai-provider.js';
import type { LlmEvent } from '../src/types.js';

beforeEach(() => {
  captured.args = null;
  captured.chunks = [];
});

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('OpenAIProvider — message mapping', () => {
  it('prepends the system prompt as a system role message', async () => {
    captured.chunks = [
      { choices: [{ delta: { content: 'Hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];
    await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const args = captured.args as { messages: Array<Record<string, unknown>> };
    expect(args.messages).toHaveLength(2);
    expect(args.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(args.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('serialises assistant tool calls using JSON arguments', async () => {
    captured.chunks = [{ choices: [{ delta: {}, finish_reason: 'stop' }] }];
    await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [
          { role: 'user', content: 'Lookup' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'lookup', input: { q: 'cats' } }],
          },
          { role: 'tool', toolCallId: 'call_1', content: '{"hits":42}' },
        ],
      }),
    );
    const args = captured.args as { messages: Array<Record<string, unknown>> };
    const assistant = args.messages[1] as {
      role: string;
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    };
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls![0]!.function.name).toBe('lookup');
    expect(JSON.parse(assistant.tool_calls![0]!.function.arguments)).toEqual({ q: 'cats' });

    const toolMsg = args.messages[2] as Record<string, unknown>;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
  });

  it('passes tool definitions in OpenAI function format', async () => {
    captured.chunks = [{ choices: [{ delta: {}, finish_reason: 'stop' }] }];
    await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            name: 'echo',
            description: 'Echo back the input',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          },
        ],
      }),
    );
    const args = captured.args as {
      tools?: Array<{ type: string; function: { name: string; parameters: unknown } }>;
    };
    expect(args.tools).toBeDefined();
    expect(args.tools![0]!.type).toBe('function');
    expect(args.tools![0]!.function.name).toBe('echo');
  });
});

describe('OpenAIProvider — event stream', () => {
  it('emits text_delta per chunk and a message_complete at the end', async () => {
    captured.chunks = [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];
    const events = await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(['Hel', 'lo']);
    const complete = events[events.length - 1]!;
    expect(complete.type).toBe('message_complete');
    expect((complete as { fullText: string }).fullText).toBe('Hello');
    expect((complete as { finishReason: string }).finishReason).toBe('stop');
  });

  it('reassembles tool_call deltas into one tool_call event per index', async () => {
    captured.chunks = [
      // Chunk 1 — tool_call index 0 starts; first part of args.
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'lookup', arguments: '{"q":' },
                },
              ],
            },
          },
        ],
      },
      // Chunk 2 — same index, more args.
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'find cats' }],
      }),
    );
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    const tc = (toolCalls[0] as { toolCall: { id: string; name: string; input: Record<string, unknown> } }).toolCall;
    expect(tc.id).toBe('call_1');
    expect(tc.name).toBe('lookup');
    expect(tc.input).toEqual({ q: 'cats' });

    const complete = events[events.length - 1] as { type: string; finishReason: string };
    expect(complete.type).toBe('message_complete');
    expect(complete.finishReason).toBe('tool_use');
  });

  it('surfaces malformed tool-call JSON as { __raw } instead of throwing', async () => {
    captured.chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  function: { name: 'broken', arguments: '{not json' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(
      new OpenAIProvider().streamChat({
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const tc = (events.find((e) => e.type === 'tool_call') as {
      toolCall: { input: Record<string, unknown> };
    }).toolCall;
    expect(tc.input).toEqual({ __raw: '{not json' });
  });
});
