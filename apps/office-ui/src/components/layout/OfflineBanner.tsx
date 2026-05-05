"use client";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Sticky banner that surfaces when the browser reports `navigator.onLine
 * === false`. Mount once in the office layout — the `useOnlineStatus`
 * hook handles event subscription + polling fallback.
 *
 * Uses `role="status"` + `aria-live="polite"` so screen readers announce
 * the change without being intrusive.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      data-online={online ? 'true' : 'false'}
      className={`fixed top-0 left-0 right-0 z-50 transition-transform ${online ? '-translate-y-full' : 'translate-y-0'}`}
      aria-hidden={online}
    >
      <div className="bg-amber-500 text-black text-sm px-4 py-2 text-center font-medium">
        You're offline. Some features may not work until your connection is restored.
      </div>
    </div>
  );
}
