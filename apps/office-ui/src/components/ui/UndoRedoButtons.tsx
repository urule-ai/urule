"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

/*
 * Drop-in undo/redo button pair for forms wired to useFormHistory.
 *
 *   const history = useFormHistory({ value, onRestore });
 *   <UndoRedoButtons history={history} />
 *
 * Also wires the conventional Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z keyboard
 * shortcuts for the lifetime of the component. Disabled by default
 * inside <input>/<textarea>/[contenteditable] so the browser's native
 * field-level undo isn't shadowed; pass `captureInFields` to override.
 */

interface UndoRedoButtonsProps {
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
  /** When true, keyboard shortcuts capture even inside text fields. */
  captureInFields?: boolean;
  className?: string;
}

function isInEditableField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function UndoRedoButtons({ history, captureInFields, className }: UndoRedoButtonsProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "z") return;
      if (!captureInFields && isInEditableField(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (history.canRedo) history.redo();
      } else {
        if (history.canUndo) history.undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, captureInFields]);

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={history.undo}
        disabled={!history.canUndo}
        title="Undo (Cmd/Ctrl+Z)"
        aria-label="Undo"
        className={cn(
          "size-9 rounded-lg flex items-center justify-center transition-colors",
          "border border-border-dark",
          history.canUndo
            ? "bg-surface-dark hover:bg-primary/10 text-text-muted hover:text-primary"
            : "bg-surface-dark/50 text-text-muted/40 cursor-not-allowed",
        )}
      >
        <span className="icon text-[18px]">undo</span>
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!history.canRedo}
        title="Redo (Cmd/Ctrl+Shift+Z)"
        aria-label="Redo"
        className={cn(
          "size-9 rounded-lg flex items-center justify-center transition-colors",
          "border border-border-dark",
          history.canRedo
            ? "bg-surface-dark hover:bg-primary/10 text-text-muted hover:text-primary"
            : "bg-surface-dark/50 text-text-muted/40 cursor-not-allowed",
        )}
      >
        <span className="icon text-[18px]">redo</span>
      </button>
    </div>
  );
}
