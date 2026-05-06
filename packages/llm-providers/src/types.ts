/*
 * Provider-agnostic LLM streaming surface.
 *
 * The shape captures what every modern chat-completion API offers:
 *   - System prompt + ordered message history
 *   - Tool definitions in JSON-Schema-flavoured form
 *   - Streaming text deltas + tool calls
 *   - A "complete" event with finish reason
 *
 * Anthropic and OpenAI both fit; Gemini and local-model providers
 * (vLLM, Ollama, etc.) drop in by implementing `LlmProvider`.
 *
 * Orchestrator-specific concerns — registry I/O, WebSocket
 * broadcasts, business-logic tool execution (e.g. langgraph-adapter's
 * `hire_agent`) — stay in the adapter; this lib only knows about the
 * LLM call boundary.
 */

export type LlmRole = 'user' | 'assistant' | 'tool';

/**
 * A single message in conversation history.
 *
 * Assistant messages can carry `toolCalls` when the model decided to
 * call one or more tools instead of (or alongside) producing text.
 * Tool messages carry the result of a previous tool call, identified
 * by `toolCallId` so the model can match them to its own calls.
 */
export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/**
 * Tool definition the model is told it may call. `inputSchema` is a
 * JSON Schema document describing the tool's argument shape — Anthropic
 * and OpenAI both accept this format.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A tool call emitted by the model. `id` is provider-specific but
 * unique within the response — the adapter passes it back as
 * `LlmMessage.toolCallId` on the follow-up `role: 'tool'` message.
 */
export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Parameters for a single streaming chat completion. Stateless: every
 * call carries the full message history; the provider holds no
 * conversation state.
 */
export interface LlmStreamParams {
  /** API key issued by the provider's developer console. */
  apiKey: string;
  /** Provider-specific model identifier. */
  model: string;
  /** Optional system prompt — sent as the system role for both providers. */
  systemPrompt?: string;
  /** Conversation history (most recent last). */
  messages: LlmMessage[];
  /** Optional tools the model may call. */
  tools?: LlmToolDefinition[];
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Sampling temperature (0..1). */
  temperature?: number;
  /** Optional base URL override — for self-hosted / proxy / Ollama setups. */
  baseUrl?: string;
}

/**
 * Stream events. `text_delta` arrives incrementally while the model
 * generates; `message_complete` always fires last with the full
 * assembled text + tool-call list (the convenience replays "what I
 * just streamed" so adapters don't need to reassemble manually).
 */
export type LlmEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | {
      type: 'message_complete';
      finishReason: 'stop' | 'tool_use' | 'length' | 'error';
      fullText: string;
      toolCalls: LlmToolCall[];
    }
  | { type: 'error'; error: string };

/**
 * The contract every provider implements.
 *
 * `name` is the canonical identifier matching `providers.provider` in
 * the registry's provider table — adapters pick the right impl by
 * looking up the agent's configured provider id.
 */
export interface LlmProvider {
  /** Stable identifier — `'anthropic'`, `'openai'`, `'gemini'`, `'ollama'`, etc. */
  readonly name: string;
  /** Stream a chat completion. The async iterator must always end in either `message_complete` or `error`. */
  streamChat(params: LlmStreamParams): AsyncIterable<LlmEvent>;
}

/**
 * Lookup helper: pick an `LlmProvider` by name from a registry.
 *
 * Adapters typically build the registry once at boot:
 *   const providers = createProviderRegistry([
 *     new AnthropicProvider(),
 *     new OpenAIProvider(),
 *   ]);
 *   const provider = providers.get(agent.provider) ?? providers.get('anthropic');
 */
export interface LlmProviderRegistry {
  get(name: string): LlmProvider | undefined;
  list(): LlmProvider[];
}
