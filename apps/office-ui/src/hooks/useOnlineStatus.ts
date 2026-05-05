"use client";

import { useEffect, useState } from "react";

/**
 * Tracks browser online/offline status. SSR-safe — assumes online during
 * server render so the offline banner doesn't flash on hydration.
 *
 * Uses both the `online`/`offline` window events AND a periodic re-check
 * via `navigator.onLine` because some browsers don't fire the events
 * reliably (notably Safari when toggling Wi-Fi). The poll is cheap (read
 * a boolean) and only runs while the page is visible.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Polling fallback for browsers that miss events. 5s cadence is a
    // compromise: fast enough that users notice within a network hiccup,
    // slow enough not to be a CPU/battery concern.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (interval) return;
      interval = setInterval(() => setOnline(navigator.onLine), 5000);
    };
    const stopPoll = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const handleVisibility = () => {
      if (document.hidden) stopPoll();
      else startPoll();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (!document.hidden) startPoll();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopPoll();
    };
  }, []);

  return online;
}
