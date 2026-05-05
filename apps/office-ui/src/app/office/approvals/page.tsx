"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { SkeletonList } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import type { Approval } from "@/types";

// ── Status config ──────────────────────────────────────────────────────────────

type ApprovalStatus = Approval["status"];

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  pending: {
    label: "Pending",
    bg: "bg-orange-500/15",
    text: "text-orange-400",
    dot: "bg-orange-400",
  },
  approved: {
    label: "Approved",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  rejected: {
    label: "Rejected",
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    dot: "bg-rose-400",
  },
  changes_requested: {
    label: "Changes Requested",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
};

const RISK_CONFIG: Record<
  Approval["risk_level"],
  { label: string; color: string }
> = {
  low: { label: "Low", color: "text-green-400" },
  medium: { label: "Medium", color: "text-yellow-400" },
  high: { label: "High", color: "text-orange-400" },
  critical: { label: "Critical", color: "text-red-400" },
};

const FILTER_TABS: { value: ApprovalStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "changes_requested", label: "Changes Requested" },
];

// ── Time ago helper ────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Approval card ──────────────────────────────────────────────────────────────

function ApprovalCard({ approval }: { approval: Approval }) {
  const status = STATUS_CONFIG[approval.status];
  const risk = RISK_CONFIG[approval.risk_level];

  return (
    <Link
      href={`/office/approvals/${approval.id}`}
      className="glass-panel rounded-xl p-5 flex items-center gap-5 group hover:border-primary/40 transition-all"
    >
      {/* Status badge */}
      <div className="shrink-0">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            status.bg,
            status.text
          )}
        >
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>

      {/* Request info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono text-text-muted">
            {approval.request_id}
          </span>
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider",
              risk.color
            )}
          >
            <span className="icon text-sm">shield</span>
            {risk.label}
          </span>
        </div>
        <h3 className="text-sm font-bold group-hover:text-primary transition-colors truncate">
          {approval.title}
        </h3>
      </div>

      {/* Agent + timestamp */}
      <div className="shrink-0 text-right space-y-1">
        {approval.agent && (
          <p className="text-xs text-slate-400 flex items-center gap-1.5 justify-end">
            <span className="icon text-sm">smart_toy</span>
            {approval.agent.name}
          </p>
        )}
        <p className="text-[11px] text-text-muted font-mono">
          {timeAgo(approval.created_at)}
        </p>
      </div>

      {/* Chevron */}
      <span className="icon text-text-muted group-hover:text-primary transition-colors shrink-0">
        chevron_right
      </span>
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">(
    "all"
  );

  const { data: approvals = [], isLoading, isError, error, refetch } = useQuery<Approval[]>({
    queryKey: ["approvals", statusFilter],
    queryFn: () =>
      api
        .get("/approvals", {
          params: {
            status_filter: statusFilter === "all" ? undefined : statusFilter,
          },
        })
        .then((r) => r.data),
  });

  return (
    <div className="p-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-black">Approval Queue</h1>
        <span className="px-2.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 text-xs font-bold tabular-nums">
          {approvals.length}
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-bold border transition-all",
              statusFilter === tab.value
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-surface-dark border-border-dark text-text-muted hover:border-primary/30"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Approval list */}
      {isError ? (
        <QueryError error={error} onRetry={() => refetch()} label="Couldn't load approvals" />
      ) : isLoading ? (
        <SkeletonList count={6} />
      ) : approvals.length === 0 ? (
        <div className="glass-panel rounded-xl p-16 text-center">
          <span className="icon text-5xl text-text-muted">
            verified_user
          </span>
          <p className="mt-4 font-bold text-lg">No approvals found</p>
          <p className="text-text-muted text-sm mt-1">
            {statusFilter !== "all"
              ? "Try adjusting your filter to see more results"
              : "When agents request actions that need review, they will appear here"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
    </div>
  );
}
