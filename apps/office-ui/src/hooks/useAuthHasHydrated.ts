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
  const [hydrated, setHydrated] = useState(() =>
    useAuthStore.persist.hasHydrated(),
  );

  useEffect(() => {
    const unsubFinish = useAuthStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    // hasHydrated() may have flipped to true between initial state read and
    // the effect running — re-check synchronously to avoid sticking on false.
    setHydrated(useAuthStore.persist.hasHydrated());
    return () => {
      unsubFinish();
    };
  }, []);

  return hydrated;
}
