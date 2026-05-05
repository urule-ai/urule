import { create } from "zustand";
import { persist } from "zustand/middleware";

/*
 * Persisted per-mountpoint widget order. Keyed by `${workspaceId}::${mountPoint}`
 * so the same workspace can have a different sidebar layout than its
 * dashboard, and adding a workspace doesn't drag along another's order.
 *
 * Store *only* the ordered id list — the actual widget instances live in
 * the in-memory registry. When the registry has instances the store
 * doesn't know about (e.g. a freshly-installed widget), they fall through
 * to the registry's natural sort and get appended to the end. When the
 * store has ids the registry doesn't have anymore, those entries are
 * pruned at read time.
 *
 * `editing` is the global toggle for "customize layout" mode — flipped
 * by a header button, drives the DnD-aware path inside WidgetZone.
 */

interface DashboardLayoutState {
  orders: Record<string, string[]>;
  editing: boolean;

  setOrder: (workspaceId: string, mountPoint: string, ids: string[]) => void;
  getOrder: (workspaceId: string, mountPoint: string) => string[] | undefined;
  resetOrder: (workspaceId: string, mountPoint: string) => void;
  setEditing: (editing: boolean) => void;
  toggleEditing: () => void;
}

function key(workspaceId: string, mountPoint: string): string {
  return `${workspaceId}::${mountPoint}`;
}

export const useDashboardLayoutStore = create<DashboardLayoutState>()(
  persist(
    (set, get) => ({
      orders: {},
      editing: false,

      setOrder: (workspaceId, mountPoint, ids) =>
        set((state) => ({
          orders: { ...state.orders, [key(workspaceId, mountPoint)]: ids },
        })),

      getOrder: (workspaceId, mountPoint) => get().orders[key(workspaceId, mountPoint)],

      resetOrder: (workspaceId, mountPoint) =>
        set((state) => {
          const next = { ...state.orders };
          delete next[key(workspaceId, mountPoint)];
          return { orders: next };
        }),

      setEditing: (editing) => set({ editing }),
      toggleEditing: () => set((state) => ({ editing: !state.editing })),
    }),
    {
      name: "urule-dashboard-layout",
      // Don't persist `editing`: on the next session the user expects a
      // read-only dashboard, not a leftover edit toolbar.
      partialize: (state) => ({ orders: state.orders }),
    },
  ),
);
