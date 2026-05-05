import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NotificationKind = 'success' | 'error' | 'warning' | 'info';

export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** ISO 8601 timestamp of when the notification was added. */
  createdAt: string;
  /** Read state — flips on Mark-as-read or "Mark all read". */
  read: boolean;
  /**
   * Optional deep-link target. Click on the notification routes here.
   * Useful for "approval pending — click to review" entries; for plain
   * toast mirrors this is left undefined.
   */
  href?: string;
  /**
   * Source label — e.g. `'toast'`, `'approval'`, `'system'`. Mostly for
   * filtering UI / analytics.
   */
  source?: string;
}

interface NotificationCenterState {
  notifications: NotificationEntry[];
  open: boolean;

  add: (entry: Omit<NotificationEntry, 'id' | 'createdAt' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;

  unreadCount: () => number;
}

const MAX_ENTRIES = 100;

export const useNotificationCenterStore = create<NotificationCenterState>()(
  persist(
    (set, get) => ({
      notifications: [],
      open: false,

      add: (entry) =>
        set((state) => {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const next: NotificationEntry = {
            ...entry,
            id,
            createdAt: new Date().toISOString(),
            read: false,
          };
          // Newest first, capped at MAX_ENTRIES so localStorage doesn't bloat.
          const all = [next, ...state.notifications].slice(0, MAX_ENTRIES);
          return { notifications: all };
        }),

      markRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      remove: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clear: () => set({ notifications: [] }),

      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,
    }),
    {
      name: 'urule-notification-center',
      // Only persist the list — not the open state (always closed on reload).
      partialize: (s) => ({ notifications: s.notifications }),
    },
  ),
);
