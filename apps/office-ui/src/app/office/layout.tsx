"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { NotificationCenter } from "@/components/layout/NotificationCenter";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { useNotificationSounds } from "@/hooks/useNotificationSounds";
import { useNotificationCapture } from "@/hooks/useNotificationCapture";
import { useApprovalEvents } from "@/hooks/useApprovalEvents";
import { useAuthHasHydrated } from "@/hooks/useAuthHasHydrated";
import { WidgetZone } from "@/widgets";
import api from "@/lib/api";

export default function OfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated } = useAuthStore();
  // Gate the auth-redirect effect on persist hydration. Otherwise the effect
  // fires once with the default `isAuthenticated: false` on first render,
  // pushes to /login, and races the rehydration that would have set it true.
  // Surfaces in CI tests that goto('/office') (#65) and as a redirect flicker
  // on slow devices in prod.
  const authHydrated = useAuthHasHydrated();
  const router = useRouter();
  const pathname = usePathname();
  const [setupChecked, setSetupChecked] = useState(false);
  // Subscribe to toasts and play a tone when one fires — gated by user prefs.
  useNotificationSounds();
  // Mirror every toast into the persisted notification center history.
  useNotificationCapture();
  // Real-time approval-event push (langgraph-adapter WS bridges NATS).
  // Workspace selector is "default" until multi-workspace UX lands.
  useApprovalEvents("default");

  useEffect(() => {
    if (!authHydrated) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Check setup completion only on the dashboard root
    if (pathname === "/office") {
      api
        .get("/workspaces/current/setup-status")
        .then((res) => {
          if (!res.data.is_setup_complete) {
            router.replace("/setup");
          } else {
            setSetupChecked(true);
          }
        })
        .catch(() => setSetupChecked(true));
    } else {
      setSetupChecked(true);
    }
  }, [authHydrated, isAuthenticated, router, pathname]);

  if (!authHydrated || !isAuthenticated || !setupChecked) return null;

  return (
    <div className="flex h-screen bg-background-dark overflow-hidden">
      <OfflineBanner />
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden" role="main">
        <AppHeader />
        <main
          className="flex-1 overflow-y-auto pb-16 lg:pb-0"
          aria-label="Page content"
        >
          {children}
        </main>
        <WidgetZone
          mountPoint="status-bar"
          workspaceId="default"
          className="h-8 shrink-0 px-4 border-t border-border-dark/30 bg-background-dark hidden lg:flex"
        />
      </div>
      <CommandPalette />
      <NotificationCenter />
      <MobileBottomNav />
    </div>
  );
}
