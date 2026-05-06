"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useWidgetConfig } from "../useWidgetConfig";
import type { Project } from "@/types";

/*
 * Compact projects widget — shows top-N active or at-risk projects
 * with a tiny progress bar. The full /office/projects page covers
 * planning + agent assignments + RACI; this is the at-a-glance "what
 * needs attention this week" tile.
 *
 * Default surface is `at_risk` first (the squeaky-wheel rows), then
 * actively-running below — sorting nudges the user toward where they
 * can have impact. `focus: 'active'` flips that to recently-updated
 * active projects.
 */

const STATUS_CONFIG: Record<Project["status"], { label: string; bar: string; pill: string }> = {
  planning: { label: "Planning", bar: "bg-sky-400", pill: "text-sky-400 bg-sky-500/15" },
  active: { label: "Active", bar: "bg-emerald-400", pill: "text-emerald-400 bg-emerald-500/15" },
  at_risk: { label: "At risk", bar: "bg-amber-400", pill: "text-amber-400 bg-amber-500/15" },
  complete: { label: "Complete", bar: "bg-text-muted", pill: "text-text-muted bg-surface-dark" },
  synced: { label: "Synced", bar: "bg-violet-400", pill: "text-violet-400 bg-violet-500/15" },
};

interface Config extends Record<string, unknown> {
  limit: number;
  focus: "at_risk" | "active";
}

export default function ProjectsWidget() {
  const { config } = useWidgetConfig<Config>({ limit: 4, focus: "at_risk" });
  const limit = Math.min(Math.max(config.limit, 1), 12);

  const { data: projects = [], isLoading, isError, error, refetch } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data),
    refetchInterval: 60_000,
  });

  const STATUS_PRIORITY: Record<Project["status"], number> = {
    at_risk: 0,
    active: 1,
    planning: 2,
    synced: 3,
    complete: 4,
  };

  const sorted = [...projects].sort((a, b) => {
    if (config.focus === "at_risk") {
      const sa = STATUS_PRIORITY[a.status];
      const sb = STATUS_PRIORITY[b.status];
      if (sa !== sb) return sa - sb;
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  const visible = sorted.slice(0, limit);

  return (
    <div className="rounded-lg border border-border-dark/60 bg-surface-dark/60 p-3">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">Projects</h3>
        <Link
          href="/office/projects"
          className="text-[10px] text-primary hover:underline"
          data-inline
        >
          View all ({projects.length})
        </Link>
      </header>

      {isError ? (
        <QueryError compact error={error} onRetry={() => refetch()} label="Projects unavailable" />
      ) : isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-text-muted py-3 text-center">No projects yet.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => {
            const cfg = STATUS_CONFIG[p.status];
            return (
              <li key={p.id}>
                <Link
                  href={`/office/projects#${p.id}`}
                  className="block px-2 py-1.5 rounded hover:bg-primary/10 transition-colors"
                  data-inline
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                        cfg.pill,
                      )}
                    >
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-background-dark/60 overflow-hidden">
                      <div
                        className={cn("h-full transition-all", cfg.bar)}
                        style={{ width: `${Math.min(Math.max(p.progress_pct, 0), 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted tabular-nums shrink-0 w-8 text-right">
                      {Math.round(p.progress_pct)}%
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
