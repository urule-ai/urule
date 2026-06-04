"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAuthStore } from "@/store/useAuthStore";
import { useChatStore } from "@/store/useChatStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import type { Message, Conversation, Agent, WSEvent } from "@/types";

// ── Types for meeting-specific data ──────────────────────────────────────────

interface MeetingGoal {
  id: string;
  conversation_id: string;
  text: string;
  is_complete: boolean;
  created_at: string;
}

interface SharedFile {
  id: string;
  conversation_id: string;
  filename: string;
  file_url: string;
  file_size_bytes: number | null;
  uploaded_by_type: string;
  uploaded_by_id: string;
  created_at: string;
}

interface Participant {
  id: string;
  participant_id: string;
  participant_type: "agent" | "user";
  status: string;
  joined_at: string;
}

interface MeetingSummary {
  conversation_id: string;
  summary: string | null;
}

// ── Simple markdown renderer (copied from chat page) ─────────────────────────

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
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[1]) {
      parts.push(
        <code key={`ic-${parts.length}`} className="bg-black/30 text-emerald-400 px-1 py-0.5 rounded text-xs font-mono">
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      parts.push(<strong key={`b-${parts.length}`}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      parts.push(<em key={`i-${parts.length}`}>{match[3].slice(1, -1)}</em>);
    } else if (match[4] && match[5]) {
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

// ── Message bubble components (same as chat page) ────────────────────────────

function AgentMessage({
  message,
  agent,
  streamingContent,
}: {
  message: Message;
  agent?: Agent;
  streamingContent?: string;
}) {
  const accent = agent?.accent_color ?? "#0db9f2";
  const isStreaming = message.status === "streaming";
  const content = isStreaming ? (streamingContent ?? "") : message.content;

  return (
    <div className="flex items-start gap-4 max-w-3xl">
      <div className="relative shrink-0">
        <div
          className="size-10 rounded-full flex items-center justify-center border-2"
          style={{ background: `${accent}20`, borderColor: `${accent}40` }}
        >
          <span className="icon text-sm" style={{ color: accent }}>smart_toy</span>
        </div>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background-dark",
            isStreaming ? "bg-primary animate-pulse" : "bg-accent-success"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
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
          <span className="text-[10px] text-slate-500">
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
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
        </div>
      </div>
    </div>
  );
}

function HumanMessage({ message }: { message: Message }) {
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
      </div>
    </div>
  );
}

function ThinkingBubble({ text, agent }: { text: string; agent?: Agent }) {
  const accent = agent?.accent_color ?? "#0db9f2";
  return (
    <div className="flex items-start gap-4 max-w-3xl opacity-80">
      <div
        className="size-10 rounded-full flex items-center justify-center border-2 shrink-0"
        style={{ background: `${accent}20`, borderColor: `${accent}40` }}
      >
        <span className="icon text-sm animate-pulse" style={{ color: accent }}>psychology</span>
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

// ── File icon helper ─────────────────────────────────────────────────────────

function fileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "picture_as_pdf",
    doc: "description",
    docx: "description",
    xls: "table_chart",
    xlsx: "table_chart",
    csv: "table_chart",
    png: "image",
    jpg: "image",
    jpeg: "image",
    svg: "image",
    json: "data_object",
    ts: "code",
    tsx: "code",
    js: "code",
    py: "code",
    md: "article",
  };
  return map[ext] ?? "insert_drive_file";
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Main meeting chat page ───────────────────────────────────────────────────

export default function MeetingChatPage({ params }: { params: { id: string } }) {
  const meetingId = params.id;
  const { user } = useAuthStore();
  const { streamingMessages, setStreamingDelta, clearStreaming } = useChatStore();
  const queryClient = useQueryClient();

  const [input, setInput] = useState("");
  const [newGoalText, setNewGoalText] = useState("");
  const [thinkingAgents, setThinkingAgents] = useState<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: conversation } = useQuery<Conversation>({
    queryKey: ["conversation", meetingId],
    queryFn: () => api.get(`/conversations/${meetingId}`).then((r) => r.data),
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<Message[]>({
    queryKey: ["messages", meetingId],
    queryFn: () =>
      api
        .get(`/conversations/${meetingId}/messages`, { params: { limit: 50 } })
        .then((r) => r.data),
  });

  const workspaceId = useWorkspaceId();
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data),
    enabled: !!workspaceId,
  });

  const { data: goals = [], refetch: refetchGoals } = useQuery<MeetingGoal[]>({
    queryKey: ["meeting-goals", meetingId],
    queryFn: () => api.get(`/conversations/${meetingId}/goals`).then((r) => r.data),
  });

  const { data: files = [] } = useQuery<SharedFile[]>({
    queryKey: ["meeting-files", meetingId],
    queryFn: () => api.get(`/conversations/${meetingId}/files`).then((r) => r.data),
  });

  const { data: participants = [] } = useQuery<Participant[]>({
    queryKey: ["meeting-participants", meetingId],
    queryFn: () => api.get(`/conversations/${meetingId}/participants`).then((r) => r.data),
  });

  const { data: summary } = useQuery<MeetingSummary>({
    queryKey: ["meeting-summary", meetingId],
    queryFn: () => api.get(`/conversations/${meetingId}/summary`).then((r) => r.data),
    refetchInterval: 30000, // refresh summary every 30s
  });

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Derive participant agents and users
  const participantAgents = participants
    .filter((p) => p.participant_type === "agent")
    .map((p) => ({ ...p, agent: agentMap.get(p.participant_id) }));
  const participantUsers = participants.filter((p) => p.participant_type === "user");

  // ── WebSocket ────────────────────────────────────────────────────────────

  const handleWsEvent = useCallback(
    (event: WSEvent) => {
      switch (event.type) {
        case "message.new":
          queryClient.setQueryData<Message[]>(
            ["messages", meetingId],
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
        case "participant.status":
          queryClient.invalidateQueries({ queryKey: ["meeting-participants", meetingId] });
          break;
      }
    },
    [meetingId, queryClient, setStreamingDelta, clearStreaming, refetchMessages]
  );

  useWebSocket(meetingId, { onMessage: handleWsEvent });

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/conversations/${meetingId}/messages`, { content, content_type: "text" }),
    onSuccess: (res) => {
      queryClient.setQueryData<Message[]>(
        ["messages", meetingId],
        (prev = []) => [...prev, res.data]
      );
    },
  });

  const addGoalMutation = useMutation({
    mutationFn: (text: string) =>
      api.post(`/conversations/${meetingId}/goals`, { text }),
    onSuccess: () => {
      refetchGoals();
      setNewGoalText("");
    },
  });

  const toggleGoalMutation = useMutation({
    mutationFn: ({ goalId, is_complete }: { goalId: string; is_complete: boolean }) =>
      api.patch(`/conversations/${meetingId}/goals/${goalId}`, { is_complete }),
    onSuccess: () => refetchGoals(),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleSend() {
    const content = input.trim();
    if (!content || sendMutation.isPending) return;
    setInput("");
    await sendMutation.mutateAsync(content);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleAddGoal() {
    const title = newGoalText.trim();
    if (!title || addGoalMutation.isPending) return;
    addGoalMutation.mutate(title);
  }

  function handleGoalKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddGoal();
    }
  }

  // Format session start time
  const sessionStart = conversation?.created_at
    ? new Date(conversation.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    : null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background-dark">
      {/* Top bar */}
      <div className="px-4 py-3 border-b border-border-dark flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/office/meetings"
            className="size-8 rounded-lg bg-surface-dark border border-border-dark flex items-center justify-center hover:border-primary/40 transition-colors"
          >
            <span className="icon text-sm text-text-muted">arrow_back</span>
          </Link>
          <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="icon text-primary">groups</span>
          </div>
          <div>
            <h1 className="font-bold text-sm">{conversation?.title ?? "Meeting"}</h1>
            <p className="text-[10px] text-text-muted uppercase tracking-widest">
              {conversation?.session_label ?? "Meeting Session"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-success/10 border border-accent-success/20">
            <span className="size-2 rounded-full bg-accent-success animate-pulse" />
            <span className="text-[10px] font-bold text-accent-success uppercase tracking-wider">Live</span>
          </div>
          <span className="text-xs text-text-muted">
            {participantAgents.length + participantUsers.length} participants
          </span>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
        <aside className="w-72 border-r border-border-dark flex flex-col overflow-y-auto shrink-0 hidden lg:flex">
          <div className="p-4 space-y-5 flex-1">
            {/* Current Context */}
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                Current Context
              </h3>
              <div className="rounded-xl bg-primary/10 border border-primary/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="icon text-sm text-primary">groups</span>
                  <span className="text-sm font-bold">{conversation?.title ?? "Meeting"}</span>
                </div>
                {conversation?.session_label && (
                  <p className="text-xs text-text-muted">{conversation.session_label}</p>
                )}
                {sessionStart && (
                  <p className="text-[10px] text-text-muted mt-1">
                    Started at {sessionStart}
                  </p>
                )}
              </div>
            </section>

            {/* Active Goals */}
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                Active Goals
              </h3>
              <div className="space-y-1.5">
                {goals.length === 0 && (
                  <p className="text-xs text-text-muted italic">No goals set yet</p>
                )}
                {goals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() =>
                      toggleGoalMutation.mutate({
                        goalId: goal.id,
                        is_complete: !goal.is_complete,
                      })
                    }
                    className={cn(
                      "flex items-start gap-2 w-full text-left p-2 rounded-lg hover:bg-surface-dark transition-colors group",
                      goal.is_complete && "opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "icon text-sm mt-0.5 shrink-0",
                        goal.is_complete ? "text-accent-success" : "text-text-muted group-hover:text-primary"
                      )}
                    >
                      {goal.is_complete ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    <span
                      className={cn(
                        "text-xs leading-relaxed",
                        goal.is_complete && "line-through"
                      )}
                    >
                      {goal.text}
                    </span>
                  </button>
                ))}
              </div>

              {/* Add goal inline */}
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  value={newGoalText}
                  onChange={(e) => setNewGoalText(e.target.value)}
                  onKeyDown={handleGoalKeyDown}
                  placeholder="Add a goal..."
                  className="flex-1 px-2.5 py-1.5 bg-surface-dark border border-border-dark rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleAddGoal}
                  disabled={!newGoalText.trim() || addGoalMutation.isPending}
                  className="size-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  <span className="icon text-xs text-primary">add</span>
                </button>
              </div>
            </section>

            {/* Shared Files */}
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                Shared Files
              </h3>
              <div className="space-y-1">
                {files.length === 0 && (
                  <p className="text-xs text-text-muted italic">No files shared</p>
                )}
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-dark transition-colors"
                  >
                    <span className="icon text-sm text-primary">{fileIcon(file.filename)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{file.filename}</p>
                      <p className="text-[10px] text-text-muted">{formatFileSize(file.file_size_bytes)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Bottom link */}
          <div className="p-4 border-t border-border-dark">
            <Link
              href={`/office/meetings/${meetingId}`}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-dark border border-border-dark hover:border-primary/30 text-xs font-medium text-text-muted hover:text-primary transition-all w-full"
            >
              <span className="icon text-sm">menu_book</span>
              Project Docs
            </Link>
          </div>
        </aside>

        {/* ── Center Chat ───────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* System message pill */}
          {sessionStart && (
            <div className="flex justify-center py-3">
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-dark border border-border-dark">
                <span className="icon text-xs text-primary">schedule</span>
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  Sprint Session Started
                </span>
                <span className="text-[10px] text-text-muted">&bull;</span>
                <span className="text-[10px] text-text-muted">{sessionStart}</span>
              </div>
            </div>
          )}

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <span className="icon text-5xl text-text-muted">groups</span>
                <p className="mt-3 font-bold text-lg">Meeting is live</p>
                <p className="text-text-muted text-sm mt-1">
                  Send a message to kick off the discussion with your AI coworkers.
                </p>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.sender_type === "system") {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-dark/50 border border-border-dark/50">
                      <span className="icon text-xs text-text-muted">info</span>
                      <span className="text-[10px] text-text-muted">{msg.content}</span>
                    </div>
                  </div>
                );
              }
              if (msg.sender_type === "user") {
                return <HumanMessage key={msg.id} message={msg} />;
              }
              const streamingContent = streamingMessages.get(msg.id);
              const agent = agentMap.get(msg.sender_id);
              return (
                <AgentMessage
                  key={msg.id}
                  message={msg}
                  agent={agent}
                  streamingContent={streamingContent}
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

          {/* Quick action pills + input */}
          <div className="p-4 border-t border-primary/10 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              {[
                { label: "Summarize Meeting", icon: "summarize", text: "Summarize the meeting discussion so far." },
                { label: "Assign Action Items", icon: "assignment_turned_in", text: "Review the discussion and assign action items to the appropriate agents." },
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
                  rows={1}
                  className="w-full px-4 py-3 pr-12 bg-surface-dark border border-border-dark rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none max-h-40 overflow-y-auto"
                  style={{ minHeight: "48px" }}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMutation.isPending}
                className="size-12 bg-primary text-background-dark rounded-xl flex items-center justify-center hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50 shrink-0"
              >
                <span className="icon text-sm">
                  {sendMutation.isPending ? "progress_activity" : "send"}
                </span>
              </button>
            </div>
          </div>
        </main>

        {/* ── Right Sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-64 border-l border-border-dark flex flex-col overflow-y-auto shrink-0 hidden xl:flex">
          <div className="p-4 space-y-5 flex-1">
            {/* Participants — Agents */}
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                Participants
              </h3>
              <div className="space-y-1">
                {participantAgents.length === 0 && (
                  <p className="text-xs text-text-muted italic">No agents in meeting</p>
                )}
                {participantAgents.map((p) => {
                  const agent = p.agent;
                  const accent = agent?.accent_color ?? "#0db9f2";
                  const statusColor =
                    p.status === "active" || p.status === "thinking"
                      ? "bg-accent-success"
                      : p.status === "busy"
                      ? "bg-accent-warning"
                      : "bg-text-muted";

                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-dark transition-colors"
                    >
                      <div className="relative shrink-0">
                        <div
                          className="size-8 rounded-full flex items-center justify-center border"
                          style={{ background: `${accent}20`, borderColor: `${accent}30` }}
                        >
                          <span className="icon text-xs" style={{ color: accent }}>smart_toy</span>
                        </div>
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background-dark",
                            statusColor
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: accent }}>
                          {agent?.name ?? "Agent"}
                        </p>
                        <p className="text-[10px] text-text-muted capitalize">{p.status}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Participants — Humans */}
            {participantUsers.length > 0 && (
              <section>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                  Humans
                </h3>
                <div className="space-y-1">
                  {participantUsers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-dark transition-colors"
                    >
                      <div className="relative shrink-0">
                        <div className="size-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                          <span className="icon text-xs text-primary">person</span>
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background-dark bg-accent-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">
                          {p.participant_id === user?.id ? "You" : "Team Member"}
                        </p>
                        <p className="text-[10px] text-text-muted capitalize">{p.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quick Summary */}
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                Quick Summary
              </h3>
              {summary?.summary ? (
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="icon text-primary text-sm">info</span>
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider">AI Summary</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-text-muted">{summary.summary}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-center">
                  <span className="icon text-lg text-text-muted">auto_awesome</span>
                  <p className="text-[10px] text-text-muted mt-1">
                    Summary will appear once the discussion gets going
                  </p>
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
