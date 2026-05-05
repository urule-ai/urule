"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useWidgetConfig } from "../useWidgetConfig";

/*
 * Compact activity-log widget — last N events as a tight list. The full
 * /office/logs page does the filtering / search; this is the at-a-glance
 * "what happened recently" tile. 5 rows by default; configurable via
 * widget config (`limit: 1..20`).
 */

interface ActivityLog {
  id: string;
  actor_id?: string;
  actor_type: "user" | "agent" | "system";
  event_type: "success" | "modification" | "integration" | "critical" | "warning" | "info";
  title: string;
  created_at: string;
}

const EVENT_DOT: Record<ActivityLog["event_type"], string> = {
  success: "bg-emerald-400",
  modification: "bg-sky-400",
  integration: "bg-violet-400",
  critical: "bg-red-400",
  warning: "bg-orange-400",
  info: "bg-text-muted",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ActivityLogsWidget() {
  const { config } = useWidgetConfig<{ limit: number }>({ limit: 5 });
  const limit = Math.min(Math.max(config.limit, 1), 20);

  const { data: logs = [], isLoading, isError, error, refetch } = useQuery<ActivityLog[]>({
    queryKey: ["logs", "recent"],
    queryFn: () => api.get("/logs").then((r) => r.data),
    refetchInterval: 30_000,
  });

  const visible = logs.slice(0, limit);

  return (
    <div className="rounded-lg border border-border-dark/60 bg-surface-dark/60 p-3">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Recent Activity
        </h3>
        <Link
          href="/office/logs"
          className="text-[10px] text-primary hover:underline"
          data-inline
        >
          View all
        </Link>
      </header>

      {isError ? (
        <QueryError compact error={error} onRetry={() => refetch()} label="Activity unavailable" />
      ) : isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-text-muted py-4 text-center">No recent activity.</div>
      ) : (
        <ul className="space-y-1">
          {visible.map((log) => (
            <li key={log.id} className="flex items-center gap-2 px-2 py-1">
              <span
                className={`size-1.5 rounded-full shrink-0 ${EVENT_DOT[log.event_type]}`}
                aria-label={log.event_type}
              />
              <span className="text-xs truncate flex-1">{log.title}</span>
              <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                {timeAgo(log.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
