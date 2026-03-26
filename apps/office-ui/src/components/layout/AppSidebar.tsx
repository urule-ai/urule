"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { cn } from "@/lib/utils";
import { WidgetZone } from "@/widgets";

const navItems = [
  { icon: "dashboard", label: "Dashboard", href: "/office" },
  { icon: "groups", label: "Workspaces", href: "/office/workspaces" },
  { icon: "smart_toy", label: "Agents", href: "/office/agents" },
  { icon: "chat", label: "Chat", href: "/office/chat" },
  { icon: "video_call", label: "Meetings", href: "/office/meetings" },
  { icon: "work", label: "Projects", href: "/office/projects" },
  { icon: "verified_user", label: "Approvals", href: "/office/approvals" },
  { icon: "extension", label: "Integrations", href: "/office/integrations" },
  { icon: "security", label: "Security", href: "/office/security" },
  { icon: "data_exploration", label: "Logs", href: "/office/logs" },
  { icon: "settings", label: "Settings", href: "/office/settings" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  function isActive(href: string) {
    if (href === "/office") return pathname === "/office";
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-64 h-full flex flex-col border-r border-border-dark/50 bg-background-dark shrink-0" role="complementary" aria-label="Sidebar">
      {/* Logo */}
      <div className="p-5 border-b border-border-dark/50">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center glow-primary">
            <span className="icon text-primary text-xl">rocket_launch</span>
          </div>
          <div>
            <div className="font-black text-lg leading-none">Urule</div>
            <div className="font-mono text-[10px] text-primary uppercase tracking-widest leading-none mt-0.5">
              AI Management
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {navItems.map(({ icon, label, href }) => (
          <Link
            key={label}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isActive(href)
                ? "sidebar-active"
                : "text-text-muted hover:bg-primary/10 hover:text-primary"
            )}
          >
            <span className="icon text-[20px]">{icon}</span>
            {label}
          </Link>
        ))}

        {/* Sidebar widgets */}
        <div className="mt-4 pt-4 border-t border-border-dark/30">
          <WidgetZone mountPoint="sidebar" workspaceId="default" className="px-1" />
        </div>
      </nav>

      {/* New Agent CTA */}
      <div className="p-4 border-t border-border-dark/50">
        <Link
          href="/office/agents/new"
          className="flex items-center justify-center gap-2 w-full bg-primary text-background-dark font-bold text-sm py-2.5 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
        >
          <span className="icon text-[18px]">add</span>
          New Agent
        </Link>

        {/* User info */}
        {user && (
          <div className="mt-3 flex items-center gap-3 px-2">
            <div className="size-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {user.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{user.display_name}</div>
              <div className="text-[10px] text-text-muted truncate">{user.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-text-muted hover:text-primary transition-colors"
              title="Log out"
              aria-label="Log out"
            >
              <span className="icon text-[18px]">logout</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
