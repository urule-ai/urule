import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Returns true once zustand-persist has finished rehydrating `useAuthStore`
 * from localStorage. Consumers should gate any auth-dependent redirect on
 * this — otherwise the layout effect fires once with the default
 * (`isAuthenticated: false`) state on first render, hits `router.replace
 * ('/login')`, and races the hydration update that would have prevented
 * the redirect.
 *
 * Tracked under #65 — the bug surfaces in CI as a navigation flake (tests
 * that `page.goto('/office')` then immediately assert URL contains
 * `/office`) but exists in production too as a redirect flicker on slow
 * devices.
 */
export function useAuthHasHydrated(): boolean {
  // On the server, the persist API isn't fully wired and there's no
  // localStorage to rehydrate from anyway — return false so consumers
  // render their "not yet hydrated" branch (typically `return null`).
  // The client takes over after hydration and the effect below flips
  // this to true once persist signals completion.
  const [hydrated, setHydrated] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return useAuthStore.persist?.hasHydrated?.() ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persist = useAuthStore.persist;
    if (!persist) return;
    const unsubFinish = persist.onFinishHydration(() => setHydrated(true));
    // hasHydrated() may have flipped to true between initial state read and
    // the effect running — re-check synchronously to avoid sticking on false.
    setHydrated(persist.hasHydrated());
    return () => {
      unsubFinish();
    };
  }, []);

  return hydrated;
}
