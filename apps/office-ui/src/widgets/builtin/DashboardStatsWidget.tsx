"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import type { OfficeStats } from "@/types";

/*
 * Compact dashboard-stats widget — 4-tile KPI grid backed by
 * /office/stats. The full /office page mounts a much richer dashboard
 * (live agents, integrations, container health, etc.); this is the
 * at-a-glance subset that fits in a sidebar / status tile.
 *
 * No widget-config knobs: which 4 numbers matter is a product
 * decision, not a per-instance preference. If/when "show top-N agents"
 * becomes a thing, that's a separate widget.
 */

interface Tile {
  label: string;
  value: number;
  hint?: string;
}

export default function DashboardStatsWidget() {
  const { data: stats, isLoading, isError, error, refetch } = useQuery<OfficeStats>({
    queryKey: ["office-stats"],
    queryFn: () => api.get("/office/stats").then((r) => r.data),
    refetchInterval: 30_000,
  });

  const tiles: Tile[] = [
    { label: "Agents Online", value: stats?.agents_online ?? 0, hint: `${stats?.agents_active ?? 0} active` },
    { label: "Pending", value: stats?.approvals_pending ?? 0, hint: "approvals" },
    { label: "Workflows", value: stats?.workflows_today ?? 0, hint: "today" },
    { label: "API Calls", value: stats?.api_calls_24h ?? 0, hint: "24h" },
  ];

  return (
    <div className="rounded-lg border border-border-dark/60 bg-surface-dark/60 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Overview</h3>
      {isError ? (
        <QueryError compact error={error} onRetry={() => refetch()} label="Stats unavailable" />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-md bg-background-dark/40 border border-border-dark/40 px-2.5 py-2"
            >
              <div className="text-lg font-black text-primary tabular-nums leading-none">
                {tile.value.toLocaleString()}
              </div>
              <div className="text-[10px] text-text-muted mt-1 leading-none">{tile.label}</div>
              {tile.hint && (
                <div className="text-[10px] text-text-muted/70 mt-0.5 leading-none">{tile.hint}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
