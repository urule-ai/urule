"use client";

import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";

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
  const { icon, title } = getPageMeta(pathname);

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 backdrop-blur-md border-b border-primary/10 z-10" role="banner">
      {/* Left: page title */}
      <div className="flex items-center gap-3">
        <span className="icon text-primary text-2xl">{icon}</span>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>

      {/* Right: search + notifications + avatar */}
      <div className="flex items-center gap-3">
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

        <button className="relative p-2 rounded-lg hover:bg-primary/10 transition-colors" aria-label="Notifications">
          <span className="icon text-text-muted text-[22px]">notifications</span>
        </button>

        {user && (
          <div className="size-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary cursor-pointer hover:border-primary/60 transition-colors" role="button" aria-label={`User profile: ${user.display_name}`} tabIndex={0}>
            {user.display_name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </header>
  );
}
