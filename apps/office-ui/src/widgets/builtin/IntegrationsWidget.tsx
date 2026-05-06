"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useWidgetConfig } from "../useWidgetConfig";

/*
 * Compact integrations widget — surfaces "needs attention" first
 * (disconnected or in error), then a count of active connections.
 * The full /office/integrations page does category browsing + setup;
 * this is the at-a-glance "is anything broken?" tile.
 *
 * Mode picker (`focus` config):
 *   - `attention` (default): show top-N rows with status != active
 *   - `active`: show top-N most-recently-synced active rows
 * Both default to 5 rows; configurable via widget config (`limit: 1..20`).
 */

interface Integration {
  id: string;
  name: string;
  category: "communication" | "productivity" | "development" | "custom_mcp";
  integration_type: string;
  status: "active" | "needs_attention" | "disconnected";
  last_synced_at?: string;
}

const STATUS_DOT: Record<Integration["status"], string> = {
  active: "bg-emerald-400",
  needs_attention: "bg-amber-400",
  disconnected: "bg-red-400",
};

const STATUS_LABEL: Record<Integration["status"], string> = {
  active: "Active",
  needs_attention: "Attention",
  disconnected: "Disconnected",
};

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface Config extends Record<string, unknown> {
  limit: number;
  focus: "attention" | "active";
}

export default function IntegrationsWidget() {
  const { config } = useWidgetConfig<Config>({ limit: 5, focus: "attention" });
  const limit = Math.min(Math.max(config.limit, 1), 20);

  const { data: integrations = [], isLoading, isError, error, refetch } = useQuery<Integration[]>({
    queryKey: ["integrations", "all"],
    queryFn: () => api.get("/integrations").then((r) => r.data),
    refetchInterval: 60_000,
  });

  const filtered =
    config.focus === "active"
      ? integrations.filter((i) => i.status === "active")
      : integrations.filter((i) => i.status !== "active");

  // Newest sync first when active-focused; alphabetical otherwise (the
  // attention list is unsynced or stale, so a recency sort is misleading).
  const sorted =
    config.focus === "active"
      ? [...filtered].sort(
          (a, b) =>
            new Date(b.last_synced_at ?? 0).getTime() - new Date(a.last_synced_at ?? 0).getTime(),
        )
      : [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const visible = sorted.slice(0, limit);

  const counts = {
    total: integrations.length,
    active: integrations.filter((i) => i.status === "active").length,
    attention: integrations.filter((i) => i.status !== "active").length,
  };

  return (
    <div className="rounded-lg border border-border-dark/60 bg-surface-dark/60 p-3">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">Integrations</h3>
        <Link
          href="/office/integrations"
          className="text-[10px] text-primary hover:underline"
          data-inline
        >
          {counts.active}/{counts.total} active
        </Link>
      </header>

      {isError ? (
        <QueryError compact error={error} onRetry={() => refetch()} label="Integrations unavailable" />
      ) : isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-text-muted py-3 text-center">
          {config.focus === "attention"
            ? counts.total === 0
              ? "No integrations connected."
              : "All integrations are healthy."
            : "No active integrations."}
        </div>
      ) : (
        <ul className="space-y-1">
          {visible.map((i) => (
            <li key={i.id}>
              <Link
                href={`/office/integrations#${i.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-primary/10 transition-colors"
                data-inline
              >
                <span
                  className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[i.status]}`}
                  aria-label={STATUS_LABEL[i.status]}
                />
                <span className="text-xs font-medium truncate flex-1">{i.name}</span>
                <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                  {config.focus === "active" ? timeAgo(i.last_synced_at) : STATUS_LABEL[i.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
