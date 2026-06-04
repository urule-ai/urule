"use client";

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types";

// Lazy-loaded sandbox components (SSR-disabled for WebSocket/xterm)
const SandboxTerminal = dynamic(() => import("@/components/agents/SandboxTerminal"), { ssr: false });
const SandboxFiles = dynamic(() => import("@/components/agents/SandboxFiles"), { ssr: false });
const SandboxDesktop = dynamic(() => import("@/components/agents/SandboxDesktop"), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────────

interface SandboxedInfo {
  workspace_id: string;
  mission_id: string | null;
  mission_status: string | null;
  harness: string;
  workspace_template: string;
}

interface HealthData {
  inference_speed_tps: number;
  context_window_used: number;
  context_window_total: number;
  uptime_seconds: number;
  sandboxed: SandboxedInfo | Record<string, never>;
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  progress_pct: number;
  progress_label: string | null;
  raci_role: string | null;
  created_at: string;
  completed_at: string | null;
}

interface MemoryItem {
  id: string;
  agent_id: string;
  content: string;
  memory_type: "episodic" | "semantic" | "procedural";
  importance: number;
  created_at: string;
}

interface AgentConversation {
  id: string;
  title: string | null;
  type: string;
  updated_at: string | null;
  other_agent_ids: string[];
  message_count: number;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_type: string | null;
}

// ── Small components ─────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  sub,
  subColor,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="glass-panel p-5 rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-surface-dark rounded-lg">
          <span className="icon text-primary">{icon}</span>
        </div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-text-muted mt-1">{label}</p>
      {sub && (
        <p className={cn("text-xs mt-1 font-medium", subColor ?? "text-text-muted")}>{sub}</p>
      )}
    </div>
  );
}

function ToolRow({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background-dark/50 border border-white/5">
      <span className={cn("icon text-sm", enabled ? "text-accent-success" : "text-slate-500")}>
        {enabled ? "check_circle" : "cancel"}
      </span>
      <span className={cn("text-xs", enabled ? "text-slate-200" : "text-slate-500 opacity-50")}>
        {name}
      </span>
    </div>
  );
}

type LogType = "THINKING" | "TOOL_CALL" | "OBSERVATION" | "TASK_COMPLETE";

const LOG_CONFIG: Record<LogType, { icon: string; color: string }> = {
  THINKING: { icon: "psychology", color: "text-primary" },
  TOOL_CALL: { icon: "construction", color: "text-accent-warning" },
  OBSERVATION: { icon: "visibility", color: "text-slate-300" },
  TASK_COMPLETE: { icon: "verified", color: "text-accent-success" },
};

function LogEntry({ type, content, timestamp }: { type: LogType; content: string; timestamp: string }) {
  const cfg = LOG_CONFIG[type];
  return (
    <div className="flex gap-3 items-start text-sm font-mono">
      <span className="text-slate-600 shrink-0 text-[11px] mt-0.5">{timestamp}</span>
      <span className={cn("icon text-sm shrink-0 mt-0.5", cfg.color)}>{cfg.icon}</span>
      <span className="text-slate-300 leading-relaxed break-words">{content}</span>
    </div>
  );
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted text-xs shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-mono truncate" title={value}>{value}</span>
        <button onClick={handleCopy} className="shrink-0 p-0.5 rounded hover:bg-white/5 transition-colors" title="Copy">
          <span className="icon text-sm text-text-muted">{copied ? "check" : "content_copy"}</span>
        </button>
      </div>
    </div>
  );
}

// ── Status / Priority helpers ────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  active:             { bg: "bg-accent-success/15", text: "text-accent-success", dot: "bg-accent-success" },
  thinking:           { bg: "bg-primary/15",        text: "text-primary",        dot: "bg-primary" },
  idle:               { bg: "bg-amber-500/15",      text: "text-amber-400",      dot: "bg-amber-400" },
  offline:            { bg: "bg-slate-500/15",       text: "text-slate-400",      dot: "bg-slate-400" },
  busy:               { bg: "bg-orange-500/15",      text: "text-orange-400",     dot: "bg-orange-400" },
  // task statuses
  in_progress:        { bg: "bg-primary/15",         text: "text-primary",        dot: "bg-primary" },
  backlog:            { bg: "bg-slate-500/15",        text: "text-slate-400",      dot: "bg-slate-400" },
  awaiting_approval:  { bg: "bg-amber-500/15",       text: "text-amber-400",      dot: "bg-amber-400" },
  completed:          { bg: "bg-accent-success/15",   text: "text-accent-success", dot: "bg-accent-success" },
  cancelled:          { bg: "bg-rose-500/15",         text: "text-rose-400",       dot: "bg-rose-400" },
  pending:            { bg: "bg-amber-500/15",        text: "text-amber-400",      dot: "bg-amber-400" },
  failed:             { bg: "bg-rose-500/15",         text: "text-rose-400",       dot: "bg-rose-400" },
  interrupted:        { bg: "bg-orange-500/15",       text: "text-orange-400",     dot: "bg-orange-400" },
  unreachable:        { bg: "bg-slate-500/15",        text: "text-slate-400",      dot: "bg-slate-400" },
  unknown:            { bg: "bg-slate-500/15",        text: "text-slate-400",      dot: "bg-slate-400" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", style.bg, style.text)}>
      <span className={cn("size-1.5 rounded-full", style.dot, (status === "active" || status === "in_progress") && "animate-pulse")} />
      {status.replace("_", " ")}
    </span>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-rose-400",
  high: "text-orange-400",
  medium: "text-amber-400",
  low: "text-slate-400",
};

const HARNESS_LABELS: Record<string, string> = {
  claudecode: "Claude Code",
  opencode: "OpenCode",
  amp: "Amp",
};

// ── Execution Environment (unchanged) ────────────────────────────────────────

function ExecutionEnvironment({ agent, health }: { agent: Agent; health: HealthData | undefined }) {
  const isSandboxed = !!agent.sandboxed_workspace_id;
  const sandbox: SandboxedInfo | null =
    health?.sandboxed && "workspace_id" in health.sandboxed ? (health.sandboxed as SandboxedInfo) : null;
  const uptimeFormatted = health ? formatUptime(health.uptime_seconds) : "--";

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="icon text-primary">deployed_code</span>
          <span className="font-bold text-sm">Execution Environment</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", isSandboxed ? "bg-primary" : "bg-accent-success")} />
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {isSandboxed ? "Sandboxed" : "Local"}
          </span>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-dark">
          <span className="icon text-lg mt-0.5 text-text-muted">{isSandboxed ? "shield" : "computer"}</span>
          <div>
            <p className="text-xs font-bold">{isSandboxed ? "Isolated sandbox via sandboxed.sh" : "Direct API execution"}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {isSandboxed
                ? "Agent runs inside a sandboxed Linux container with its own filesystem and toolchain."
                : "Agent executes locally through the AI provider API. No workspace isolation."}
            </p>
          </div>
        </div>

        {isSandboxed && (
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Sandbox Details</p>
            <div className="space-y-2.5 bg-surface-dark rounded-lg p-3">
              <CopyableValue label="Workspace ID" value={agent.sandboxed_workspace_id!} />
              {(sandbox?.mission_id || agent.sandboxed_mission_id) && (
                <CopyableValue label="Mission ID" value={(sandbox?.mission_id || agent.sandboxed_mission_id)!} />
              )}
              {sandbox?.mission_status && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted text-xs">Mission Status</span>
                  <StatusBadge status={sandbox.mission_status} />
                </div>
              )}
              {sandbox?.harness && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted text-xs">Harness</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="icon text-sm text-primary">terminal</span>
                    {HARNESS_LABELS[sandbox.harness] ?? sandbox.harness}
                  </span>
                </div>
              )}
              {sandbox?.workspace_template && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted text-xs">Template</span>
                  <span className="text-xs font-mono">{sandbox.workspace_template}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {health && (
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Health Stats</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 bg-surface-dark rounded-lg">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="icon text-sm text-primary">speed</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">Inference</span>
                </div>
                <p className="text-sm font-bold font-mono">
                  {health.inference_speed_tps > 0 ? `${health.inference_speed_tps} tok/s` : "Idle"}
                </p>
              </div>
              <div className="p-2.5 bg-surface-dark rounded-lg">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="icon text-sm text-primary">schedule</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">Uptime</span>
                </div>
                <p className="text-sm font-bold font-mono">{uptimeFormatted}</p>
              </div>
              <div className="col-span-2 p-2.5 bg-surface-dark rounded-lg">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="icon text-sm text-primary">memory</span>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider">Context Window</span>
                  </div>
                  <span className="text-[10px] font-mono text-text-muted">
                    {health.context_window_used.toLocaleString()} / {health.context_window_total.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-background-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((health.context_window_used / health.context_window_total) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── New Meeting Modal ────────────────────────────────────────────────────────

function NewMeetingModal({
  agent,
  agents,
  onClose,
  onCreated,
}: {
  agent: Agent;
  agents: Agent[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [title, setTitle] = useState(`Meeting with ${agent.name}`);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const otherAgents = agents.filter((a) => a.id !== agent.id);

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const { data } = await api.post("/conversations", {
        title,
        type: "meeting",
        participant_ids: [],
        agent_ids: [agent.id, ...selectedAgents],
      });
      onCreated(data.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg glass-panel rounded-2xl p-6 space-y-5 m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="icon text-primary text-xl">groups</span>
            <h2 className="text-lg font-bold">New Meeting</h2>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg bg-surface-dark flex items-center justify-center hover:bg-accent-dark transition-colors">
            <span className="icon text-sm">close</span>
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Meeting Title</label>
          <input
            className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Invite Agents <span className="text-text-muted font-normal">(+ {agent.name} as host)</span>
          </label>
          {otherAgents.length === 0 ? (
            <p className="text-xs text-text-muted py-3">No other agents deployed yet.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {otherAgents.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                    selectedAgents.includes(a.id)
                      ? "border-primary bg-primary/5"
                      : "border-border-dark hover:border-primary/30 bg-background-dark/40"
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={selectedAgents.includes(a.id)} onChange={() => toggleAgent(a.id)} />
                  <div
                    className="size-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${a.accent_color ?? "#0db9f2"}20` }}
                  >
                    <span className="icon text-sm" style={{ color: a.accent_color ?? "#0db9f2" }}>smart_toy</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-[10px] text-text-muted truncate">{a.role}</p>
                  </div>
                  {selectedAgents.includes(a.id) && (
                    <span className="icon text-primary text-sm">check_circle</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-background-dark font-bold py-3 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <span className="icon text-sm">groups</span>
            {creating ? "Creating..." : "Start Meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 100;

export default function AgentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<Array<{ type: LogType; content: string; timestamp: string }>>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "terminal" | "files" | "desktop">("overview");

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ["agent", params.id],
    queryFn: () => api.get(`/agents/${params.id}`).then((r) => r.data),
  });

  const { data: metrics } = useQuery<{
    task_success_rate: number;
    avg_response_time_ms: number;
    tool_calls_24h: number;
    token_usage: number;
    token_quota: number;
    total_responses: number;
    input_tokens_24h: number;
    output_tokens_24h: number;
    estimated_cost_24h: number;
  }>({
    queryKey: ["agent-metrics", params.id],
    queryFn: () => api.get(`/agents/${params.id}/metrics`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: health } = useQuery<HealthData>({
    queryKey: ["agent-health", params.id],
    queryFn: () => api.get(`/agents/${params.id}/health`).then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: tasks = [] } = useQuery<TaskItem[]>({
    queryKey: ["agent-tasks", params.id],
    queryFn: () => api.get(`/tasks?agent_id=${params.id}`).then((r) => r.data),
    refetchInterval: 15_000,
  });

  const { data: conversations = [] } = useQuery<AgentConversation[]>({
    queryKey: ["agent-conversations", params.id],
    queryFn: () => api.get(`/agents/${params.id}/conversations`).then((r) => r.data).catch(() => []),
  });

  const workspaceId = useWorkspaceId();
  const { data: allAgents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data),
    enabled: !!workspaceId,
  });

  const { data: rawLogs } = useQuery<Array<{ type: string; content: string; timestamp: string }>>({
    queryKey: ["agent-logs", params.id],
    queryFn: () => api.get(`/agents/${params.id}/logs`).then((r) => r.data).catch(() => []),
    refetchInterval: 5_000,
  });

  const { data: memories = [] } = useQuery<MemoryItem[]>({
    queryKey: ["agent-memories", params.id],
    queryFn: () => api.get(`/agents/${params.id}/memories?limit=20`).then((r) => r.data).catch(() => []),
  });

  const [addMemoryOpen, setAddMemoryOpen] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");

  const addMemory = useMutation({
    mutationFn: (content: string) =>
      api.post(`/agents/${params.id}/memories`, { content, memory_type: "semantic", importance: 0.7 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-memories", params.id] });
      setNewMemoryContent("");
      setAddMemoryOpen(false);
    },
  });

  const deleteMemory = useMutation({
    mutationFn: (memoryId: string) => api.delete(`/agents/${params.id}/memories/${memoryId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-memories", params.id] }),
  });

  // ── Log accumulation ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!rawLogs || rawLogs.length === 0) return;
    setLogEntries((prev) => {
      const existing = new Set(prev.map((e) => `${e.type}-${e.timestamp}-${e.content}`));
      const fresh = rawLogs
        .filter((e) => !existing.has(`${e.type}-${e.timestamp}-${e.content}`))
        .map((e) => ({
          type: (e.type in LOG_CONFIG ? e.type : "OBSERVATION") as LogType,
          content: e.content,
          timestamp: e.timestamp,
        }));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].slice(-MAX_LOG_ENTRIES);
    });
  }, [rawLogs]);

  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logEntries]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: (action: string) => api.post(`/agents/${params.id}/status`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", params.id] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  async function handleAction(action: string) {
    setActionLoading(action);
    try { await statusMutation.mutateAsync(action); } finally { setActionLoading(null); }
  }

  async function handleChat() {
    setChatLoading(true);
    try {
      // Look for an existing direct conversation with this agent
      const existing = conversations.find((c) => c.type === "direct" && c.other_agent_ids.length === 0);
      if (existing) {
        router.push(`/office/chat/${existing.id}`);
        return;
      }
      // Create a new direct conversation
      const { data } = await api.post("/conversations", {
        title: `Chat with ${agent?.name}`,
        type: "direct",
        participant_ids: [],
        agent_ids: [params.id],
      });
      router.push(`/office/chat/${data.id}`);
    } finally {
      setChatLoading(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-32 glass-panel rounded-xl animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 glass-panel rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8 text-center">
        <span className="icon text-5xl text-text-muted">error</span>
        <p className="mt-4 font-bold">Agent not found</p>
        <Link href="/office/agents" className="mt-2 text-primary text-sm hover:underline">Back to directory</Link>
      </div>
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const isSandboxedAgent = !!agent.sandboxed_workspace_id;
  const accent = agent.accent_color ?? "#0db9f2";
  const isActive = agent.status === "active" || agent.status === "thinking";
  const allowedTools = agent.tool_permissions?.allowed ?? [];
  const approvalTools = agent.tool_permissions?.approval_required ?? [];
  const modelConfig = (agent as unknown as Record<string, unknown>).model_config_json as Record<string, unknown> | undefined;
  const temperature = (modelConfig?.temperature as number) ?? 0.7;
  const maxTokens = (modelConfig?.max_tokens as number) ?? 4096;

  const activeTasks = tasks.filter((t) => t.status === "in_progress" || t.status === "backlog");
  const approvalTasks = tasks.filter((t) => t.status === "awaiting_approval");
  const recentCompleted = tasks.filter((t) => t.status === "completed").slice(0, 5);
  const agentsById = Object.fromEntries(allAgents.map((a) => [a.id, a]));

  const tempHint = temperature <= 0.3 ? "Precise" : temperature <= 0.6 ? "Balanced" : temperature <= 0.8 ? "Creative" : "Experimental";

  return (
    <div className="p-8 space-y-6">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="glass-panel rounded-xl p-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="relative shrink-0">
            <div
              className="size-16 rounded-xl flex items-center justify-center"
              style={{ background: `${accent}20`, border: `1px solid ${accent}30` }}
            >
              <span className="icon text-3xl" style={{ color: accent }}>smart_toy</span>
            </div>
            <span
              className={cn(
                "absolute -bottom-1 -right-1 size-5 rounded-full border-4 border-background-dark",
                isActive ? "bg-accent-success" : agent.status === "offline" ? "bg-slate-500" : "bg-amber-400"
              )}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-400">
              {agent.model_provider && (
                <span className="flex items-center gap-1.5">
                  <span className="icon text-base">memory</span>
                  {agent.model_provider.model_name}
                </span>
              )}
              {agent.category && (
                <span className="flex items-center gap-1.5">
                  <span className="icon text-base">category</span>
                  {agent.category}
                </span>
              )}
              <span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
                <span className="icon text-base">fingerprint</span>
                {agent.id}
              </span>
            </div>
            {agent.role && <p className="mt-2 text-text-muted text-sm">{agent.role}</p>}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-start gap-2 shrink-0">
            <button
              onClick={handleChat}
              disabled={chatLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-background-dark rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
            >
              <span className="icon text-sm">chat</span>
              {chatLoading ? "..." : "Chat"}
            </button>
            <button
              onClick={() => setShowMeetingModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
            >
              <span className="icon text-sm">groups</span>
              Meeting
            </button>
            <button
              onClick={() => handleAction("pause")}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
            >
              <span className="icon text-sm">pause</span>
              {actionLoading === "pause" ? "..." : "Pause"}
            </button>
            <button
              onClick={() => handleAction("restart")}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
            >
              <span className="icon text-sm">restart_alt</span>
              {actionLoading === "restart" ? "..." : "Restart"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Metrics ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon="trending_up"
          label="Task Success Rate"
          value={metrics ? `${(metrics.task_success_rate * 100).toFixed(0)}%` : "—"}
          sub={metrics ? `${metrics.total_responses} total responses` : undefined}
          subColor="text-text-muted"
        />
        <MetricCard
          icon="speed"
          label="Avg Response Time"
          value={metrics ? `${metrics.avg_response_time_ms}ms` : "—"}
        />
        <MetricCard
          icon="build"
          label="Tool Calls (24h)"
          value={metrics ? String(metrics.tool_calls_24h) : "—"}
        />
        <MetricCard
          icon="toll"
          label="Token Usage (24h)"
          value={metrics ? `${((metrics.token_usage / metrics.token_quota) * 100).toFixed(0)}%` : "—"}
          sub={metrics ? `${metrics.token_usage.toLocaleString()} / ${metrics.token_quota.toLocaleString()} ≈ $${metrics.estimated_cost_24h?.toFixed(2) ?? "0.00"}` : undefined}
        />
      </div>

      {/* ── Tab bar (sandbox tabs only visible when agent has workspace) ──── */}
      {isSandboxedAgent && (
        <div className="flex items-center gap-1 p-1 bg-surface-dark/50 rounded-xl border border-border-dark">
          {(
            [
              { key: "overview", icon: "dashboard", label: "Overview" },
              { key: "terminal", icon: "terminal", label: "Terminal" },
              { key: "files", icon: "folder_open", label: "Files" },
              { key: "desktop", icon: "desktop_windows", label: "Desktop" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                detailTab === t.key
                  ? "bg-primary/15 text-primary border border-primary/20"
                  : "text-text-muted hover:text-slate-200 hover:bg-white/5 border border-transparent",
              )}
            >
              <span className="icon text-base">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Sandbox tabs content ──────────────────────────────────────────── */}
      {isSandboxedAgent && detailTab === "terminal" && (
        <SandboxTerminal workspaceId={agent.sandboxed_workspace_id!} />
      )}
      {isSandboxedAgent && detailTab === "files" && (
        <SandboxFiles workspaceId={agent.sandboxed_workspace_id!} />
      )}
      {isSandboxedAgent && detailTab === "desktop" && (
        <SandboxDesktop />
      )}

      {/* ── Main grid (overview tab or non-sandboxed agents) ───────────────── */}
      <div className={cn("grid lg:grid-cols-12 gap-6", isSandboxedAgent && detailTab !== "overview" && "hidden")}>

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-6">

          {/* Active Tasks */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="icon text-primary">task_alt</span>
                <span className="font-bold text-sm">Active Tasks</span>
                {activeTasks.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold">{activeTasks.length}</span>
                )}
              </div>
              <Link href="/office/projects" className="text-[10px] font-bold text-primary hover:underline">View All</Link>
            </div>
            <div className="p-4">
              {activeTasks.length === 0 ? (
                <p className="text-center text-text-muted text-xs py-6">No active tasks assigned</p>
              ) : (
                <div className="space-y-2">
                  {activeTasks.slice(0, 8).map((task) => (
                    <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg bg-background-dark/40 border border-border-dark">
                      <StatusBadge status={task.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        {task.description && <p className="text-[10px] text-text-muted truncate">{task.description}</p>}
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase", PRIORITY_COLORS[task.priority] ?? "text-slate-400")}>
                        {task.priority}
                      </span>
                      {task.progress_pct > 0 && (
                        <div className="w-16 h-1.5 bg-surface-dark rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${task.progress_pct}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Awaiting Approval */}
          {approvalTasks.length > 0 && (
            <div className="glass-panel rounded-xl overflow-hidden border border-amber-500/20">
              <div className="flex items-center justify-between p-4 border-b border-amber-500/10 bg-amber-500/5">
                <div className="flex items-center gap-2">
                  <span className="icon text-amber-400">approval</span>
                  <span className="font-bold text-sm">Awaiting Approval</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">{approvalTasks.length}</span>
                </div>
              </div>
              <div className="p-4 space-y-2">
                {approvalTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg bg-background-dark/40 border border-amber-500/10">
                    <span className="icon text-amber-400 text-sm">hourglass_top</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-[10px] text-text-muted">{new Date(task.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={cn("text-[10px] font-bold uppercase", PRIORITY_COLORS[task.priority])}>
                      {task.priority}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Log Terminal */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="icon text-primary">wysiwyg</span>
                <span className="font-bold">Real-time Live Log</span>
              </div>
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest">
                <span className={cn("size-2 rounded-full", isActive ? "bg-accent-success animate-pulse" : "bg-slate-500")} />
                {isActive ? "Streaming Live" : "Idle"}
              </span>
            </div>
            <div className="bg-black/40 h-[360px] flex flex-col">
              <div className="flex items-center gap-1.5 px-4 py-2 bg-surface-dark/50 border-b border-white/5">
                <span className="size-3 rounded-full bg-rose-500 opacity-70" />
                <span className="size-3 rounded-full bg-yellow-500 opacity-70" />
                <span className="size-3 rounded-full bg-green-500 opacity-70" />
                <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {agent.name.toLowerCase().replace(/\s/g, "_")}@dofis_os: ~/workspace
                </span>
              </div>
              <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {logEntries.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-text-muted text-sm font-mono">
                    {isActive ? "Waiting for activity..." : "No recent activity"}
                  </div>
                ) : (
                  logEntries.map((entry, i) => <LogEntry key={`${entry.timestamp}-${i}`} {...entry} />)
                )}
                {isActive && (
                  <div className="flex gap-3 items-start text-sm font-mono">
                    <span className="text-slate-600 shrink-0 text-[11px] mt-0.5">—</span>
                    <span className="text-primary opacity-50 animate-pulse">_</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Execution Environment */}
          <ExecutionEnvironment agent={agent} health={health} />
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-4">

          {/* Agent Info */}
          <div className="glass-panel rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="icon text-primary text-sm">info</span>
              <span className="font-bold text-sm">Agent Info</span>
            </div>
            <div className="space-y-2.5 text-xs">
              <CopyableValue label="Agent ID" value={agent.id} />
              {agent.category && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Category</span>
                  <span className="font-medium capitalize">{agent.category}</span>
                </div>
              )}
              {agent.model_provider && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Model</span>
                  <span className="font-mono text-xs">{agent.model_provider.model_name}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Created</span>
                <span>{new Date(agent.created_at).toLocaleDateString()}</span>
              </div>
              {agent.description && (
                <div className="pt-2 border-t border-border-dark">
                  <p className="text-[11px] text-text-muted leading-relaxed">{agent.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Communication Channels */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="icon text-primary text-sm">forum</span>
                <span className="font-bold text-sm">Conversations</span>
              </div>
              <span className="text-[10px] text-text-muted">{conversations.length}</span>
            </div>
            <div className="p-3">
              {conversations.length === 0 ? (
                <p className="text-center text-text-muted text-xs py-4">No conversations yet</p>
              ) : (
                <div className="space-y-1.5">
                  {conversations.slice(0, 8).map((conv) => {
                    const convIcon = conv.type === "meeting" ? "groups" : conv.type === "group" ? "group" : "chat";
                    const timeAgo = conv.last_message_at
                      ? (() => {
                          const diff = Date.now() - new Date(conv.last_message_at).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 1) return "just now";
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          const days = Math.floor(hrs / 24);
                          return `${days}d ago`;
                        })()
                      : null;
                    return (
                      <div
                        key={conv.id}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-surface-dark/50 transition-colors group relative"
                      >
                        <Link href={`/office/chat/${conv.id}`} className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span className="icon text-sm text-text-muted group-hover:text-primary transition-colors mt-0.5">{convIcon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                                {conv.title || `${conv.type} conversation`}
                              </p>
                              {timeAgo && <span className="text-[10px] text-text-muted shrink-0">{timeAgo}</span>}
                            </div>
                            {conv.last_message_content && (
                              <p className="text-[11px] text-text-muted truncate mt-0.5 leading-snug">
                                {conv.last_message_sender_type === "agent" && <span className="text-primary/60">Agent: </span>}
                                {conv.last_message_content}
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-text-muted capitalize">{conv.type}</span>
                              {conv.message_count > 0 && (
                                <span className="text-[10px] text-text-muted">&middot; {conv.message_count} msg{conv.message_count !== 1 ? "s" : ""}</span>
                              )}
                              {conv.other_agent_ids.length > 0 && (
                                <span className="text-[10px] text-text-muted">
                                  &middot; +{conv.other_agent_ids.length} agent{conv.other_agent_ids.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm("Delete this conversation?")) return;
                            try {
                              await api.delete(`/conversations/${conv.id}`);
                              queryClient.invalidateQueries({ queryKey: ["agent-conversations", params.id] });
                            } catch {}
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-accent-warning mt-0.5 shrink-0"
                          title="Delete conversation"
                        >
                          <span className="icon text-sm">delete</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Agent Memory */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="icon text-primary text-sm">psychology</span>
                <span className="font-bold text-sm">Agent Memory</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">{memories.length}</span>
                <button
                  onClick={() => setAddMemoryOpen(!addMemoryOpen)}
                  className="p-1 rounded-lg hover:bg-surface-dark transition-colors"
                  title="Add memory"
                >
                  <span className="icon text-sm text-text-muted">add</span>
                </button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {/* Add memory form */}
              {addMemoryOpen && (
                <div className="space-y-2 p-2.5 bg-primary/5 border border-primary/20 rounded-lg">
                  <textarea
                    value={newMemoryContent}
                    onChange={(e) => setNewMemoryContent(e.target.value)}
                    placeholder="Add a fact or instruction this agent should remember..."
                    rows={2}
                    className="w-full px-3 py-2 bg-background-dark/50 border border-primary/10 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setAddMemoryOpen(false); setNewMemoryContent(""); }}
                      className="text-[10px] text-text-muted hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { if (newMemoryContent.trim()) addMemory.mutate(newMemoryContent.trim()); }}
                      disabled={!newMemoryContent.trim() || addMemory.isPending}
                      className="text-[10px] font-bold text-primary hover:text-primary/80 disabled:opacity-40"
                    >
                      {addMemory.isPending ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {memories.length === 0 ? (
                <div className="text-center py-4">
                  <span className="icon text-2xl text-text-muted">psychology</span>
                  <p className="text-[10px] text-text-muted mt-1">
                    No memories yet. Memories are created during conversations.
                  </p>
                </div>
              ) : (
                memories.map((mem) => (
                  <div
                    key={mem.id}
                    className="group flex items-start gap-2 p-2 rounded-lg hover:bg-background-dark/30 transition-colors"
                  >
                    <span className="icon text-sm mt-0.5 shrink-0" style={{
                      color: mem.memory_type === "episodic" ? "#90bccb" : mem.memory_type === "semantic" ? "#0db9f2" : "#b070d0"
                    }}>
                      {mem.memory_type === "episodic" ? "history" : mem.memory_type === "semantic" ? "lightbulb" : "psychology"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] leading-relaxed line-clamp-3">{mem.content}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-text-muted uppercase tracking-wider">{mem.memory_type}</span>
                        <span className="text-[9px] text-text-muted">
                          {new Date(mem.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMemory.mutate(mem.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 text-text-muted hover:text-rose-400 transition-all shrink-0"
                    >
                      <span className="icon text-xs">close</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Completed Tasks */}
          {recentCompleted.length > 0 && (
            <div className="glass-panel rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="icon text-accent-success text-sm">verified</span>
                  <span className="font-bold text-sm">Recent Completed</span>
                </div>
              </div>
              <div className="p-3 space-y-1.5">
                {recentCompleted.map((task) => (
                  <div key={task.id} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-background-dark/30">
                    <span className="icon text-accent-success text-sm">check_circle</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{task.title}</p>
                      {task.completed_at && (
                        <p className="text-[10px] text-text-muted">{new Date(task.completed_at).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Authorization */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="icon text-primary">lock_open</span>
                <span className="font-bold text-sm">Tool Authorization</span>
              </div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2">
              {allowedTools.length > 0 || approvalTools.length > 0 ? (
                <>
                  {allowedTools.map((tool: string) => <ToolRow key={tool} name={tool} enabled={true} />)}
                  {approvalTools.map((tool: string) => <ToolRow key={tool} name={tool} enabled={false} />)}
                </>
              ) : (
                <div className="col-span-2 text-center py-3 text-text-muted text-xs">
                  No tool permissions configured
                </div>
              )}
            </div>
          </div>

          {/* Model Parameters — connected to real agent data */}
          <div className="glass-panel rounded-xl p-4 bg-primary/5 border border-primary/20">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-4">Model Parameters</p>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Temperature</span>
                  <span className="text-primary font-bold font-mono">{temperature} ({tempHint})</span>
                </div>
                <div className="h-1 bg-surface-dark rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${temperature * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Max Tokens</span>
                  <span className="text-primary font-bold font-mono">{maxTokens.toLocaleString()}</span>
                </div>
                <div className="h-1 bg-surface-dark rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min((maxTokens / 8192) * 100, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Meeting Modal ────────────────────────────────────────────────────── */}
      {showMeetingModal && (
        <NewMeetingModal
          agent={agent}
          agents={allAgents}
          onClose={() => setShowMeetingModal(false)}
          onCreated={(convId) => {
            setShowMeetingModal(false);
            router.push(`/office/chat/${convId}`);
          }}
        />
      )}
    </div>
  );
}
