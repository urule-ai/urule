"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { useWidgetConfig } from "../useWidgetConfig";
import type { Approval } from "@/types";

/*
 * Compact approval-queue widget — shows the most recent pending items
 * without the full /office/approvals page chrome (filter tabs, full
 * cards). Suitable for sidebar / dashboard tiles where vertical space
 * is finite. Clicking any row deep-links to the full page; no in-widget
 * approve/reject (avoids duplicating the page's decision workflow).
 * Default 5 rows; configurable via widget config (`limit: 1..20`).
 */

const RISK_DOT: Record<Approval["risk_level"], string> = {
  low: "bg-green-400",
  medium: "bg-yellow-400",
  high: "bg-orange-400",
  critical: "bg-red-400",
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

export default function ApprovalQueueWidget() {
  const { config } = useWidgetConfig<{ limit: number }>({ limit: 5 });
  const limit = Math.min(Math.max(config.limit, 1), 20);

  const { data: approvals = [], isLoading } = useQuery<Approval[]>({
    queryKey: ["approvals", "pending"],
    queryFn: () =>
      api.get("/approvals", { params: { status_filter: "pending" } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const visible = approvals.slice(0, limit);

  return (
    <div className="rounded-lg border border-border-dark/60 bg-surface-dark/60 p-3">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Pending Approvals
        </h3>
        <Link
          href="/office/approvals"
          className="text-[10px] text-primary hover:underline"
          data-inline
        >
          View all ({approvals.length})
        </Link>
      </header>

      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-text-muted py-4 text-center">No pending approvals.</div>
      ) : (
        <ul className="space-y-1">
          {visible.map((a) => (
            <li key={a.id}>
              <Link
                href={`/office/approvals#${a.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-primary/10 transition-colors"
                data-inline
              >
                <span
                  className={`size-1.5 rounded-full shrink-0 ${RISK_DOT[a.risk_level]}`}
                  aria-label={`${a.risk_level} risk`}
                />
                <span className="text-xs font-medium truncate flex-1">{a.title}</span>
                <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                  {timeAgo(a.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
