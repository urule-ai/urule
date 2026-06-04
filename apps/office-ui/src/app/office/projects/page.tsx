"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import type { Project, Task, Agent, RaciRole } from "@/types";

// ── Constants ────────────────────────────────────────────────────────────────

type Tab = "timeline" | "board";

const PROJECT_STATUS_COLOR: Record<Project["status"], string> = {
  active: "#0db9f2",
  planning: "#64748b",
  at_risk: "#f59e0b",
  complete: "#10b981",
  synced: "#10b981",
};

const PRIORITY_STYLE: Record<Task["priority"], { bg: string; text: string }> = {
  low: { bg: "bg-slate-500/20", text: "text-slate-400" },
  medium: { bg: "bg-orange-500/20", text: "text-orange-400" },
  high: { bg: "bg-red-500/20", text: "text-red-400" },
  critical: { bg: "bg-red-600/30", text: "text-red-300" },
};

const KANBAN_COLUMNS: {
  key: Task["status"];
  label: string;
  dot: string;
}[] = [
  { key: "backlog", label: "BACKLOG", dot: "bg-slate-400" },
  { key: "in_progress", label: "IN PROGRESS", dot: "bg-primary" },
  { key: "awaiting_approval", label: "AWAITING APPROVAL", dot: "bg-amber-400" },
  { key: "completed", label: "COMPLETED", dot: "bg-accent-success" },
];

const DEFAULT_COLORS = [
  "#0db9f2",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
];

const RACI_BADGE: Record<RaciRole, { label: string; bg: string; text: string; border: string }> = {
  responsible: { label: "R", bg: "bg-primary/20", text: "text-primary", border: "border-primary/30" },
  accountable: { label: "A", bg: "bg-amber-500/20", text: "text-amber-500", border: "border-amber-500/30" },
  consulted: { label: "C", bg: "bg-purple-500/20", text: "text-purple-400", border: "border-purple-500/30" },
  informed: { label: "I", bg: "bg-slate-500/20", text: "text-slate-400", border: "border-slate-500/30" },
};

function RaciBadge({ role }: { role: RaciRole }) {
  const style = RACI_BADGE[role];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center size-5 rounded text-[9px] font-black border",
        style.bg, style.text, style.border
      )}
      title={role.charAt(0).toUpperCase() + role.slice(1)}
    >
      {style.label}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function monthsBetween(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const limit = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= limit) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function dayOffset(date: Date, rangeStart: Date): number {
  return Math.floor(
    (date.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ── Create Project Modal ─────────────────────────────────────────────────────

interface AgentAssignment {
  agent_id: string;
  agent_name: string;
  accent_color: string;
  job_title: string;
  raci_role: RaciRole;
}

function CreateProjectModal({
  open,
  onClose,
  workspaceAgents,
}: {
  open: boolean;
  onClose: () => void;
  workspaceAgents: Agent[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);

  // Agent picker state
  const [pickingAgent, setPickingAgent] = useState(false);
  const [pickRole, setPickRole] = useState<RaciRole>("responsible");
  const [pickJobTitle, setPickJobTitle] = useState("");

  const availableAgents = workspaceAgents.filter(
    (a) => !assignments.some((as) => as.agent_id === a.id)
  );

  function addAgent(agent: Agent) {
    // Enforce single accountable
    if (pickRole === "accountable" && assignments.some((a) => a.raci_role === "accountable")) {
      return;
    }
    setAssignments((prev) => [
      ...prev,
      {
        agent_id: agent.id,
        agent_name: agent.name,
        accent_color: agent.accent_color,
        job_title: pickJobTitle.trim(),
        raci_role: pickRole,
      },
    ]);
    setPickingAgent(false);
    setPickRole("responsible");
    setPickJobTitle("");
  }

  function removeAgent(agentId: string) {
    setAssignments((prev) => prev.filter((a) => a.agent_id !== agentId));
  }

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      goal?: string;
      start_date: string;
      end_date: string;
      color: string;
    }) => {
      const res = await api.post("/projects", payload);
      const projectId = res.data.id;
      // Assign agents with RACI roles
      for (const a of assignments) {
        await api.post(`/projects/${projectId}/agents`, {
          agent_id: a.agent_id,
          job_title: a.job_title || undefined,
          raci_role: a.raci_role,
        });
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setGoal("");
      setStartDate("");
      setEndDate("");
      setColor(DEFAULT_COLORS[0]);
      setAssignments([]);
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) return;
    createMutation.mutate({
      name: name.trim(),
      goal: goal.trim() || undefined,
      start_date: startDate,
      end_date: endDate,
      color,
    });
  }

  if (!open) return null;

  const hasAccountable = assignments.some((a) => a.raci_role === "accountable");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <form
        onSubmit={handleSubmit}
        className="relative glass-panel rounded-xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5 shadow-2xl border border-border-dark"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">New Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center hover:bg-surface-dark transition-colors"
          >
            <span className="icon text-text-muted">close</span>
          </button>
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Project Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website Redesign"
            className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>

        {/* Goal */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Goal
          </label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Define the project's objective. This will be shared with agents as their mission."
            rows={3}
            className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
        </div>

        {/* Color picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Color
          </label>
          <div className="flex gap-2">
            {DEFAULT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "size-8 rounded-full border-2 transition-all",
                  color === c
                    ? "border-white scale-110"
                    : "border-transparent hover:scale-105"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* RACI Agent Assignment */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Agent Assignment (RACI)
          </label>

          {/* Assigned agents list */}
          {assignments.length > 0 && (
            <div className="space-y-2">
              {assignments.map((a) => (
                <div
                  key={a.agent_id}
                  className="flex items-center gap-3 px-3 py-2 bg-surface-dark/50 rounded-lg border border-border-dark/50"
                >
                  <div
                    className="size-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{
                      backgroundColor: `${a.accent_color}30`,
                      color: a.accent_color,
                    }}
                  >
                    {a.agent_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{a.agent_name}</p>
                    {a.job_title && (
                      <p className="text-[10px] text-text-muted truncate">{a.job_title}</p>
                    )}
                  </div>
                  <RaciBadge role={a.raci_role} />
                  <button
                    type="button"
                    onClick={() => removeAgent(a.agent_id)}
                    className="size-6 rounded flex items-center justify-center hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
                  >
                    <span className="icon text-sm">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add agent picker */}
          {!pickingAgent ? (
            <button
              type="button"
              onClick={() => setPickingAgent(true)}
              disabled={availableAgents.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-border-dark rounded-lg text-sm text-text-muted hover:text-white hover:border-primary/30 transition-colors disabled:opacity-40"
            >
              <span className="icon text-sm">person_add</span>
              {availableAgents.length === 0 ? "No agents available" : "Assign Agent"}
            </button>
          ) : (
            <div className="space-y-3 p-4 bg-surface-dark/30 rounded-lg border border-border-dark/50">
              {/* RACI role selector */}
              <div className="flex gap-2">
                {(["responsible", "accountable", "consulted", "informed"] as RaciRole[]).map((role) => {
                  const badge = RACI_BADGE[role];
                  const disabled = role === "accountable" && hasAccountable;
                  return (
                    <button
                      key={role}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPickRole(role)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-bold border transition-all",
                        pickRole === role
                          ? `${badge.bg} ${badge.text} ${badge.border}`
                          : "border-border-dark/50 text-text-muted hover:text-white",
                        disabled && "opacity-30 cursor-not-allowed"
                      )}
                    >
                      <span className="font-black">{badge.label}</span>
                      <span className="hidden sm:inline capitalize">{role}</span>
                    </button>
                  );
                })}
              </div>

              {/* Job title */}
              <input
                value={pickJobTitle}
                onChange={(e) => setPickJobTitle(e.target.value)}
                placeholder="Job title (e.g. Backend Architect)"
                className="w-full px-3 py-2 bg-background-dark/50 border border-primary/10 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              />

              {/* Agent list */}
              <div className="max-h-40 overflow-y-auto space-y-1">
                {availableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => addAgent(agent)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.05] transition-colors text-left"
                  >
                    <div
                      className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        backgroundColor: `${agent.accent_color}30`,
                        color: agent.accent_color,
                      }}
                    >
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{agent.name}</p>
                      <p className="text-[10px] text-text-muted truncate">{agent.role}</p>
                    </div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setPickingAgent(false);
                  setPickJobTitle("");
                }}
                className="text-[11px] text-text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg border border-border-dark text-sm font-bold hover:bg-surface-dark transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {createMutation.isPending ? (
              <>
                <span className="icon text-sm animate-spin">progress_activity</span>
                Creating...
              </>
            ) : (
              <>
                <span className="icon text-sm">add</span>
                Create Project
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Timeline Bar ─────────────────────────────────────────────────────────────

function TimelineBar({
  project,
  rangeStart,
  totalDays,
}: {
  project: Project;
  rangeStart: Date;
  totalDays: number;
}) {
  const start = project.start_date ? new Date(project.start_date) : rangeStart;
  const end = project.end_date
    ? new Date(project.end_date)
    : new Date(rangeStart.getTime() + totalDays * 86400000);

  const leftPct = Math.max(0, (dayOffset(start, rangeStart) / totalDays) * 100);
  const widthPct = Math.max(
    2,
    Math.min(100 - leftPct, ((dayOffset(end, start) + 1) / totalDays) * 100)
  );

  const barColor = PROJECT_STATUS_COLOR[project.status] ?? "#0db9f2";

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 h-8 rounded-full flex items-center overflow-hidden group/bar cursor-default"
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        backgroundColor: `${barColor}25`,
        border: `1px solid ${barColor}50`,
      }}
    >
      {/* Progress fill */}
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all"
        style={{
          width: `${project.progress_pct}%`,
          backgroundColor: `${barColor}50`,
        }}
      />

      {/* Label */}
      <span className="relative z-10 text-[11px] font-bold px-3 truncate whitespace-nowrap">
        {project.name}
      </span>

      {/* Agent avatars with RACI badges */}
      <div className="relative z-10 flex -space-x-1.5 mr-2 ml-auto">
        {(project.agents ?? []).slice(0, 3).map(({ agent, raci_role }, i) => (
          <div
            key={agent.id}
            className="relative size-5 rounded-full border border-background-dark flex items-center justify-center text-[9px] font-bold"
            style={{
              backgroundColor: agent.accent_color ?? barColor,
              zIndex: 3 - i,
            }}
            title={`${agent.name} (${raci_role.charAt(0).toUpperCase() + raci_role.slice(1)})`}
          >
            {agent.name.charAt(0).toUpperCase()}
            <span
              className={cn(
                "absolute -bottom-1 -right-1 size-3 rounded text-[7px] font-black flex items-center justify-center border",
                RACI_BADGE[raci_role].bg,
                RACI_BADGE[raci_role].text,
                RACI_BADGE[raci_role].border
              )}
            >
              {RACI_BADGE[raci_role].label}
            </span>
          </div>
        ))}
        {(project.agents ?? []).length > 3 && (
          <div className="size-5 rounded-full border border-background-dark bg-surface-dark flex items-center justify-center text-[8px] font-bold text-text-muted">
            +{(project.agents ?? []).length - 3}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline View ────────────────────────────────────────────────────────────

function TimelineView({ projects }: { projects: Project[] }) {
  const { rangeStart, totalDays, months } = useMemo(() => {
    if (projects.length === 0) {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 6, 0);
      return {
        rangeStart: s,
        totalDays: dayOffset(e, s) + 1,
        months: monthsBetween(s, e),
      };
    }

    const dates = projects.flatMap((p) => {
      const parts: Date[] = [];
      if (p.start_date) parts.push(new Date(p.start_date));
      if (p.end_date) parts.push(new Date(p.end_date));
      return parts;
    });

    if (dates.length === 0) {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 6, 0);
      return {
        rangeStart: s,
        totalDays: dayOffset(e, s) + 1,
        months: monthsBetween(s, e),
      };
    }

    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Pad range by 1 month each side
    const s = new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1);
    const e = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);

    return {
      rangeStart: s,
      totalDays: Math.max(1, dayOffset(e, s) + 1),
      months: monthsBetween(s, e),
    };
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-16 text-center">
        <span className="icon text-5xl text-text-muted">timeline</span>
        <p className="mt-4 font-bold text-lg">No projects yet</p>
        <p className="text-text-muted text-sm mt-1">
          Create your first project to see it on the timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      {/* Month header */}
      <div className="flex border-b border-border-dark/50 bg-surface-dark/30">
        {/* Row label gutter */}
        <div className="w-52 shrink-0 px-4 py-3 border-r border-border-dark/50">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Project
          </span>
        </div>
        {/* Month columns */}
        <div className="flex-1 flex">
          {months.map((m, i) => {
            const mStart = new Date(m.getFullYear(), m.getMonth(), 1);
            const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
            const leftPct = (dayOffset(mStart, rangeStart) / totalDays) * 100;
            const widthPct =
              ((dayOffset(mEnd, mStart) + 1) / totalDays) * 100;
            return (
              <div
                key={i}
                className="py-3 text-center text-[11px] font-bold text-text-muted border-r border-border-dark/30 last:border-r-0"
                style={{ width: `${widthPct}%` }}
              >
                {formatMonth(m)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Project rows */}
      {projects.map((project) => (
        <div
          key={project.id}
          className="flex border-b border-border-dark/30 last:border-b-0 hover:bg-white/[0.02] transition-colors"
        >
          {/* Row label */}
          <div className="w-52 shrink-0 px-4 py-4 border-r border-border-dark/50 flex items-center gap-3">
            <div
              className="size-3 rounded-full shrink-0"
              style={{ backgroundColor: project.color || PROJECT_STATUS_COLOR[project.status] }}
            />
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{project.name}</p>
              <p className="text-[10px] text-text-muted capitalize truncate">
                {project.status.replace("_", " ")} &middot; {project.progress_pct}%
                {project.goal && ` · ${project.goal.slice(0, 40)}${project.goal.length > 40 ? "..." : ""}`}
              </p>
            </div>
          </div>
          {/* Bar area */}
          <div className="flex-1 relative py-2">
            {/* Vertical month gridlines */}
            {months.map((m, i) => {
              const mStart = new Date(m.getFullYear(), m.getMonth(), 1);
              const leftPct =
                (dayOffset(mStart, rangeStart) / totalDays) * 100;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-r border-border-dark/20"
                  style={{ left: `${leftPct}%` }}
                />
              );
            })}
            <TimelineBar
              project={project}
              rangeStart={rangeStart}
              totalDays={totalDays}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Kanban Card ──────────────────────────────────────────────────────────────

function KanbanCard({
  task,
  agents,
}: {
  task: Task;
  agents: Agent[];
}) {
  const assignedAgent = agents.find((a) => a.id === task.assigned_agent_id);
  const priority = PRIORITY_STYLE[task.priority];

  return (
    <div className="glass-panel rounded-xl p-4 space-y-3 hover:border-primary/30 transition-all group">
      {/* Priority + title */}
      <div className="space-y-2">
        <span
          className={cn(
            "inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
            priority.bg,
            priority.text
          )}
        >
          {task.priority}
        </span>
        <p className="text-sm font-bold leading-snug group-hover:text-primary transition-colors">
          {task.title}
        </p>
      </div>

      {/* Progress bar (only for in_progress) */}
      {task.status === "in_progress" && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">Progress</span>
            <span className="text-[10px] font-bold text-primary">
              {task.progress_pct}%
            </span>
          </div>
          <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${task.progress_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Tools used */}
      {task.tools_used.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tools_used.slice(0, 3).map((tool) => (
            <span
              key={tool}
              className="px-2 py-0.5 rounded-md bg-surface-dark border border-border-dark text-[10px] font-mono text-text-muted"
            >
              {tool}
            </span>
          ))}
          {task.tools_used.length > 3 && (
            <span className="px-2 py-0.5 rounded-md bg-surface-dark border border-border-dark text-[10px] font-mono text-text-muted">
              +{task.tools_used.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Assigned agent + RACI */}
      {assignedAgent && (
        <div className="flex items-center gap-2 pt-1 border-t border-border-dark/40">
          <div
            className="size-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
            style={{
              backgroundColor: `${assignedAgent.accent_color ?? "#0db9f2"}30`,
              color: assignedAgent.accent_color ?? "#0db9f2",
            }}
          >
            {assignedAgent.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-[11px] text-text-muted truncate flex-1">
            {assignedAgent.name}
          </span>
          {task.raci_role && <RaciBadge role={task.raci_role} />}
        </div>
      )}
    </div>
  );
}

// ── Board View ───────────────────────────────────────────────────────────────

function BoardView({
  tasks,
  agents,
}: {
  tasks: Task[];
  agents: Agent[];
}) {
  if (tasks.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-16 text-center">
        <span className="icon text-5xl text-text-muted">view_kanban</span>
        <p className="mt-4 font-bold text-lg">No tasks yet</p>
        <p className="text-text-muted text-sm mt-1">
          Tasks assigned to projects will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div key={col.key} className="space-y-3">
            {/* Column header */}
            <div className="flex items-center gap-2 px-1">
              <span className={cn("size-2.5 rounded-full", col.dot)} />
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
                {col.label}
              </span>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-dark border border-border-dark text-text-muted">
                {colTasks.length}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-3 min-h-[120px]">
              {colTasks.map((task) => (
                <KanbanCard key={task.id} task={task} agents={agents} />
              ))}
              {colTasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-border-dark/50 p-6 text-center">
                  <p className="text-[11px] text-text-muted">No tasks</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("timeline");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: projects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data),
  });

  const { data: tasks = [], isLoading: loadingTasks } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => api.get("/tasks").then((r) => r.data),
  });

  const workspaceId = useWorkspaceId();
  const { data: workspaceAgents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data),
    enabled: !!workspaceId,
  });

  // Collect all agents from projects for the board view
  const allAgents = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const p of projects) {
      for (const { agent } of p.agents ?? []) {
        map.set(agent.id, agent);
      }
    }
    return Array.from(map.values());
  }, [projects]);

  const isLoading = loadingProjects || loadingTasks;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">Project Roadmap</h1>
          <p className="text-text-muted mt-1 text-sm">
            {projects.length} project{projects.length !== 1 ? "s" : ""} &middot;{" "}
            {tasks.length} task{tasks.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex bg-surface-dark border border-border-dark rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab("timeline")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-all",
                activeTab === "timeline"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-text-muted hover:text-white border border-transparent"
              )}
            >
              <span className="icon text-sm">timeline</span>
              Timeline
            </button>
            <button
              onClick={() => setActiveTab("board")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-all",
                activeTab === "board"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-text-muted hover:text-white border border-transparent"
              )}
            >
              <span className="icon text-sm">view_kanban</span>
              Board
            </button>
          </div>

          {/* New project button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          >
            <span className="icon text-sm">add</span>
            New Project
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="glass-panel rounded-xl p-5 h-16 animate-pulse"
            />
          ))}
        </div>
      ) : activeTab === "timeline" ? (
        <TimelineView projects={projects} />
      ) : (
        <BoardView tasks={tasks} agents={allAgents} />
      )}

      {/* Create modal */}
      <CreateProjectModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        workspaceAgents={workspaceAgents}
      />
    </div>
  );
}
