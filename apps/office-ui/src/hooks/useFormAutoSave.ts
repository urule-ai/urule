"use client";

import { useEffect, useRef, useState } from "react";

interface AutoSaveOptions<T> {
  /** Stable key under which the draft is persisted in localStorage. */
  storageKey: string;
  /**
   * Reactive form state to observe. For react-hook-form, pass `watch()`'s
   * return value (the full form object); for plain useState forms, the
   * state object directly.
   */
  value: T;
  /**
   * Restore handler — called once on mount with the persisted draft (if
   * any). Typically calls react-hook-form's `reset(draft)` or your
   * setter. If absent, the hook only persists; restoration is the
   * caller's job via `getDraft()`.
   */
  onRestore?: (draft: T) => void;
  /** Debounce window for writes. Default 800ms. */
  debounceMs?: number;
  /**
   * Skip persisting when the value is "empty" — defaults to a check that
   * the value is an object with no defined keys, OR an empty string. Pass
   * a custom predicate for fancier emptiness rules (e.g. all-fields-pristine).
   */
  isEmpty?: (value: T) => boolean;
}

interface AutoSaveApi {
  /** True when an unsaved-but-persisted-as-draft delta exists. */
  hasDraft: boolean;
  /** Discard the persisted draft (e.g. user clicked Submit or Cancel). */
  discardDraft: () => void;
  /** Read the current draft (no side effects). */
  getDraft: <U = unknown>() => U | null;
  /** Time of the last successful write, for "Saved 3s ago" UI bits. */
  lastSavedAt: number | null;
}

const STORAGE_PREFIX = 'urule-form-draft:';

function defaultIsEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every((x) => x === undefined || x === '' || x === null);
  }
  return false;
}

/**
 * Persist a form's value to localStorage on a debounce; restore it on
 * remount. Pairs with react-hook-form's `watch()` + `reset()` for the
 * common case, but works with any reactive value.
 *
 * Usage with react-hook-form:
 *   const { watch, reset, handleSubmit } = useForm(...);
 *   const value = watch();
 *   const draft = useFormAutoSave({
 *     storageKey: 'agent-create',
 *     value,
 *     onRestore: (d) => reset(d),
 *   });
 *   // …on submit success:
 *   draft.discardDraft();
 *
 * Drafts survive page reloads and tab restores. They reset across
 * different `storageKey`s so two forms on the same page don't collide.
 */
export function useFormAutoSave<T>(options: AutoSaveOptions<T>): AutoSaveApi {
  const { storageKey, value, onRestore, debounceMs = 800, isEmpty = defaultIsEmpty } = options;
  const fullKey = `${STORAGE_PREFIX}${storageKey}`;
  const [hasDraft, setHasDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const restoredRef = useRef(false);

  // Restore on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as { value: T; savedAt: number };
      if (parsed?.value !== undefined) {
        setHasDraft(true);
        setLastSavedAt(parsed.savedAt);
        onRestore?.(parsed.value);
      }
    } catch {
      // Corrupt entry — drop it silently.
      try { localStorage.removeItem(fullKey); } catch { /* nothing to clean */ }
    }
  }, [fullKey, onRestore]);

  // Persist on change, debounced.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isEmpty(value)) return;
    const t = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(fullKey, JSON.stringify({ value, savedAt }));
        setHasDraft(true);
        setLastSavedAt(savedAt);
      } catch {
        // Quota exceeded / storage disabled — silently skip.
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [fullKey, value, debounceMs, isEmpty]);

  return {
    hasDraft,
    lastSavedAt,
    discardDraft: () => {
      if (typeof window === 'undefined') return;
      try { localStorage.removeItem(fullKey); } catch { /* ignore */ }
      setHasDraft(false);
      setLastSavedAt(null);
    },
    getDraft: <U = unknown>() => {
      if (typeof window === 'undefined') return null;
      try {
        const raw = localStorage.getItem(fullKey);
        if (!raw) return null;
        return (JSON.parse(raw) as { value: U }).value;
      } catch {
        return null;
      }
    },
  };
}
