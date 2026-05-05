"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/*
 * Mobile bottom-nav: 5 most-used destinations as 44+px touch targets.
 *
 * The full sidebar (AppSidebar) has 11 items — too many for a phone bottom
 * bar. We pick 5 (Dashboard, Chat, Agents, Approvals, Settings) so each
 * label fits without truncation and so the row stays under the iOS thumb-
 * reachable zone. Hidden on `lg:` breakpoints — desktop keeps the sidebar.
 *
 * Items echo AppSidebar's `isActive` semantics so the highlighted tab
 * matches the highlighted sidebar entry on the same route.
 */
const items = [
  { icon: "dashboard", label: "Home", href: "/office" },
  { icon: "chat", label: "Chat", href: "/office/chat" },
  { icon: "smart_toy", label: "Agents", href: "/office/agents" },
  { icon: "verified_user", label: "Approve", href: "/office/approvals" },
  { icon: "settings", label: "More", href: "/office/settings" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/office") return pathname === "/office";
    return pathname.startsWith(href);
  }

  return (
    <nav
      className={cn(
        "lg:hidden fixed bottom-0 inset-x-0 z-30",
        "flex items-stretch justify-around",
        "bg-background-dark/95 backdrop-blur-md border-t border-border-dark/60",
        // Honour iOS safe-area inset so the bar sits above the home-indicator.
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Primary mobile navigation"
    >
      {items.map(({ icon, label, href }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px]",
              "text-[10px] font-medium uppercase tracking-wide transition-colors",
              active ? "text-primary" : "text-text-muted hover:text-primary",
            )}
          >
            <span className={cn("icon text-[22px]", active && "icon-filled")}>{icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
