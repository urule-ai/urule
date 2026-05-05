"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { QueryError } from "@/components/ui/QueryError";

// ── Types ───────────────────────────────────────────────────────────────────

interface ActivityLog {
  id: string;
  actor_id?: string;
  actor_type: "user" | "agent" | "system";
  event_type:
    | "success"
    | "modification"
    | "integration"
    | "critical"
    | "warning"
    | "info";
  title: string;
  description?: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

interface Notification {
  id: string;
  category: "urgent" | "approval" | "system";
  title: string;
  body?: string;
  action_url?: string;
  action_label?: string;
  approval_id?: string;
  is_read: boolean;
  created_at: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<
  ActivityLog["event_type"],
  { label: string; className: string }
> = {
  success: {
    label: "SUCCESS",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  modification: {
    label: "MODIFICATION",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  integration: {
    label: "INTEGRATION",
    className: "bg-primary/15 text-primary border-primary/30",
  },
  critical: {
    label: "CRITICAL",
    className: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  },
  warning: {
    label: "WARNING",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  info: {
    label: "INFO",
    className: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  },
};

const ACTOR_DOT_CLASS: Record<ActivityLog["actor_type"], string> = {
  agent: "bg-primary",
  user: "bg-slate-400",
  system: "bg-primary/10 border border-primary/40",
};

const ACTOR_TYPES: ActivityLog["actor_type"][] = ["user", "agent", "system"];
const EVENT_TYPES: ActivityLog["event_type"][] = [
  "success",
  "modification",
  "integration",
  "critical",
  "warning",
  "info",
];

const NOTIFICATION_CONFIG: Record<
  Notification["category"],
  { label: string; icon: string; color: string; borderClass: string; bgClass: string }
> = {
  urgent: {
    label: "URGENT",
    icon: "warning",
    color: "text-rose-400",
    borderClass: "border-rose-500/30",
    bgClass: "bg-rose-500/10",
  },
  approval: {
    label: "APPROVALS",
    icon: "task_alt",
    color: "text-primary",
    borderClass: "border-primary/30",
    bgClass: "bg-primary/10",
  },
  system: {
    label: "SYSTEM",
    icon: "settings",
    color: "text-slate-400",
    borderClass: "border-slate-500/30",
    bgClass: "bg-slate-500/10",
  },
};

// ── FilterPill ──────────────────────────────────────────────────────────────

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

// ── Timestamp helper ────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function relativeTime(iso: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 1000
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── EventCard ───────────────────────────────────────────────────────────────

function EventCard({
  log,
  isLast,
}: {
  log: ActivityLog;
  isLast: boolean;
}) {
  const badge = EVENT_TYPE_CONFIG[log.event_type] ?? EVENT_TYPE_CONFIG.info;
  const dotClass = ACTOR_DOT_CLASS[log.actor_type] ?? ACTOR_DOT_CLASS.system;

  return (
    <div className="relative flex gap-4">
      {/* Timeline column */}
      <div className="flex flex-col items-center">
        <div
          className={cn("size-3 rounded-full shrink-0 mt-1.5", dotClass)}
        />
        {!isLast && (
          <div className="w-px flex-1 border-l border-border-dark/60" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="glass-panel rounded-xl p-4 space-y-2 hover:border-primary/20 transition-all">
          {/* Top row: badge + timestamp */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border",
                  badge.className
                )}
              >
                {badge.label}
              </span>
              <span className="text-[10px] text-text-muted uppercase tracking-widest font-mono">
                {log.actor_type}
              </span>
            </div>
            <span className="text-[11px] text-text-muted font-mono shrink-0">
              {formatTimestamp(log.created_at)}
            </span>
          </div>

          {/* Title */}
          <p className="text-sm font-bold leading-snug">{log.title}</p>

          {/* Description */}
          {log.description && (
            <p className="text-xs text-text-muted leading-relaxed">
              {log.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NotificationCard ────────────────────────────────────────────────────────

function NotificationCard({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  const config =
    NOTIFICATION_CONFIG[notification.category] ?? NOTIFICATION_CONFIG.system;

  return (
    <div
      className={cn(
        "p-3 rounded-lg border transition-all space-y-2",
        notification.is_read
          ? "border-border-dark/40 bg-background-dark/30 opacity-60"
          : cn(config.borderClass, config.bgClass)
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "text-xs font-bold leading-snug",
            notification.is_read ? "text-text-muted" : ""
          )}
        >
          {notification.title}
        </p>
        {!notification.is_read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="shrink-0 text-text-muted hover:text-primary transition-colors"
            title="Mark as read"
          >
            <span className="icon text-base">done</span>
          </button>
        )}
      </div>

      {notification.body && (
        <p className="text-[11px] text-text-muted leading-relaxed">
          {notification.body}
        </p>
      )}

      <div className="flex items-center justify-between">
        {notification.action_url && notification.action_label && (
          <a
            href={notification.action_url}
            className={cn("text-[11px] font-bold hover:underline", config.color)}
          >
            {notification.action_label}
          </a>
        )}
        <span className="text-[10px] text-text-muted font-mono ml-auto">
          {relativeTime(notification.created_at)}
        </span>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ActivityLogsPage() {
  const queryClient = useQueryClient();

  // ── Filter state ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState<ActivityLog["actor_type"] | null>(null);
  const [eventFilter, setEventFilter] = useState<ActivityLog["event_type"] | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────
  const filters = { actor_type: actorFilter, event_type: eventFilter, search: search || undefined };

  const {
    data: logs = [],
    isLoading: logsLoading,
    isError: logsError,
    error: logsErr,
    refetch: refetchLogs,
  } = useQuery<ActivityLog[]>({
    queryKey: ["logs", filters],
    queryFn: () =>
      api
        .get("/logs", {
          params: {
            ...(actorFilter ? { actor_type: actorFilter } : {}),
            ...(eventFilter ? { event_type: eventFilter } : {}),
            ...(search ? { search } : {}),
          },
        })
        .then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<
    Notification[]
  >({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
    refetchInterval: 10000,
  });

  // ── Mark as read mutation ───────────────────────────────────────────────
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      Promise.all(
        notifications
          .filter((n) => !n.is_read)
          .map((n) => api.patch(`/notifications/${n.id}/read`))
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // ── Derived data ────────────────────────────────────────────────────────
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const groupedNotifications = useMemo(() => {
    const groups: Record<Notification["category"], Notification[]> = {
      urgent: [],
      approval: [],
      system: [],
    };
    for (const n of notifications) {
      groups[n.category]?.push(n);
    }
    return groups;
  }, [notifications]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* ── Center: Live Events Feed ──────────────────────────────────────── */}
      <div className="flex-1 p-8 overflow-y-auto space-y-6">
        {/* Page header */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black">Activity Logs</h1>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex size-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-success opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent-success" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent-success">
              Live Events Feed
            </span>
            <span className="text-[10px] text-text-muted font-mono ml-2">
              Real-time tracking enabled
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-lg">
          <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-dark border border-border-dark rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Actor:
            </span>
            <FilterPill
              active={actorFilter === null}
              onClick={() => setActorFilter(null)}
            >
              All
            </FilterPill>
            {ACTOR_TYPES.map((a) => (
              <FilterPill
                key={a}
                active={actorFilter === a}
                onClick={() => setActorFilter(actorFilter === a ? null : a)}
              >
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Event:
            </span>
            <FilterPill
              active={eventFilter === null}
              onClick={() => setEventFilter(null)}
            >
              All
            </FilterPill>
            {EVENT_TYPES.map((e) => (
              <FilterPill
                key={e}
                active={eventFilter === e}
                onClick={() => setEventFilter(eventFilter === e ? null : e)}
              >
                {EVENT_TYPE_CONFIG[e].label}
              </FilterPill>
            ))}
          </div>
        </div>

        {/* Timeline */}
        {logsError ? (
          <QueryError error={logsErr} onRetry={() => refetchLogs()} label="Couldn't load activity" />
        ) : logsLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="glass-panel rounded-xl p-5 h-24 animate-pulse"
              />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="glass-panel rounded-xl p-16 text-center">
            <span className="icon text-5xl text-text-muted">event_note</span>
            <p className="mt-4 font-bold text-lg">No events found</p>
            <p className="text-text-muted text-sm mt-1">
              {search || actorFilter || eventFilter
                ? "Try adjusting your filters"
                : "Activity events will appear here in real time"}
            </p>
          </div>
        ) : (
          <div>
            {logs.map((log, i) => (
              <EventCard
                key={log.id}
                log={log}
                isLast={i === logs.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Right: Notification Center ────────────────────────────────────── */}
      <aside className="w-80 border-l border-border-dark p-6 overflow-y-auto space-y-6 shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="icon text-xl text-primary">notifications</span>
            <h2 className="text-sm font-black uppercase tracking-wider">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-black">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors uppercase tracking-wider"
            >
              Mark All Read
            </button>
          )}
        </div>

        {notificationsLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-20 bg-surface-dark rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-10">
            <span className="icon text-4xl text-text-muted">
              notifications_none
            </span>
            <p className="text-sm text-text-muted mt-3">No notifications</p>
          </div>
        ) : (
          (["urgent", "approval", "system"] as Notification["category"][]).map(
            (category) => {
              const items = groupedNotifications[category];
              if (items.length === 0) return null;
              const config = NOTIFICATION_CONFIG[category];

              return (
                <div key={category} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("icon text-sm", config.color)}>
                      {config.icon}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest",
                        config.color
                      )}
                    >
                      {config.label}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono">
                      ({items.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {items.map((n) => (
                      <NotificationCard
                        key={n.id}
                        notification={n}
                        onMarkRead={(id) => markRead.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              );
            }
          )
        )}
      </aside>
    </div>
  );
}
