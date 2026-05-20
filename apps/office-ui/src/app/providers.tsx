"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { widgetRegistry, BUILTIN_MANIFESTS } from "@/widgets";
import { BUILTIN_COMPONENTS } from "@/widgets/builtin";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ToastContainer } from "@/components/ui/Toast";
import { useInstalledWidgetsStore } from "@/store/useInstalledWidgetsStore";

function useWidgetRegistryInit() {
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized) {
      // 1. Hardcoded builtins — ship with the bundle, always available.
      for (const manifest of BUILTIN_MANIFESTS) {
        widgetRegistry.registerManifest(manifest);
      }
      for (const [path, component] of Object.entries(BUILTIN_COMPONENTS)) {
        widgetRegistry.registerComponent(path, component);
      }
      // 2. Marketplace-installed widgets — pulled from the persisted
      // `useInstalledWidgetsStore` (localStorage today, server-side
      // follow-up). Iterate every workspace's manifests and register
      // them; the registry is a Map keyed by id so duplicates from
      // multi-workspace installs collapse cleanly. WidgetZone filters
      // by mountPoint at render time — workspace scoping happens via
      // the per-workspace install record, not here.
      const installed = useInstalledWidgetsStore.getState().byWorkspace;
      for (const manifests of Object.values(installed)) {
        for (const manifest of manifests) {
          widgetRegistry.registerManifest(manifest);
        }
      }
      setInitialized(true);
    }
  }, [initialized]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
          },
        },
      })
  );

  useWidgetRegistryInit();

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{children}</ErrorBoundary>
      <ToastContainer />
    </QueryClientProvider>
  );
}
