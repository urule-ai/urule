"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/*
 * Shared layout for the marketplace surfaces. The browse list lives at
 * `/office/marketplace`; installed packages at `/office/marketplace/installed`.
 * Both share the same hero + tab strip so the user sees a single
 * "Marketplace" entry in the sidebar but can flip between discovery
 * and management without bouncing back to the list.
 *
 * Detail pages (`/office/marketplace/[name]`) deliberately render WITHOUT
 * the tab strip — they're a focused destination, not a sibling of
 * browse/installed. We detect that by the path having a 4th segment.
 */

const TABS: Array<{ href: string; label: string }> = [
  { href: "/office/marketplace", label: "Browse" },
  { href: "/office/marketplace/installed", label: "Installed" },
];

function isDetailPath(path: string): boolean {
  // /office/marketplace, /office/marketplace/installed → tab surface
  // /office/marketplace/anything-else → detail page
  if (path === "/office/marketplace") return false;
  if (path === "/office/marketplace/installed") return false;
  return path.startsWith("/office/marketplace/");
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (isDetailPath(pathname)) return <>{children}</>;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-black">Marketplace</h1>
        <p className="text-sm text-text-muted mt-1">
          Discover and manage packages — personalities, skills, and connectors for your agents.
        </p>
      </header>

      <nav
        className="flex gap-1 border-b border-border-dark/50"
        aria-label="Marketplace sections"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-4 py-2 text-sm font-bold transition-colors border-b-2 -mb-px",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-primary",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
