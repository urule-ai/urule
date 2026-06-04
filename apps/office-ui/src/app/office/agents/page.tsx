"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import type { Agent, AgentStatus } from "@/types";

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { label: string; dotClass: string }> = {
  active: { label: "Active", dotClass: "bg-accent-success" },
  thinking: { label: "Thinking", dotClass: "bg-accent-success animate-ping" },
  idle: { label: "Idle", dotClass: "bg-amber-400" },
  offline: { label: "Offline", dotClass: "bg-slate-500" },
  busy: { label: "Busy", dotClass: "bg-indigo-400" },
  deployable: { label: "Deployable", dotClass: "bg-primary" },
};

const PROVIDER_ICON: Record<string, string> = {
  claude: "auto_awesome",
  openai: "rocket_launch",
  lmstudio: "memory",
  openrouter: "hub",
};

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: Agent }) {
  const status = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.offline;
  const accent = agent.accent_color ?? "#0db9f2";
  const providerIcon = agent.model_provider
    ? (PROVIDER_ICON[agent.model_provider.provider] ?? "psychology")
    : "psychology";

  return (
    <div className="glass-panel rounded-xl p-5 flex flex-col gap-4 group hover:border-primary/40 transition-all relative">
      {/* Status badge */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background-dark/60 border border-white/5">
          <span className={cn("size-2 rounded-full", status.dotClass)} />
          <span className="text-[10px] font-bold uppercase tracking-wide">{status.label}</span>
        </div>
        {agent.model_provider && (
          <span className="text-[10px] text-slate-500 font-mono">
            {agent.model_provider.model_name}
          </span>
        )}
      </div>

      {/* Avatar */}
      <div
        className="size-16 rounded-xl flex items-center justify-center border"
        style={{
          background: `linear-gradient(135deg, ${accent}20, ${accent}40)`,
          borderColor: `${accent}30`,
        }}
      >
        <span className="icon text-3xl" style={{ color: accent }}>
          {providerIcon}
        </span>
      </div>

      {/* Identity */}
      <div className="pr-20">
        <h3 className="text-lg font-bold group-hover:text-primary transition-colors leading-tight">
          {agent.role || "Agent"}
        </h3>
        <p className="text-xs text-slate-500 font-medium mt-0.5">{agent.name}</p>
        {agent.category && (
          <p className="text-[10px] text-text-muted uppercase tracking-widest mt-1 font-mono">
            {agent.category}
          </p>
        )}
      </div>

      {/* View details */}
      <Link
        href={`/office/agents/${agent.id}`}
        className="mt-auto text-xs font-bold px-4 py-2 rounded-lg border border-primary/20 bg-primary/10 text-primary hover:bg-primary hover:text-background-dark transition-all text-center"
      >
        View Details
      </Link>
    </div>
  );
}

// ── Filter pills ───────────────────────────────────────────────────────────────

const CATEGORIES = ["Engineering", "Design", "Marketing", "Product", "Project Management", "Testing", "Specialized", "Leadership"];
const STATUSES: AgentStatus[] = ["active", "idle", "offline", "busy"];

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-bold border transition-all",
        active
          ? "bg-primary/20 border-primary/40 text-primary"
          : "bg-surface-dark border-border-dark text-text-muted hover:border-primary/30"
      )}
    >
      {children}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgentStatus | null>(null);

  const workspaceId = useWorkspaceId();
  const { data: agents = [], isLoading, isError, error, refetch } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data),
    enabled: !!workspaceId,
  });

  const filtered = agents.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.role ?? "").toLowerCase().includes(q) ||
      (a.category ?? "").toLowerCase().includes(q);
    const matchesCategory = !categoryFilter || a.category === categoryFilter;
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="p-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Agent Directory</h1>
          <p className="text-text-muted mt-1 text-sm">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} deployed in your workspace
          </p>
        </div>
        <Link
          href="/office/agents/new"
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          <span className="icon text-sm">add</span>
          New Agent
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-lg">
        <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents by name, role, or category..."
          className="w-full pl-10 pr-4 py-2.5 bg-surface-dark border border-border-dark rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Category:</span>
          <FilterPill active={categoryFilter === null} onClick={() => setCategoryFilter(null)}>
            All
          </FilterPill>
          {CATEGORIES.map((d) => (
            <FilterPill
              key={d}
              active={categoryFilter === d}
              onClick={() => setCategoryFilter(categoryFilter === d ? null : d)}
            >
              {d}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Status:</span>
          <FilterPill active={statusFilter === null} onClick={() => setStatusFilter(null)}>
            All
          </FilterPill>
          {STATUSES.map((s) => (
            <FilterPill
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            >
              {STATUS_CONFIG[s].label}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isError ? (
        <QueryError error={error} onRetry={() => refetch()} label="Couldn't load agents" />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-16 text-center">
          <span className="icon text-5xl text-text-muted">person_search</span>
          <p className="mt-4 font-bold text-lg">No agents found</p>
          <p className="text-text-muted text-sm mt-1">
            {search || categoryFilter || statusFilter
              ? "Try adjusting your filters"
              : "Deploy your first agent to get started"}
          </p>
          {!search && !categoryFilter && !statusFilter && (
            <Link
              href="/office/agents/new"
              className="mt-6 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-6 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all"
            >
              <span className="icon text-sm">add</span>
              Deploy First Agent
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
