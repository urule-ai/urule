"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/useAuthStore";
import { useChatStore } from "@/store/useChatStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Message, Conversation, Agent, WSEvent, ActionButton } from "@/types";

// ── Simple markdown renderer ──────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    // Fenced code blocks
    if (lines[i].startsWith("```")) {
      const lang = lines[i].slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre
          key={`code-${nodes.length}`}
          className="bg-black/40 border border-border-dark rounded-lg p-3 my-2 overflow-x-auto"
        >
          {lang && (
            <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">
              {lang}
            </span>
          )}
          <code className="text-xs font-mono text-emerald-400">{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const line = lines[i];
    i++;

    // Blank lines
    if (!line.trim()) {
      nodes.push(<br key={`br-${nodes.length}`} />);
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes = ["text-lg font-bold", "text-base font-bold", "text-sm font-semibold", "text-sm font-medium"];
      nodes.push(
        <p key={`h-${nodes.length}`} className={`${sizes[level - 1]} mt-2 mb-1`}>
          {renderInline(headerMatch[2])}
        </p>
      );
      continue;
    }

    // Bullet list items
    if (line.match(/^\s*[-*]\s+/)) {
      nodes.push(
        <div key={`li-${nodes.length}`} className="flex gap-2 ml-2">
          <span className="text-text-muted select-none">&bull;</span>
          <span>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</span>
        </div>
      );
      continue;
    }

    // Normal paragraph
    nodes.push(
      <p key={`p-${nodes.length}`} className="whitespace-pre-wrap">
        {renderInline(line)}
      </p>
    );
  }

  return nodes;
}

/** Handles bold, italic, inline code, and links within a line. */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Regex order: inline code, bold, italic, link
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[1]) {
      // inline code
      parts.push(
        <code key={`ic-${parts.length}`} className="bg-black/30 text-emerald-400 px-1 py-0.5 rounded text-xs font-mono">
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      // bold
      parts.push(<strong key={`b-${parts.length}`}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      // italic
      parts.push(<em key={`i-${parts.length}`}>{match[3].slice(1, -1)}</em>);
    } else if (match[4] && match[5]) {
      // link
      parts.push(
        <a
          key={`a-${parts.length}`}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {match[4]}
        </a>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

// ── Action buttons ──────────────────────────────────────────────────────────

function ActionButtons({
  buttons,
  onAction,
  disabled,
}: {
  buttons: ActionButton[];
  onAction: (button: ActionButton) => void;
  disabled?: boolean;
}) {
  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border-dark/50">
      {buttons.map((btn, i) => (
        <button
          key={i}
          onClick={() => onAction(btn)}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-50",
            btn.style === "primary"
              ? "bg-primary text-background-dark hover:bg-primary/90 shadow-lg shadow-primary/20"
              : "bg-surface-dark border border-border-dark text-text-muted hover:bg-surface-dark/80 hover:border-primary/30"
          )}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

// ── Message bubble components ─────────────────────────────────────────────────

function AgentMessage({
  message,
  agent,
  streamingContent,
  onAction,
  actionPending,
}: {
  message: Message;
  agent?: Agent;
  streamingContent?: string;
  onAction?: (button: ActionButton) => void;
  actionPending?: boolean;
}) {
  const accent = agent?.accent_color ?? "#0db9f2";
  const isStreaming = message.status === "streaming";
  const content = isStreaming ? (streamingContent ?? "") : message.content;

  return (
    <div className="flex items-start gap-4 max-w-3xl">
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="size-10 rounded-full flex items-center justify-center border-2"
          style={{
            background: `${accent}20`,
            borderColor: `${accent}40`,
          }}
        >
          <span className="icon text-sm" style={{ color: accent }}>
            smart_toy
          </span>
        </div>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background-dark",
            isStreaming ? "bg-primary animate-pulse" : "bg-accent-success"
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold" style={{ color: accent }}>
            {agent?.name ?? "Agent"}
          </span>
          {agent?.category && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: `${accent}15`, color: accent }}
            >
              {agent.category}
            </span>
          )}
          {agent?.model_provider && (
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border",
              agent.model_provider.provider === "claude" && "bg-amber-500/10 text-amber-500 border-amber-500/20",
              agent.model_provider.provider === "openai" && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
              agent.model_provider.provider === "lmstudio" && "bg-purple-500/10 text-purple-400 border-purple-500/20",
              agent.model_provider.provider === "openrouter" && "bg-pink-500/10 text-pink-400 border-pink-500/20",
            )}>
              {agent.model_provider.provider === "lmstudio" ? "local" : agent.model_provider.provider}
            </span>
          )}
          <span className="text-[10px] text-slate-500">
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {/* Bubble */}
        <div className="glass-panel rounded-2xl rounded-tl-none p-4 text-sm leading-relaxed">
          {isStreaming && !content ? (
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            <div className="space-y-1">{renderMarkdown(content ?? "")}</div>
          )}
          {/* Inline action buttons (approve/deny hiring, accept/reject task) */}
          {message.action_buttons?.length > 0 && onAction && (
            <ActionButtons
              buttons={message.action_buttons}
              onAction={onAction}
              disabled={actionPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HumanMessage({ message, status = "delivered" }: { message: Message; status?: "sending" | "sent" | "delivered" }) {
  return (
    <div className="flex items-start gap-4 max-w-3xl ml-auto flex-row-reverse">
      <div className="size-10 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center shrink-0">
        <span className="icon text-sm text-primary">person</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-row-reverse">
          <span className="text-sm font-bold">You</span>
          <span className="text-[10px] text-slate-500">
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="bg-primary text-background-dark rounded-2xl rounded-tr-none p-4 text-sm font-medium shadow-lg shadow-primary/10">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {/* Delivery status */}
        <div className="flex items-center justify-end gap-1 mt-1 pr-1">
          {status === "sending" && (
            <span className="icon text-[11px] text-slate-500 animate-spin">progress_activity</span>
          )}
          {status === "sent" && (
            <span className="icon text-[11px] text-slate-400">check</span>
          )}
          {status === "delivered" && (
            <span className="icon text-[11px] text-primary">done_all</span>
          )}
          <span className="text-[9px] text-slate-500">
            {status === "sending" ? "Sending" : status === "sent" ? "Sent" : "Delivered"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Thinking bubble ───────────────────────────────────────────────────────────

function ThinkingBubble({ text, agent }: { text: string; agent?: Agent }) {
  const accent = agent?.accent_color ?? "#0db9f2";
  return (
    <div className="flex items-start gap-4 max-w-3xl opacity-80">
      <div
        className="size-10 rounded-full flex items-center justify-center border-2 shrink-0"
        style={{ background: `${accent}20`, borderColor: `${accent}40` }}
      >
        <span className="icon text-sm animate-pulse" style={{ color: accent }}>
          psychology
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold" style={{ color: accent }}>
            {agent?.name ?? "Agent"}
          </span>
          <span className="text-[10px] text-text-muted italic">thinking...</span>
        </div>
        <div
          className="glass-panel rounded-2xl rounded-tl-none p-3 text-sm italic text-text-muted border-l-2"
          style={{ borderLeftColor: accent }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

// ── Activity line ─────────────────────────────────────────────────────────────

function ActivityLine({
  agentName,
  activityType,
  content,
  accent,
}: {
  agentName: string;
  activityType: string;
  content: string;
  accent: string;
}) {
  const icons: Record<string, string> = {
    tool_call: "build",
    observation: "visibility",
    thinking: "psychology",
  };
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-text-muted">
      <span className="icon text-xs" style={{ color: accent }}>
        {icons[activityType] ?? "bolt"}
      </span>
      <span className="font-medium" style={{ color: accent }}>
        {agentName}
      </span>
      <span className="opacity-60">&middot;</span>
      <span className="truncate">{content}</span>
    </div>
  );
}

// ── Main chat page ────────────────────────────────────────────────────────────

export default function ChatPage({ params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  const { user } = useAuthStore();
  const { streamingMessages, setStreamingDelta, clearStreaming } = useChatStore();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [thinkingAgents, setThinkingAgents] = useState<Map<string, string>>(new Map());
  const [activities, setActivities] = useState<
    { id: string; agentId: string; activityType: string; content: string }[]
  >([]);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: conversation } = useQuery<Conversation>({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.get(`/conversations/${conversationId}`).then((r) => r.data),
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<Message[]>({
    queryKey: ["messages", conversationId],
    queryFn: () =>
      api
        .get(`/conversations/${conversationId}/messages`, { params: { limit: 50 } })
        .then((r) => r.data),
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => api.get("/agents").then((r) => r.data),
  });

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Identify which agents are in this conversation (from messages)
  const participantAgentIds = new Set(
    messages.filter((m) => m.sender_type === "agent").map((m) => m.sender_id)
  );
  const participantAgents = agents.filter((a) => participantAgentIds.has(a.id));

  // WebSocket event handler
  const handleWsEvent = useCallback(
    (event: WSEvent) => {
      switch (event.type) {
        case "message.new":
          queryClient.setQueryData<Message[]>(
            ["messages", conversationId],
            (prev = []) => [...prev, event.message]
          );
          break;
        case "message.streaming":
          if (event.done) {
            clearStreaming(event.message_id);
            refetchMessages();
          } else {
            setStreamingDelta(event.message_id, event.delta);
          }
          break;
        case "agent.thinking":
          setThinkingAgents((prev) => {
            const next = new Map(prev);
            if (event.text) {
              next.set(event.agent_id, event.text);
            } else {
              next.delete(event.agent_id);
            }
            return next;
          });
          break;
        case "agent.activity": {
          const activityEntry = {
            id: `${event.agent_id}-${Date.now()}`,
            agentId: event.agent_id,
            activityType: event.activity_type,
            content: event.content,
          };
          setActivities((prev) => [...prev.slice(-19), activityEntry]);
          break;
        }
      }
    },
    [conversationId, queryClient, setStreamingDelta, clearStreaming, refetchMessages]
  );

  useWebSocket(conversationId, { onMessage: handleWsEvent });

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/conversations/${conversationId}/messages`, {
        senderId: user?.id ?? "demo-user",
        senderType: "user",
        content,
        contentType: "text",
      }),
    onSuccess: (res) => {
      queryClient.setQueryData<Message[]>(
        ["messages", conversationId],
        (prev = []) => [...prev, res.data]
      );
    },
  });

  // Action button handler (approve/deny hiring, accept/reject task)
  const actionMutation = useMutation({
    mutationFn: (button: ActionButton) =>
      api.post("/chat/action", {
        conversationId,
        actionType: button.action_type,
        payload: button.action_payload,
      }),
    onSuccess: () => {
      refetchMessages();
    },
  });

  function handleAction(button: ActionButton) {
    actionMutation.mutate(button);
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || sendMutation.isPending) return;
    setInput("");
    setPendingContent(content);
    try {
      await sendMutation.mutateAsync(content);
    } finally {
      setPendingContent(null);
    }
  }

  // Compute delivery status for user messages
  function getDeliveryStatus(index: number): "sent" | "delivered" {
    for (let j = index + 1; j < messages.length; j++) {
      if (messages[j].sender_type === "agent") return "delivered";
    }
    if (thinkingAgents.size > 0 || streamingMessages.size > 0) return "delivered";
    if (activities.length > 0) return "delivered";
    return "sent";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="icon text-primary">forum</span>
          <div>
            <h2 className="font-bold">{conversation?.title ?? "Chat"}</h2>
            <p className="text-[10px] text-text-muted uppercase tracking-widest">
              {conversation?.type}
            </p>
          </div>
        </div>
        {/* Participant badges */}
        {participantAgents.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {participantAgents.map((a) => (
                <div
                  key={a.id}
                  title={`${a.name} (${a.model_provider?.provider ?? "unknown"})`}
                  className="relative size-7 rounded-full flex items-center justify-center border-2 border-background-dark"
                  style={{ background: `${a.accent_color}30` }}
                >
                  <span className="icon text-xs" style={{ color: a.accent_color }}>
                    smart_toy
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-accent-success border border-background-dark" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-accent-success animate-pulse" />
              <span className="text-[10px] text-accent-success font-semibold uppercase tracking-wider">
                Online
              </span>
            </div>
            {participantAgents.length > 1 && (
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                <span className="icon text-xs text-accent-success">sync</span>
                collaborating
              </span>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="icon text-5xl text-text-muted">forum</span>
            <p className="mt-3 font-bold text-lg">Start the conversation</p>
            <p className="text-text-muted text-sm mt-1">
              Send a message to get your AI coworkers involved.
            </p>
          </div>
        )}
        {messages.map((msg, index) => {
          if (msg.sender_type === "user") {
            return <HumanMessage key={msg.id} message={msg} status={getDeliveryStatus(index)} />;
          }
          const streamingContent = streamingMessages.get(msg.id);
          const agent = agentMap.get(msg.sender_id);
          return (
            <AgentMessage
              key={msg.id}
              message={msg}
              agent={agent}
              streamingContent={streamingContent}
              onAction={handleAction}
              actionPending={actionMutation.isPending}
            />
          );
        })}

        {/* Optimistic pending message while sending */}
        {pendingContent && (
          <div className="flex items-start gap-4 max-w-3xl ml-auto flex-row-reverse">
            <div className="size-10 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center shrink-0">
              <span className="icon text-sm text-primary">person</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-row-reverse">
                <span className="text-sm font-bold">You</span>
                <span className="text-[10px] text-slate-500">Now</span>
              </div>
              <div className="bg-primary/80 text-background-dark rounded-2xl rounded-tr-none p-4 text-sm font-medium shadow-lg shadow-primary/10">
                <p className="whitespace-pre-wrap">{pendingContent}</p>
              </div>
              <div className="flex items-center justify-end gap-1 mt-1 pr-1">
                <span className="icon text-[11px] text-slate-500 animate-spin">progress_activity</span>
                <span className="text-[9px] text-slate-500">Sending</span>
              </div>
            </div>
          </div>
        )}

        {/* Agent activity lines */}
        {activities.slice(-5).map((a) => {
          const agent = agentMap.get(a.agentId);
          return (
            <ActivityLine
              key={a.id}
              agentName={agent?.name ?? "Agent"}
              activityType={a.activityType}
              content={a.content}
              accent={agent?.accent_color ?? "#0db9f2"}
            />
          );
        })}

        {/* Thinking bubbles */}
        {Array.from(thinkingAgents.entries()).map(([agentId, text]) => (
          <ThinkingBubble
            key={`thinking-${agentId}`}
            text={text}
            agent={agentMap.get(agentId)}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      {(thinkingAgents.size > 0 || streamingMessages.size > 0) && (
        <div className="px-6 py-2 flex items-center gap-2 border-t border-primary/5">
          <span className="flex gap-0.5">
            <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
            <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-xs text-text-muted">
            {(() => {
              const names = Array.from(thinkingAgents.keys())
                .map(id => agentMap.get(id)?.name)
                .filter(Boolean);
              if (names.length === 0) return "Agent is processing...";
              if (names.length === 1) return `${names[0]} is thinking...`;
              return `${names.join(", ")} are thinking...`;
            })()}
          </span>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-primary/10">
        {/* Quick action pills */}
        <div className="flex items-center gap-2 mb-3" role="group" aria-label="Quick actions">
          {[
            { label: "Summarize", icon: "summarize", text: "Summarize the conversation so far." },
            { label: "Assign Tasks", icon: "task_alt", text: "Assign tasks to the appropriate agents." },
            { label: "Continue", icon: "arrow_forward", text: "Continue where you left off." },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setInput(action.text);
                inputRef.current?.focus();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-dark bg-surface-dark hover:bg-primary/10 hover:border-primary/30 text-xs text-text-muted hover:text-primary transition-all active:scale-95"
            >
              <span className="icon text-xs">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              aria-label="Type a message"
              rows={1}
              className="w-full px-4 py-3 pr-12 bg-surface-dark border border-border-dark rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none max-h-40 overflow-y-auto"
              style={{ minHeight: "48px" }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            aria-label="Send message"
            className="size-12 bg-primary text-background-dark rounded-xl flex items-center justify-center hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            <span className="icon text-sm">
              {sendMutation.isPending ? "progress_activity" : "send"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
