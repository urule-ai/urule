import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WidgetManifest } from "@/widgets/types";

/*
 * Persistent record of widget packages a workspace has installed via the
 * marketplace. Widgets live alongside the hardcoded `BUILTIN_MANIFESTS`
 * that ship with the office-ui bundle; this store tracks the third-party
 * additions a workspace has explicitly installed.
 *
 * Today the store is localStorage-backed only — server-side persistence
 * via the registry service is a follow-up. That means installed widgets
 * are per-browser, not per-workspace cluster-wide; sharing a workspace
 * between two devices means re-installing on each, which is the spike
 * floor. Once we add `installed_widgets` to the registry schema, this
 * store becomes a thin cache in front of that endpoint.
 *
 * Manifests are stored verbatim — we trust the publisher's signed
 * manifest. Validation happens at install time (extractWidgetManifest
 * in marketplace-api) so corrupt packages can't poison the registry.
 *
 * Keying: `byWorkspace[workspaceId]` is the manifest array. Empty
 * record for a workspace is indistinguishable from "never installed
 * anything" — both flow through to BUILTIN_MANIFESTS only.
 */

interface InstalledWidgetsState {
  byWorkspace: Record<string, WidgetManifest[]>;

  install: (workspaceId: string, manifest: WidgetManifest) => void;
  uninstall: (workspaceId: string, manifestId: string) => void;
  getInstalled: (workspaceId: string) => WidgetManifest[];
  /** Test seam — wipe all state. */
  clear: () => void;
}

export const useInstalledWidgetsStore = create<InstalledWidgetsState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},

      install: (workspaceId, manifest) =>
        set((state) => {
          const existing = state.byWorkspace[workspaceId] ?? [];
          // Idempotent: re-installing the same manifest id replaces the
          // previous entry (so a version bump from the marketplace
          // overwrites the old manifest cleanly).
          const filtered = existing.filter((m) => m.id !== manifest.id);
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: [...filtered, manifest],
            },
          };
        }),

      uninstall: (workspaceId, manifestId) =>
        set((state) => {
          const existing = state.byWorkspace[workspaceId];
          if (!existing) return state;
          const filtered = existing.filter((m) => m.id !== manifestId);
          // Empty the array slot rather than deleting it — keeps the
          // workspace key around so a "you have nothing installed" UI
          // can distinguish "never installed" from "uninstalled all".
          return {
            byWorkspace: { ...state.byWorkspace, [workspaceId]: filtered },
          };
        }),

      getInstalled: (workspaceId) => get().byWorkspace[workspaceId] ?? [],

      clear: () => set({ byWorkspace: {} }),
    }),
    {
      name: "urule-installed-widgets",
      partialize: (state) => ({ byWorkspace: state.byWorkspace }),
    },
  ),
);
