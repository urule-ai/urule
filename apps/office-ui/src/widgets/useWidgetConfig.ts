"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useWidget } from "./context";

/**
 * Persist widget configuration to the state service.
 *
 * Each widget instance has a `widgetId` (instanceId) — the same identifier
 * the state service uses for `/api/v1/widget-state/:instanceId`. On mount,
 * we GET the persisted state (404 → fall back to manifest defaults). Every
 * call to `update()` debounces a PATCH so quick toggles don't flood the
 * network. The hook returns the current config + an updater that does
 * partial merges, mirroring the WidgetStateManager.patchState shape.
 *
 * Lazy-create on first save: PATCH 404s when no row exists yet, so we
 * fall through to PUT (which creates the row). After the first PUT, all
 * subsequent saves stay on PATCH for minimal payload.
 *
 * Errors are surfaced to the console; the in-memory state stays correct
 * so the widget keeps working even if persistence is temporarily broken.
 */
export function useWidgetConfig<T extends Record<string, unknown>>(
  defaults: T,
): {
  config: T;
  ready: boolean;
  update: (patch: Partial<T>) => void;
  reset: () => void;
} {
  const widget = useWidget();
  const { widgetId, workspaceId } = widget;
  const [config, setConfig] = useState<T>({ ...defaults, ...(widget.config as Partial<T>) } as T);
  const [ready, setReady] = useState(false);
  const hasRowRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Partial<T>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/v1/widget-state/${encodeURIComponent(widgetId)}`)
      .then((res) => {
        if (cancelled) return;
        const persisted = (res.data?.state ?? {}) as Partial<T>;
        hasRowRef.current = true;
        setConfig((prev) => ({ ...prev, ...persisted }));
      })
      .catch((err: { response?: { status?: number } }) => {
        // 404 = first time this widget instance loads; defaults stand.
        if (err.response?.status !== 404) {
          console.warn(`[useWidgetConfig] load failed for ${widgetId}`, err);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [widgetId]);

  function flush() {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;

    if (!hasRowRef.current) {
      // First save: PUT to create the row, then mark hasRow.
      api
        .put(`/api/v1/widget-state/${encodeURIComponent(widgetId)}`, {
          workspaceId,
          state: { ...config, ...patch },
        })
        .then(() => {
          hasRowRef.current = true;
        })
        .catch((err) => console.warn(`[useWidgetConfig] PUT failed for ${widgetId}`, err));
      return;
    }
    api
      .patch(`/api/v1/widget-state/${encodeURIComponent(widgetId)}`, { patch })
      .catch((err: { response?: { status?: number } }) => {
        // Row was deleted out from under us — fall back to PUT and re-mark.
        if (err.response?.status === 404) {
          hasRowRef.current = false;
          pendingPatch.current = { ...patch, ...pendingPatch.current };
          flush();
          return;
        }
        console.warn(`[useWidgetConfig] PATCH failed for ${widgetId}`, err);
      });
  }

  function update(patch: Partial<T>): void {
    setConfig((prev) => ({ ...prev, ...patch }));
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // 400ms debounce: short enough that closing a tab still typically
    // catches the save, long enough to coalesce a settings panel's
    // on-change cascade into one network call.
    saveTimer.current = setTimeout(flush, 400);
  }

  function reset(): void {
    setConfig({ ...defaults });
    pendingPatch.current = { ...defaults };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 0);
  }

  // Flush pending writes on unmount so quick remount/dismiss flows don't
  // lose the most recent edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flush();
      }
    };
  }, []);

  return { config, ready, update, reset };
}
