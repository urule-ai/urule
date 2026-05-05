"use client";

import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useSidebarStore } from "@/store/useSidebarStore";
import { useDashboardLayoutStore } from "@/store/useDashboardLayoutStore";
import { NotificationBell } from "@/components/layout/NotificationCenter";
import { cn } from "@/lib/utils";

const PAGE_META: Record<string, { icon: string; title: string }> = {
  "/office": { icon: "dashboard", title: "Dashboard" },
  "/office/workspaces": { icon: "account_tree", title: "Workspaces" },
  "/office/agents": { icon: "person_search", title: "Agent Directory" },
  "/office/agents/new": { icon: "add_circle", title: "Create Agent" },
  "/office/projects": { icon: "work", title: "Projects" },
  "/office/integrations": { icon: "extension", title: "Integrations" },
  "/office/security": { icon: "security", title: "Security" },
  "/office/logs": { icon: "data_exploration", title: "Activity & Logs" },
  "/office/settings": { icon: "settings", title: "Settings" },
};

function getPageMeta(pathname: string) {
  // Exact match first
  if (PAGE_META[pathname]) return PAGE_META[pathname];
  // Prefix match (for dynamic routes)
  for (const [key, meta] of Object.entries(PAGE_META)) {
    if (pathname.startsWith(key + "/")) return meta;
  }
  return { icon: "dashboard", title: "Office" };
}

export function AppHeader() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const { toggle } = useSidebarStore();
  const editing = useDashboardLayoutStore((s) => s.editing);
  const toggleEditing = useDashboardLayoutStore((s) => s.toggleEditing);
  const { icon, title } = getPageMeta(pathname);

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 backdrop-blur-md border-b border-primary/10 z-10" role="banner">
      {/* Left: hamburger (mobile) + page title */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Hamburger menu button — visible only on mobile */}
        <button
          onClick={toggle}
          className="lg:hidden size-10 rounded-lg hover:bg-primary/10 flex items-center justify-center transition-colors"
          aria-label="Toggle sidebar menu"
        >
          <span className="icon text-text-muted text-2xl">menu</span>
        </button>
        <span className="icon text-primary text-2xl">{icon}</span>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>

      {/* Right: search + notifications + avatar */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative hidden md:block">
          <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            aria-label="Search"
            className="w-64 pl-10 pr-4 py-2 bg-primary/5 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/30 transition-all"
          />
        </div>

        <button
          onClick={toggleEditing}
          aria-pressed={editing}
          aria-label={editing ? "Done customizing layout" : "Customize layout"}
          title={editing ? "Done customizing" : "Customize layout"}
          className={cn(
            "h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold border transition-colors",
            editing
              ? "bg-primary text-background-dark border-primary shadow-lg shadow-primary/20"
              : "border-border-dark text-text-muted hover:text-primary hover:border-primary/40",
          )}
        >
          <span className="icon text-[16px]">{editing ? "check" : "tune"}</span>
          <span className="hidden sm:inline">{editing ? "Done" : "Customize"}</span>
        </button>

        <NotificationBell />

        {user && (
          <div className="size-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary cursor-pointer hover:border-primary/60 transition-colors" role="button" aria-label={`User profile: ${user.display_name}`} tabIndex={0}>
            {user.display_name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </header>
  );
}
