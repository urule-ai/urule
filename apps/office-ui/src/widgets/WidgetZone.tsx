"use client";

import { useMemo, useState } from "react";
import { useWidgetStore } from "@/store/useWidgetStore";
import { useDashboardLayoutStore } from "@/store/useDashboardLayoutStore";
import { useInstalledWidgetsStore } from "@/store/useInstalledWidgetsStore";
import { widgetRegistry } from "./registry";
import { NativeWidgetRenderer } from "./NativeWidgetRenderer";
import { WidgetFrame } from "./WidgetFrame";
import { widgetLoadDecision } from "./widget-frame-security";
import type { WidgetRenderContext } from "./context";
import type { WidgetInstance, WidgetMountPoint, WidgetTheme } from "./types";
import { cn } from "@/lib/utils";

const DEFAULT_THEME: WidgetTheme = {
  mode: "dark",
  colors: {
    primary: "#0db9f2",
    background: "#101e22",
    surface: "#182d34",
    text: "#90bccb",
    textMuted: "#315a68",
    border: "rgba(255,255,255,0.05)",
    accent: { success: "#0bda57", warning: "#f0c040", error: "#fa5f38" },
  },
  fontFamily: "Inter, system-ui, sans-serif",
  monoFontFamily: "JetBrains Mono, monospace",
};

interface WidgetZoneProps {
  mountPoint: WidgetMountPoint;
  workspaceId: string;
  className?: string;
  /**
   * When true, the zone honours the persisted dashboard-layout store +
   * surfaces drag handles in customize mode. Default false: read-only
   * zones (status-bar widgets, modal slots) shouldn't gain edit chrome.
   */
  reorderable?: boolean;
}

/*
 * Renders all active widget instances at a given mount point.
 *
 * Order resolution (in order of precedence):
 *   1. Persisted layout from `useDashboardLayoutStore.orders[key]` when
 *      `reorderable` and an entry exists.
 *   2. Registry's natural sort (instance.position) — fallback for
 *      first-time renders and for new instances appended after an
 *      existing layout was saved.
 *
 * In customize mode (`useDashboardLayoutStore.editing`) every reorderable
 * child gains an HTML5-DnD drag handle and acts as a drop target. The
 * implementation is inline (no external dep) — for ~10 sidebar/dashboard
 * tiles this is plenty.
 */
export function WidgetZone({ mountPoint, workspaceId, className, reorderable }: WidgetZoneProps) {
  const activeMainWidgetId = useWidgetStore((s) => s.activeMainWidgetId);
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setOrder = useDashboardLayoutStore((s) => s.setOrder);
  // #39 — subscribe to the verification map so an external widget only renders
  // once its publisher signature is verified (set at install time).
  const verifiedByWorkspace = useInstalledWidgetsStore((s) => s.verifiedByWorkspace);
  const persistedOrder = useDashboardLayoutStore((s) =>
    reorderable ? s.orders[`${workspaceId}::${mountPoint}`] : undefined,
  );

  const naturalInstances = widgetRegistry.getInstancesByMountPoint(workspaceId, mountPoint);

  const ordered: WidgetInstance[] = useMemo(() => {
    if (!persistedOrder || persistedOrder.length === 0) return naturalInstances;
    const byId = new Map(naturalInstances.map((i) => [i.id, i]));
    const out: WidgetInstance[] = [];
    const seen = new Set<string>();
    for (const id of persistedOrder) {
      const inst = byId.get(id);
      if (inst) {
        out.push(inst);
        seen.add(id);
      }
    }
    for (const inst of naturalInstances) {
      if (!seen.has(inst.id)) out.push(inst);
    }
    return out;
  }, [persistedOrder, naturalInstances]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (ordered.length === 0) return null;

  const layoutClass = getLayoutClass(mountPoint);
  const editMode = !!reorderable && editing;

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...ordered];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved!);
    setOrder(workspaceId, mountPoint, next.map((i) => i.id));
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className={cn(layoutClass, className)}>
      {ordered.map((instance, index) => {
        const manifest = widgetRegistry.getManifest(instance.manifestId);
        if (!manifest) return null;

        if (mountPoint === "main-panel" && activeMainWidgetId && activeMainWidgetId !== instance.id) {
          return null;
        }

        const context: WidgetRenderContext = {
          widgetId: instance.id,
          manifestId: instance.manifestId,
          workspaceId: instance.workspaceId,
          mountPoint: instance.mountPoint,
          config: instance.config,
          theme: DEFAULT_THEME,
          permissions: manifest.permissions,
        };

        const isDragging = dragIndex === index;
        const isOver = overIndex === index && dragIndex !== index;

        return (
          <div
            key={instance.id}
            className={cn(
              "widget-container",
              editMode && "relative",
              editMode && isOver && "outline outline-2 outline-primary/60 rounded-lg",
              editMode && isDragging && "opacity-40",
            )}
            draggable={editMode}
            onDragStart={editMode ? () => setDragIndex(index) : undefined}
            onDragOver={
              editMode
                ? (e) => {
                    e.preventDefault();
                    if (overIndex !== index) setOverIndex(index);
                  }
                : undefined
            }
            onDragLeave={
              editMode
                ? () => {
                    if (overIndex === index) setOverIndex(null);
                  }
                : undefined
            }
            onDrop={
              editMode
                ? (e) => {
                    e.preventDefault();
                    handleDrop(index);
                  }
                : undefined
            }
            onDragEnd={
              editMode
                ? () => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }
                : undefined
            }
          >
            {editMode && (
              <span
                className="absolute -top-1 -left-1 z-10 size-6 rounded-md bg-primary/20 border border-primary/40 text-primary flex items-center justify-center cursor-grab active:cursor-grabbing"
                aria-label={`Drag ${manifest.name}`}
                title="Drag to reorder"
              >
                <span className="icon text-[14px]">drag_indicator</span>
              </span>
            )}
            {manifest.entryType === "native" && manifest.componentPath ? (
              <NativeWidgetRenderer context={context} componentPath={manifest.componentPath} />
            ) : manifest.entryType === "external" && manifest.entryUrl ? (
              widgetLoadDecision(
                "external",
                verifiedByWorkspace[workspaceId]?.[manifest.id]?.verified === true,
              ).allowed ? (
                <WidgetFrame context={context} entryUrl={manifest.entryUrl} />
              ) : (
                <div className="p-4 text-accent-warning text-sm">
                  <span className="icon mr-1">gpp_bad</span>
                  Unverified widget — {manifest.name} was not loaded (no valid publisher signature).
                </div>
              )
            ) : (
              <div className="p-4 text-accent-warning text-sm">
                <span className="icon mr-1">error</span>
                Invalid widget configuration for {manifest.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getLayoutClass(mountPoint: WidgetMountPoint): string {
  switch (mountPoint) {
    case "sidebar":
      return "flex flex-col gap-2";
    case "main-panel":
      return "flex-1 overflow-y-auto";
    case "drawer":
      return "flex flex-col gap-2";
    case "modal":
      return "fixed inset-0 z-50 flex items-center justify-center bg-black/50";
    case "status-bar":
      return "flex items-center gap-4";
    default:
      return "";
  }
}
