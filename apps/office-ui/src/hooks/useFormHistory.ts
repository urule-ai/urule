"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Undo/redo for forms — maintains a snapshot stack of dirty states.
 *
 * Pairs with react-hook-form (or any reactive value source). The caller
 * passes the current `value` and an `onRestore` callback that wires
 * back into the form's reset path:
 *
 *   const value = watch();
 *   const history = useFormHistory({
 *     value,
 *     onRestore: (snap) => reset(snap, { keepDefaultValues: true }),
 *   });
 *   // <button onClick={history.undo} disabled={!history.canUndo}>Undo</button>
 *   // <button onClick={history.redo} disabled={!history.canRedo}>Redo</button>
 *
 * Snapshots are pushed on a debounce so rapid keystrokes coalesce into
 * one history entry per pause-typing-burst rather than per character.
 * `onRestore` calls flip an internal "applying" flag so the value-change
 * fired by `reset()` doesn't push a phantom snapshot back onto the stack.
 *
 * Pairs cleanly with useFormAutoSave (separate persistence concern):
 * undo/redo lives in memory, autosave lives in localStorage. A
 * page reload starts a fresh history and a restored draft.
 */

interface FormHistoryOptions<T> {
  /** Current form state — typically react-hook-form's watch() return. */
  value: T;
  /**
   * Apply a snapshot back to the form. For react-hook-form this is
   * `(snap) => reset(snap)`; for plain useState forms, the setter.
   * Called from undo()/redo().
   */
  onRestore: (snapshot: T) => void;
  /**
   * Maximum stack depth. Older entries are dropped from the bottom.
   * Default 50 — generous for typical edit sessions, bounded so
   * pathological agents (paste-storm bots) can't OOM the tab.
   */
  max?: number;
  /** Debounce window for snapshot capture. Default 600ms. */
  debounceMs?: number;
  /**
   * Equality check between successive values. Default JSON.stringify
   * comparison; pass a faster predicate when the form value contains
   * non-JSON-safe types (Dates, Files, Sets) or you have a known cheap
   * structural compare.
   */
  isEqual?: (a: T, b: T) => boolean;
}

interface FormHistoryApi {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Drop the entire history (e.g. on form submit). */
  reset: () => void;
  /** Stack depths — useful for debug HUDs. */
  size: { past: number; future: number };
}

function defaultIsEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function useFormHistory<T>(options: FormHistoryOptions<T>): FormHistoryApi {
  const { value, onRestore, max = 50, debounceMs = 600, isEqual = defaultIsEqual } = options;

  // Snapshots split into past (oldest first, newest at end), present, and
  // future (most-redoable first). Storing as refs avoids re-renders on
  // every push — only the canUndo/canRedo flags need to flip.
  const past = useRef<T[]>([]);
  const present = useRef<T>(value);
  const future = useRef<T[]>([]);
  const applyingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  // Capture changes (debounced).
  useEffect(() => {
    if (applyingRef.current) {
      // The value just changed because we called onRestore — sync the
      // present pointer but don't touch the stacks.
      applyingRef.current = false;
      present.current = value;
      return;
    }
    if (isEqual(present.current, value)) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Push the previous "present" onto past, advance present, drop
      // future (a new edit invalidates redo).
      past.current.push(present.current);
      if (past.current.length > max) past.current.shift();
      present.current = value;
      future.current = [];
      bump();
    }, debounceMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, isEqual, max, debounceMs, bump]);

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    const prev = past.current.pop()!;
    future.current.unshift(present.current);
    present.current = prev;
    applyingRef.current = true;
    onRestore(prev);
    bump();
  }, [onRestore, bump]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current.shift()!;
    past.current.push(present.current);
    present.current = next;
    applyingRef.current = true;
    onRestore(next);
    bump();
  }, [onRestore, bump]);

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    present.current = value;
    bump();
  }, [value, bump]);

  return {
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    undo,
    redo,
    reset,
    size: { past: past.current.length, future: future.current.length },
  };
}
