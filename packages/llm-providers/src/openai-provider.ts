import OpenAI from 'openai';
import type {
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmStreamParams,
  LlmToolCall,
  LlmToolDefinition,
} from './types.js';

/**
 * OpenAI Chat Completions provider.
 *
 * Uses the official `openai` SDK's streaming chat-completions API.
 * Maps our provider-agnostic shape to OpenAI's:
 *   - `LlmMessage` → `ChatCompletionMessageParam` (system / user /
 *     assistant / tool roles).
 *   - `LlmToolDefinition` → `ChatCompletionTool` (a function-shaped
 *     object — OpenAI uses `type: 'function'` everywhere).
 *   - Stream chunks with `choices[].delta.content` → `text_delta`.
 *   - Tool call deltas accumulate during the stream; we emit one
 *     `tool_call` event per assembled call after the stream
 *     completes (matches Anthropic's "tool_use blocks live on the
 *     final message" timing so adapters don't have to special-case).
 *
 * The `baseUrl` param is wired through, so the same provider serves
 * Ollama / vLLM / any OpenAI-compatible local server with no code
 * change — just a different URL.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';

  async *streamChat(params: LlmStreamParams): AsyncIterable<LlmEvent> {
    const client = new OpenAI({
      apiKey: params.apiKey,
      ...(params.baseUrl ? { baseURL: params.baseUrl } : {}),
    });

    const messages = mapMessagesToOpenAI(params.systemPrompt, params.messages);
    const tools = params.tools ? params.tools.map(mapToolDefinitionToOpenAI) : undefined;

    let stream;
    try {
      stream = await client.chat.completions.create({
        model: params.model,
        ...(typeof params.maxTokens === 'number' ? { max_tokens: params.maxTokens } : {}),
        ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
        messages,
        ...(tools ? { tools } : {}),
        stream: true,
      });
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) };
      return;
    }

    let fullText = '';
    let finishReason: 'stop' | 'tool_use' | 'length' | 'error' = 'stop';

    // OpenAI streams tool_call deltas with a stable `index` — we
    // accumulate name + arguments per index, then emit one tool_call
    // event per index after the stream ends.
    const partialToolCalls = new Map<
      number,
      { id: string; name: string; argumentsBuffer: string }
    >();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          fullText += delta.content;
          yield { type: 'text_delta', delta: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = partialToolCalls.get(idx) ?? {
              id: '',
              name: '',
              argumentsBuffer: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.argumentsBuffer += tc.function.arguments;
            partialToolCalls.set(idx, existing);
          }
        }
        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);
        }
      }
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) };
      return;
    }

    const toolCalls: LlmToolCall[] = [];
    for (const partial of partialToolCalls.values()) {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = partial.argumentsBuffer ? JSON.parse(partial.argumentsBuffer) : {};
      } catch {
        // Provider can stream malformed JSON if the model truncates;
        // surface as an empty input — adapter can flag the bad call.
        parsedInput = { __raw: partial.argumentsBuffer };
      }
      const call: LlmToolCall = {
        id: partial.id,
        name: partial.name,
        input: parsedInput,
      };
      toolCalls.push(call);
      yield { type: 'tool_call', toolCall: call };
    }

    yield {
      type: 'message_complete',
      finishReason,
      fullText,
      toolCalls,
    };
  }
}

function mapToolDefinitionToOpenAI(def: LlmToolDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema as OpenAI.FunctionDefinition['parameters'],
    },
  };
}

function mapMessagesToOpenAI(
  systemPrompt: string | undefined,
  messages: LlmMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt });

  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    // Assistant
    if (m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        })),
      });
    } else {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

function mapFinishReason(reason: string): 'stop' | 'tool_use' | 'length' | 'error' {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'length';
    case 'content_filter':
    default:
      return 'stop';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
