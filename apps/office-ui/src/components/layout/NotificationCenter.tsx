"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useNotificationCenterStore, type NotificationEntry } from "@/store/useNotificationCenterStore";

const KIND_ICON: Record<NotificationEntry['kind'], string> = {
  success: 'check_circle',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

const KIND_COLOR: Record<NotificationEntry['kind'], string> = {
  success: 'text-accent-success',
  info: 'text-primary',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Notification panel — a popover anchored to the bell icon in
 * AppHeader. Lists persisted notifications newest-first. Click an entry
 * to mark it read (and route to its `href` if set); top-bar actions
 * mark-all-read or clear.
 *
 * Accessibility: `role="dialog"` with focus management on open;
 * Escape closes; click outside closes. The bell button itself gets
 * `aria-haspopup="true"` and `aria-expanded` reflecting open state
 * (caller's job, see `<NotificationBell>` below).
 */
export function NotificationCenter() {
  const open = useNotificationCenterStore((s) => s.open);
  const setOpen = useNotificationCenterStore((s) => s.setOpen);
  const notifications = useNotificationCenterStore((s) => s.notifications);
  const markRead = useNotificationCenterStore((s) => s.markRead);
  const markAllRead = useNotificationCenterStore((s) => s.markAllRead);
  const clear = useNotificationCenterStore((s) => s.clear);
  const remove = useNotificationCenterStore((s) => s.remove);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Ignore clicks on the bell button itself — it manages toggling.
      const bell = document.querySelector('[data-testid="notification-bell"]');
      if (bell?.contains(target)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      aria-label="Notification center"
      data-testid="notification-center"
      className="fixed top-16 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 bg-neutral-900 shadow-2xl flex flex-col max-h-[70vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={markAllRead}
            disabled={notifications.length === 0}
            className="text-xs text-white/60 hover:text-white disabled:opacity-40"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={notifications.length === 0}
            data-testid="notification-clear-all"
            className="text-xs text-white/60 hover:text-white disabled:opacity-40"
          >
            Clear all
          </button>
        </div>
      </div>
      <ul role="list" className="flex-1 overflow-y-auto py-1">
        {notifications.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-white/50">
            No notifications yet.
          </li>
        ) : (
          notifications.map((n) => (
            <li
              key={n.id}
              data-testid={`notification-${n.id}`}
              data-read={n.read ? 'true' : 'false'}
              className={`group flex items-start gap-3 px-4 py-3 hover:bg-white/5 ${n.read ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                onClick={() => {
                  markRead(n.id);
                  if (n.href) {
                    router.push(n.href);
                    setOpen(false);
                  }
                }}
                className="flex-1 flex items-start gap-3 text-left"
              >
                <span className={`icon text-[18px] mt-0.5 ${KIND_COLOR[n.kind]}`} aria-hidden>
                  {KIND_ICON[n.kind]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{n.title}</div>
                  {n.body && <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] uppercase tracking-wide text-white/40 mt-1">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.read && (
                  <span aria-label="Unread" className="size-2 rounded-full bg-primary mt-1.5 shrink-0" />
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(n.id)}
                aria-label={`Dismiss notification: ${n.title}`}
                className="opacity-0 group-hover:opacity-100 transition-opacity size-6 rounded hover:bg-white/10 flex items-center justify-center text-white/60"
              >
                <span className="icon text-[14px]" aria-hidden>close</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * Bell icon button + unread badge. Drop-in for AppHeader. Toggles the
 * notification center on click; reflects unread count in the badge.
 */
export function NotificationBell() {
  const toggle = useNotificationCenterStore((s) => s.toggle);
  const open = useNotificationCenterStore((s) => s.open);
  const unread = useNotificationCenterStore((s) => s.notifications.filter((n) => !n.read).length);

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="notification-bell"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      className="relative p-2 rounded-lg hover:bg-primary/10 transition-colors"
    >
      <span className="icon text-text-muted text-[22px]">notifications</span>
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
          data-testid="notification-badge"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}
