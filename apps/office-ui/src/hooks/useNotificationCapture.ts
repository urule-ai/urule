"use client";

import { useEffect, useRef } from "react";
import { useToastStore } from "@/store/useToastStore";
import { useNotificationCenterStore } from "@/store/useNotificationCenterStore";

/**
 * Mirror every new toast into the notification-center store. Hooks into
 * the same toast-additions subscription pattern as `useNotificationSounds`.
 *
 * Toasts are ephemeral (auto-dismiss after a few seconds); the
 * notification center keeps the history. A user who missed a toast can
 * click the bell to read it later.
 */
export function useNotificationCapture(): void {
  const lastSeenIdRef = useRef<string | null>(null);
  const add = useNotificationCenterStore((s) => s.add);

  useEffect(() => {
    const unsub = useToastStore.subscribe((state, prev) => {
      if (state.toasts.length <= prev.toasts.length) return;
      const newest = state.toasts[state.toasts.length - 1];
      if (!newest || newest.id === lastSeenIdRef.current) return;
      lastSeenIdRef.current = newest.id;
      add({
        kind: newest.type,
        title: newest.title,
        body: newest.message,
        source: 'toast',
      });
    });
    return unsub;
  }, [add]);
}
