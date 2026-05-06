import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent, LlmMessage, LlmProvider, LlmStreamParams, LlmToolCall, LlmToolDefinition } from './types.js';

/**
 * Anthropic Claude provider.
 *
 * Uses the official `@anthropic-ai/sdk` streaming API. Maps our
 * provider-agnostic shape to Anthropic's:
 *   - `LlmMessage` → `Anthropic.MessageParam` (tool messages become
 *     `tool_result` blocks on the user role per Anthropic's API).
 *   - `LlmToolDefinition` → `Anthropic.Tool`.
 *   - Stream's `text` events → `text_delta`.
 *   - Final-message tool_use blocks → `tool_call` events emitted in
 *     order, then `message_complete`.
 *
 * Errors during the API call surface as a `text_delta` or `error`
 * event; the iterator always terminates, never hangs.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';

  async *streamChat(params: LlmStreamParams): AsyncIterable<LlmEvent> {
    const client = new Anthropic({
      apiKey: params.apiKey,
      ...(params.baseUrl ? { baseURL: params.baseUrl } : {}),
    });

    const messages = mapMessagesToAnthropic(params.messages);
    const tools = params.tools ? params.tools.map(mapToolDefinitionToAnthropic) : undefined;

    let stream;
    try {
      stream = client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
        ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
        messages,
        ...(tools ? { tools } : {}),
      });
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) };
      return;
    }

    let fullText = '';
    const queue: LlmEvent[] = [];
    let resolveNext: (() => void) | null = null;

    function push(ev: LlmEvent) {
      queue.push(ev);
      resolveNext?.();
      resolveNext = null;
    }

    stream.on('text', (text) => {
      fullText += text;
      push({ type: 'text_delta', delta: text });
    });
    stream.on('error', (err) => {
      push({ type: 'error', error: errorMessage(err) });
    });

    let finalMessage: Anthropic.Message | undefined;
    const finalPromise = stream.finalMessage().then(
      (m) => {
        finalMessage = m;
      },
      (err) => {
        push({ type: 'error', error: errorMessage(err) });
      },
    );

    // Drain text events as they fire while we wait for finalMessage.
    let done = false;
    finalPromise.finally(() => {
      done = true;
      resolveNext?.();
      resolveNext = null;
    });

    while (!done || queue.length > 0) {
      while (queue.length > 0) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
    while (queue.length > 0) yield queue.shift()!;

    if (!finalMessage) return; // error already yielded

    // Surface tool calls + the assembled message_complete.
    const toolCalls: LlmToolCall[] = [];
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        const call: LlmToolCall = {
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
        toolCalls.push(call);
        yield { type: 'tool_call', toolCall: call };
      }
    }

    const finishReason = mapFinishReason(finalMessage.stop_reason);
    yield {
      type: 'message_complete',
      finishReason,
      fullText,
      toolCalls,
    };
  }
}

function mapToolDefinitionToAnthropic(def: LlmToolDefinition): Anthropic.Tool {
  // Anthropic's Tool.input_schema is a JSON-Schema object; the only
  // hard requirement is `type: 'object'` at the root, which the
  // provider-agnostic LlmToolDefinition already implies.
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema as Anthropic.Tool['input_schema'],
  };
}

function mapMessagesToAnthropic(messages: LlmMessage[]): Anthropic.MessageParam[] {
  // Anthropic groups consecutive tool results onto a single user
  // message with tool_result blocks. We collect runs of `role: 'tool'`
  // messages and emit them as one user message. Standalone user/
  // assistant messages map 1:1.
  const out: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  function flushToolResults() {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    flushToolResults();

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }

    // Assistant: content + (optionally) tool_use blocks.
    if (m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  flushToolResults();
  return out;
}

function mapFinishReason(reason: Anthropic.Message['stop_reason']): 'stop' | 'tool_use' | 'length' | 'error' {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
