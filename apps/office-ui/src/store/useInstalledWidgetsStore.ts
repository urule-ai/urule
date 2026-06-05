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

/**
 * #39 — per-manifest publisher-signature verification, kept in a map parallel to
 * `byWorkspace` (rather than on the manifest) so it's host-only state that never
 * touches the widget-sdk contract. `verified: false` is the fail-closed default
 * for legacy/unknown entries.
 */
export interface WidgetVerification {
  verified: boolean;
  publisher: string | null;
}

interface InstalledWidgetsState {
  byWorkspace: Record<string, WidgetManifest[]>;
  verifiedByWorkspace: Record<string, Record<string, WidgetVerification>>;

  install: (workspaceId: string, manifest: WidgetManifest, verification?: WidgetVerification) => void;
  uninstall: (workspaceId: string, manifestId: string) => void;
  getInstalled: (workspaceId: string) => WidgetManifest[];
  /** #39 — has this installed manifest been verified? Fail-closed (false) when unknown. */
  isVerified: (workspaceId: string, manifestId: string) => boolean;
  /** Test seam — wipe all state. */
  clear: () => void;
}

export const useInstalledWidgetsStore = create<InstalledWidgetsState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      verifiedByWorkspace: {},

      install: (workspaceId, manifest, verification) =>
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
            verifiedByWorkspace: {
              ...state.verifiedByWorkspace,
              [workspaceId]: {
                ...(state.verifiedByWorkspace[workspaceId] ?? {}),
                [manifest.id]: verification ?? { verified: false, publisher: null },
              },
            },
          };
        }),

      uninstall: (workspaceId, manifestId) =>
        set((state) => {
          const existing = state.byWorkspace[workspaceId];
          if (!existing) return state;
          const filtered = existing.filter((m) => m.id !== manifestId);
          const verified = { ...(state.verifiedByWorkspace[workspaceId] ?? {}) };
          delete verified[manifestId];
          // Empty the array slot rather than deleting it — keeps the
          // workspace key around so a "you have nothing installed" UI
          // can distinguish "never installed" from "uninstalled all".
          return {
            byWorkspace: { ...state.byWorkspace, [workspaceId]: filtered },
            verifiedByWorkspace: { ...state.verifiedByWorkspace, [workspaceId]: verified },
          };
        }),

      getInstalled: (workspaceId) => get().byWorkspace[workspaceId] ?? [],

      isVerified: (workspaceId, manifestId) =>
        get().verifiedByWorkspace[workspaceId]?.[manifestId]?.verified === true,

      clear: () => set({ byWorkspace: {}, verifiedByWorkspace: {} }),
    }),
    {
      name: "urule-installed-widgets",
      version: 1,
      partialize: (state) => ({
        byWorkspace: state.byWorkspace,
        verifiedByWorkspace: state.verifiedByWorkspace,
      }),
      // v0 persisted only `byWorkspace`. Carry it forward with an empty
      // verification map so every pre-existing entry reads as unverified
      // (fail-closed) until re-installed.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<{
          byWorkspace: Record<string, WidgetManifest[]>;
          verifiedByWorkspace: Record<string, Record<string, WidgetVerification>>;
        }>;
        return {
          byWorkspace: state.byWorkspace ?? {},
          verifiedByWorkspace: version === 0 ? {} : (state.verifiedByWorkspace ?? {}),
        };
      },
    },
  ),
);
