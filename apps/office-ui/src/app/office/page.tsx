"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Link from "next/link";
import { useAuthStore } from "@/store/useAuthStore";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { OfficeView } from "@/components/office/OfficeView";
import SandboxMonitor from "@/components/office/SandboxMonitor";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import type { Agent, AgentStatus, OfficeStats, Approval, Integration, ActivityLog } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContainerInfo {
  id: string;
  name: string;
  service: string;
  image: string;
  status: string;
  state: string;
  health: string | null;
  ports: { host: number | null; container: number; protocol: string }[];
  created: string;
  started_at: string | null;
  role: string;
  icon: string;
  description: string;
  cpu_pct: number;
  mem_usage_mb: number;
  mem_limit_mb: number;
  mem_pct: number;
  net_rx_mb: number;
  net_tx_mb: number;
}

// ── Status dot config ────────────────────────────────────────────────────────

const STATUS_DOT: Record<AgentStatus, string> = {
  active: "bg-accent-success",
  thinking: "bg-accent-success animate-ping",
  idle: "bg-amber-400",
  offline: "bg-slate-500",
  busy: "bg-indigo-400",
  deployable: "bg-primary",
};

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  color = "text-primary",
}: {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="glass-panel p-6 rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className={cn("p-2 rounded-lg bg-primary/10", color)}>
          <span className="icon">{icon}</span>
        </div>
      </div>
      <p className="text-3xl font-black">{value}</p>
      <p className="text-xs text-text-muted mt-1">{label}</p>
    </div>
  );
}

// ── Agent activity card ──────────────────────────────────────────────────────

function AgentActivityCard({ agent }: { agent: Agent }) {
  const accent = agent.accent_color ?? "#0db9f2";
  const dotClass = STATUS_DOT[agent.status] ?? "bg-slate-500";

  return (
    <Link
      href={`/office/agents/${agent.id}`}
      className="group glass-panel rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div
          className="size-10 rounded-xl flex items-center justify-center shrink-0 relative"
          style={{ background: `${accent}20` }}
        >
          <span className="icon text-sm" style={{ color: accent }}>smart_toy</span>
          <span className={cn("absolute -top-1 -right-1 size-3 rounded-full border-2 border-surface-dark", dotClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm group-hover:text-primary transition-colors truncate">{agent.name}</p>
          <p className="text-[10px] text-text-muted uppercase tracking-wider truncate">{agent.role}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted capitalize">{agent.status}</span>
      </div>
      <div className="bg-slate-900/50 rounded-lg p-2.5">
        <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Status</p>
        <p className="text-xs text-slate-300 truncate">
          {agent.status === "active" || agent.status === "thinking"
            ? "Processing task..."
            : agent.status === "idle"
            ? "Ready for tasks"
            : agent.status === "offline"
            ? "Offline"
            : "In queue"}
        </p>
        <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: agent.status === "active" || agent.status === "thinking" ? "65%" : "0%" }}
          />
        </div>
      </div>
    </Link>
  );
}

// ── Quick action card ────────────────────────────────────────────────────────

function ActionCard({ icon, title, desc, href }: { icon: string; title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="group glass-panel rounded-xl p-5 flex flex-col items-start gap-3 hover:border-primary/40 transition-all">
      <div className="size-10 rounded-xl bg-primary/10 group-hover:bg-primary flex items-center justify-center transition-colors">
        <span className="icon text-primary group-hover:text-background-dark transition-colors">{icon}</span>
      </div>
      <div>
        <p className="font-bold text-sm">{title}</p>
        <p className="text-[11px] text-text-muted mt-0.5">{desc}</p>
      </div>
    </Link>
  );
}

// ── Container card ───────────────────────────────────────────────────────────

const STATE_STYLES: Record<string, { dot: string; text: string }> = {
  running:  { dot: "bg-accent-success", text: "text-accent-success" },
  exited:   { dot: "bg-slate-500",      text: "text-slate-400" },
  paused:   { dot: "bg-amber-400",      text: "text-amber-400" },
  created:  { dot: "bg-primary",        text: "text-primary" },
};

function ContainerCard({
  container,
  onAction,
  actionLoading,
}: {
  container: ContainerInfo;
  onAction: (id: string, action: string) => void;
  actionLoading: string | null;
}) {
  const style = STATE_STYLES[container.state] ?? STATE_STYLES.exited;
  const isRunning = container.state === "running";
  const isSandboxed = container.service === "sandboxed";

  return (
    <div className={cn("glass-panel rounded-xl p-4 space-y-3", isSandboxed && "border-primary/20")}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={cn("p-2 rounded-lg", isRunning ? "bg-primary/10" : "bg-surface-dark")}>
          <span className={cn("icon text-sm", isRunning ? "text-primary" : "text-text-muted")}>{container.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold truncate">{container.service}</p>
            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase", style.text)}>
              <span className={cn("size-1.5 rounded-full", style.dot, isRunning && "animate-pulse")} />
              {container.state}
            </span>
          </div>
          <p className="text-[10px] text-text-muted">{container.role}</p>
        </div>
      </div>

      {/* Stats (only when running) */}
      {isRunning && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-background-dark/40 rounded-lg p-2">
            <p className="text-[9px] text-text-muted uppercase tracking-wider">CPU</p>
            <p className="text-xs font-bold font-mono">{container.cpu_pct}%</p>
          </div>
          <div className="bg-background-dark/40 rounded-lg p-2">
            <p className="text-[9px] text-text-muted uppercase tracking-wider">MEM</p>
            <p className="text-xs font-bold font-mono">{container.mem_usage_mb}MB</p>
          </div>
          <div className="bg-background-dark/40 rounded-lg p-2">
            <p className="text-[9px] text-text-muted uppercase tracking-wider">NET</p>
            <p className="text-xs font-bold font-mono">{container.net_rx_mb}MB</p>
          </div>
        </div>
      )}

      {/* Details */}
      <div className="space-y-1 text-[10px]">
        <div className="flex justify-between">
          <span className="text-text-muted">Image</span>
          <span className="font-mono truncate max-w-[180px]">{container.image.split("@")[0]}</span>
        </div>
        {container.ports.length > 0 && (
          <div className="flex justify-between">
            <span className="text-text-muted">Ports</span>
            <span className="font-mono">
              {container.ports.map((p) => (p.host ? `${p.host}:${p.container}` : String(p.container))).join(", ")}
            </span>
          </div>
        )}
        {container.health && (
          <div className="flex justify-between">
            <span className="text-text-muted">Health</span>
            <span className={cn(
              "font-bold uppercase",
              container.health === "healthy" ? "text-accent-success" : container.health === "unhealthy" ? "text-rose-400" : "text-amber-400"
            )}>
              {container.health}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-text-muted">Container</span>
          <span className="font-mono">{container.id}</span>
        </div>
      </div>

      {/* Memory bar */}
      {isRunning && container.mem_limit_mb > 0 && (
        <div>
          <div className="flex justify-between text-[9px] mb-0.5">
            <span className="text-text-muted">Memory</span>
            <span className="text-text-muted font-mono">{container.mem_pct}%</span>
          </div>
          <div className="h-1 bg-surface-dark rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", container.mem_pct > 80 ? "bg-rose-400" : "bg-primary")}
              style={{ width: `${Math.min(container.mem_pct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {isRunning ? (
          <>
            <button
              onClick={() => onAction(container.id, "restart")}
              disabled={!!actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-surface-dark border border-border-dark rounded-lg text-[10px] font-bold hover:bg-accent-dark transition-colors"
            >
              <span className="icon" style={{ fontSize: 12 }}>restart_alt</span>
              {actionLoading === `${container.id}-restart` ? "..." : "Restart"}
            </button>
            <button
              onClick={() => onAction(container.id, "stop")}
              disabled={!!actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-surface-dark border border-border-dark rounded-lg text-[10px] font-bold hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400 transition-colors"
            >
              <span className="icon" style={{ fontSize: 12 }}>stop</span>
              {actionLoading === `${container.id}-stop` ? "..." : "Stop"}
            </button>
          </>
        ) : (
          <button
            onClick={() => onAction(container.id, "start")}
            disabled={!!actionLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-[10px] font-bold text-primary hover:bg-primary/20 transition-colors"
          >
            <span className="icon" style={{ fontSize: 12 }}>play_arrow</span>
            {actionLoading === `${container.id}-start` ? "..." : "Start"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Right panel tabs ─────────────────────────────────────────────────────────

type RightTab = "overview" | "infrastructure";

// ── Main dashboard ───────────────────────────────────────────────────────────

export default function OfficeDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"dashboard" | "office">("dashboard");
  const [rightTab, setRightTab] = useState<RightTab>("overview");
  const [containerActionLoading, setContainerActionLoading] = useState<string | null>(null);

  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => api.get("/agents").then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery<OfficeStats>({
    queryKey: ["office-stats"],
    queryFn: () => api.get("/office/stats").then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: pendingApprovals = [] } = useQuery<Approval[]>({
    queryKey: ["approvals", "pending"],
    queryFn: () => api.get("/approvals", { params: { status_filter: "pending" } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: integrations = [] } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: () => api.get("/integrations").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: logs = [] } = useQuery<ActivityLog[]>({
    queryKey: ["logs"],
    queryFn: () => api.get("/logs", { params: { limit: 10 } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: healthData } = useQuery<{ sandboxed: string }>({
    queryKey: ["health"],
    queryFn: () => axios.get("/health").then((r) => r.data),
    refetchInterval: 60000,
    enabled: rightTab === "infrastructure",
    retry: false,
  });
  const sandboxedAvailable = healthData?.sandboxed === "ok";

  const { data: containers = [], isError: containersError } = useQuery<ContainerInfo[]>({
    queryKey: ["infrastructure-containers"],
    queryFn: () => api.get("/infrastructure/containers").then((r) => r.data),
    refetchInterval: 10000,
    enabled: rightTab === "infrastructure",
    retry: 1,
  });

  const containerMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/infrastructure/containers/${id}/${action}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["infrastructure-containers"] });
    },
  });

  async function handleContainerAction(id: string, action: string) {
    setContainerActionLoading(`${id}-${action}`);
    try {
      await containerMutation.mutateAsync({ id, action });
    } finally {
      setContainerActionLoading(null);
    }
  }

  const activeAgents = agents.filter((a) => a.status === "active" || a.status === "thinking");
  const displayAgents = agents.slice(0, 4);

  const runningContainers = containers.filter((c) => c.state === "running");
  const totalCpu = runningContainers.reduce((sum, c) => sum + c.cpu_pct, 0);
  const totalMem = runningContainers.reduce((sum, c) => sum + c.mem_usage_mb, 0);

  if (viewMode === "office") {
    return (
      <OfficeView
        agents={agents}
        logs={logs}
        userName={user?.display_name}
        onBack={() => setViewMode("dashboard")}
      />
    );
  }

  return (
    <div className="p-8 space-y-8">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">
            Welcome back{user?.display_name ? `, ${user.display_name}` : ""}
          </h1>
          <p className="text-text-muted mt-1 text-sm">
            Orchestrating{" "}
            <span className="text-primary font-bold">{agents.length}</span> AI agents
            {activeAgents.length > 0 && (
              <>{" "} — <span className="text-accent-success font-bold">{activeAgents.length} active</span></>
            )}
          </p>
        </div>
        <button
          onClick={() => setViewMode("office")}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm font-bold text-primary hover:bg-primary/20 hover:border-primary/40 transition-all active:scale-95"
        >
          <span className="icon text-lg">meeting_room</span>
          Office View
        </button>
      </div>

      {/* Stats */}
      <div data-testid="dashboard-stats" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {agentsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-panel p-6 rounded-2xl space-y-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : (
          <>
            <StatCard icon="smart_toy" label="Total Agents" value={agents.length} />
            <StatCard icon="sensors" label="Active Now" value={activeAgents.length} color="text-accent-success" />
            <StatCard icon="verified_user" label="Pending Approvals" value={stats?.approvals_pending ?? pendingApprovals.length} color="text-amber-400" />
            <StatCard
              icon="offline_bolt"
              label="Offline"
              value={stats?.agents_offline ?? agents.filter((a) => a.status === "offline").length}
              color="text-slate-400"
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Live agents */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="icon text-primary">sensors</span>
              <h2 className="font-bold">Live Agent Activity</h2>
            </div>
            <Link href="/office/agents" className="text-xs text-primary font-bold hover:underline flex items-center gap-1">
              View All <span className="icon text-sm">arrow_forward</span>
            </Link>
          </div>

          {agentsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : displayAgents.length === 0 ? (
            <div className="glass-panel rounded-xl p-12 text-center">
              <span className="icon text-5xl text-text-muted">person_add</span>
              <p className="mt-4 font-bold">No agents deployed yet</p>
              <Link
                href="/office/agents/new"
                className="mt-4 inline-flex items-center gap-2 bg-primary text-background-dark font-black px-6 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all hover:bg-primary/90"
              >
                <span className="icon text-sm">add</span>
                Deploy First Agent
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayAgents.map((agent) => (
                <AgentActivityCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Right column with tabs */}
        <div className="lg:col-span-4 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-surface-dark rounded-xl">
            {([
              { id: "overview" as RightTab, label: "Overview", icon: "dashboard" },
              { id: "infrastructure" as RightTab, label: "Infrastructure", icon: "dns" },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all",
                  rightTab === tab.id
                    ? "bg-primary text-background-dark"
                    : "text-text-muted hover:text-white hover:bg-accent-dark"
                )}
              >
                <span className="icon" style={{ fontSize: 14 }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {rightTab === "overview" && (
            <>
              {/* Action center */}
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="bg-primary p-5 relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center opacity-10">
                    <span className="icon text-[120px] text-background-dark">bolt</span>
                  </div>
                  <p className="font-bold relative">Action Center</p>
                  <p className="text-xs text-background-dark/70 mt-0.5 relative">Quick access to common tasks</p>
                </div>
                <div className="p-3 space-y-2">
                  {[
                    { icon: "add", label: "Deploy New Agent", href: "/office/agents/new" },
                    { icon: "extension", label: "Connect Integration", href: "/office/integrations" },
                    { icon: "smart_toy", label: "Agent Directory", href: "/office/agents" },
                  ].map((action) => (
                    <Link
                      key={action.label}
                      href={action.href}
                      className="flex items-center gap-3 px-4 py-3 bg-background-dark/10 hover:bg-background-dark/20 rounded-xl transition-colors group"
                    >
                      <span className="icon text-primary">{action.icon}</span>
                      <span className="text-sm font-medium flex-1">{action.label}</span>
                      <span className="icon text-text-muted group-hover:text-primary transition-colors">chevron_right</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Approval queue */}
              {pendingApprovals.length > 0 && (
                <div className="glass-panel rounded-xl overflow-hidden">
                  <div className="bg-amber-500/10 border-b border-amber-500/20 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="icon text-amber-400">verified_user</span>
                      <span className="font-bold text-sm">Approvals</span>
                    </div>
                    <span className="bg-amber-500 text-background-dark text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {pendingApprovals.length} NEW
                    </span>
                  </div>
                  <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                    {pendingApprovals.slice(0, 3).map((a) => (
                      <Link key={a.id} href={`/office/approvals/${a.id}`} className="block p-3 bg-background-dark/30 rounded-lg hover:bg-primary/5 transition-colors">
                        <p className="text-xs font-bold truncate">{a.title}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{a.request_id} — {a.risk_level} risk</p>
                      </Link>
                    ))}
                  </div>
                  <Link href="/office/approvals" className="block text-center text-xs text-primary font-bold py-2 border-t border-white/5 hover:bg-primary/5 transition-colors">
                    View All Approvals ({pendingApprovals.length})
                  </Link>
                </div>
              )}

              {/* Connected Ecosystem */}
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-4 flex items-center gap-2 border-b border-white/5">
                  <span className="icon text-primary">hub</span>
                  <span className="font-bold text-sm">Connected Ecosystem</span>
                </div>
                <div className="p-4 flex flex-wrap gap-3">
                  {integrations.map((integration) => (
                    <div key={integration.id} className="flex flex-col items-center gap-1">
                      <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="icon text-primary text-sm">extension</span>
                      </div>
                      <span className="text-[10px] text-text-muted truncate max-w-[56px] text-center">{integration.name}</span>
                    </div>
                  ))}
                  <Link href="/office/integrations" className="flex flex-col items-center gap-1">
                    <div className="size-10 rounded-full border-2 border-dashed border-white/10 hover:border-primary/40 flex items-center justify-center transition-colors">
                      <span className="icon text-text-muted text-sm">add</span>
                    </div>
                    <span className="text-[10px] text-text-muted">Add</span>
                  </Link>
                </div>
              </div>

              {/* System Logs */}
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="icon text-primary">history</span>
                    <span className="font-bold text-sm">System Logs</span>
                  </div>
                  <Link href="/office/logs" className="text-xs text-primary font-bold hover:underline flex items-center gap-1">
                    View All <span className="icon text-sm">arrow_forward</span>
                  </Link>
                </div>
                <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 p-2 rounded-lg">
                      <span
                        className={cn(
                          "mt-1.5 size-2 rounded-full shrink-0",
                          log.event_type === "success" && "bg-emerald-400",
                          log.event_type === "critical" && "bg-rose-400",
                          log.event_type === "warning" && "bg-amber-400",
                          log.event_type === "modification" && "bg-blue-400",
                          log.event_type === "integration" && "bg-primary",
                          log.event_type === "info" && "bg-slate-400",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{log.title}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-xs text-text-muted text-center py-4">No recent activity</p>}
                </div>
              </div>

              {/* Quick actions grid */}
              <div className="grid grid-cols-2 gap-3">
                <ActionCard icon="forum" title="New Chat" desc="Talk to agents" href="/office/agents" />
                <ActionCard icon="view_kanban" title="Board" desc="Task kanban" href="/office/projects" />
              </div>
            </>
          )}

          {/* ── INFRASTRUCTURE TAB ───────────────────────────────────────── */}
          {rightTab === "infrastructure" && (
            <>
              {/* Real-time monitoring via sandboxed.sh WebSocket */}
              {sandboxedAvailable && <SandboxMonitor />}

              {/* Summary bar */}
              <div className="glass-panel rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="icon text-primary">monitoring</span>
                  <span className="font-bold text-sm">Cluster Overview</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background-dark/40 rounded-lg p-2.5 text-center">
                    <p className="text-lg font-black text-accent-success">{runningContainers.length}</p>
                    <p className="text-[9px] text-text-muted uppercase tracking-wider">Running</p>
                  </div>
                  <div className="bg-background-dark/40 rounded-lg p-2.5 text-center">
                    <p className="text-lg font-black font-mono">{totalCpu.toFixed(1)}%</p>
                    <p className="text-[9px] text-text-muted uppercase tracking-wider">Total CPU</p>
                  </div>
                  <div className="bg-background-dark/40 rounded-lg p-2.5 text-center">
                    <p className="text-lg font-black font-mono">{totalMem.toFixed(0)}<span className="text-xs font-normal">MB</span></p>
                    <p className="text-[9px] text-text-muted uppercase tracking-wider">Total RAM</p>
                  </div>
                </div>
              </div>

              {/* Container list */}
              {containersError ? (
                <div className="glass-panel rounded-xl p-6 text-center space-y-3">
                  <span className="icon text-3xl text-text-muted">cloud_off</span>
                  <p className="text-sm font-bold">Docker socket not available</p>
                  <p className="text-xs text-text-muted">
                    Mount <code className="px-1 py-0.5 bg-surface-dark rounded text-[10px]">/var/run/docker.sock</code> to the API container to enable infrastructure monitoring.
                  </p>
                </div>
              ) : containers.length === 0 ? (
                <div className="glass-panel rounded-xl p-6 text-center">
                  <span className="icon text-3xl text-text-muted animate-pulse">hourglass_empty</span>
                  <p className="text-sm text-text-muted mt-2">Loading containers...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {containers.map((c) => (
                    <ContainerCard
                      key={c.id}
                      container={c}
                      onAction={handleContainerAction}
                      actionLoading={containerActionLoading}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
