"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { WidgetZone } from "@/widgets";
import api from "@/lib/api";

export default function OfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
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
  }, [isAuthenticated, router, pathname]);

  if (!isAuthenticated || !setupChecked) return null;

  return (
    <div className="flex h-screen bg-background-dark overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden" role="main">
        <AppHeader />
        <main className="flex-1 overflow-y-auto" aria-label="Page content">{children}</main>
        <WidgetZone
          mountPoint="status-bar"
          workspaceId="default"
          className="h-8 shrink-0 px-4 border-t border-border-dark/30 bg-background-dark"
        />
      </div>
    </div>
  );
}
