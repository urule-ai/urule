"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import {
  searchPackages,
  formatPrice,
  type MarketplacePackage,
  type SortOption,
} from "@/lib/marketplace-api";

/*
 * Marketplace browse — public-by-default package list backed by the
 * packagehub /api/v1/packages search endpoint. Filters mirror what the
 * backend supports today (text query, type, verified-only, sort), with
 * a license-tier filter handled client-side since the endpoint doesn't
 * yet return tier-filtered queries (the column exists on packages but
 * search.ts hasn't been extended).
 *
 * Each row deep-links to /office/marketplace/[name] for full detail +
 * install / purchase CTA.
 */

const PACKAGE_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "All types" },
  { value: "personality", label: "Personality" },
  { value: "skill", label: "Skill" },
  { value: "mcp_connector", label: "MCP Connector" },
  { value: "design", label: "Design" },
  { value: "widget", label: "Widget" },
];

const SORT_OPTIONS: Array<{ value: SortOption | "relevance"; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "popular", label: "Most popular" },
  { value: "recent", label: "Recently published" },
];

type LicenseFilter = "all" | "free" | "paid";

const LICENSE_FILTERS: Array<{ value: LicenseFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
];

function LicenseTierBadge({ pkg }: { pkg: MarketplacePackage }) {
  const tier = pkg.licenseTier;
  if (tier === "free") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        Free
      </span>
    );
  }
  if (tier === "subscription") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-400 border border-violet-500/30">
        Subscription
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
      {formatPrice(pkg.priceCents) || "Paid"}
    </span>
  );
}

function PackageCard({ pkg }: { pkg: MarketplacePackage }) {
  return (
    <Link
      href={`/office/marketplace/${encodeURIComponent(pkg.name)}`}
      className="glass-panel rounded-xl p-5 flex flex-col gap-3 hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold truncate">{pkg.name}</h3>
            {pkg.verified && (
              <span
                className="icon text-primary text-[16px]"
                title="Signed by verified publisher"
                aria-label="verified"
              >
                verified
              </span>
            )}
            {pkg.publisherPubkey && (
              <span
                className="icon text-emerald-400 text-[14px]"
                title="Cryptographically signed (Ed25519)"
                aria-label="signed"
              >
                key
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5 truncate">
            <span className="font-mono">{pkg.type}</span> · by {pkg.author}
          </p>
        </div>
        <LicenseTierBadge pkg={pkg} />
      </div>

      <p className="text-xs text-text-muted line-clamp-2 min-h-[2.4em]">
        {pkg.description || "No description"}
      </p>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="flex flex-wrap gap-1">
          {pkg.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded bg-surface-dark border border-border-dark text-[10px] text-text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-text-muted tabular-nums shrink-0">
          {pkg.downloads.toLocaleString()} installs
        </span>
      </div>
    </Link>
  );
}

export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [sort, setSort] = useState<SortOption | "relevance">("relevance");

  const { data: packages = [], isLoading, isError, error, refetch } = useQuery<MarketplacePackage[]>({
    queryKey: ["marketplace", { search, type, verifiedOnly, sort }],
    queryFn: () =>
      searchPackages({
        q: search || undefined,
        type: type || undefined,
        verified: verifiedOnly ? true : undefined,
        sort: sort === "relevance" ? undefined : sort,
        limit: 50,
      }),
  });

  // Server returns whatever search rules match; we apply the license
  // filter client-side. When packagehub's search.ts grows a tier filter
  // this can move server-side.
  const filtered = packages.filter((p) => {
    if (licenseFilter === "all") return true;
    if (licenseFilter === "free") return p.licenseTier === "free";
    return p.licenseTier !== "free";
  });

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="glass-panel rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packages…"
            className="w-full bg-surface-dark border border-border-dark rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary/40"
          />
        </div>

        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-surface-dark border border-border-dark rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
          aria-label="Package type"
        >
          {PACKAGE_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1 rounded-lg border border-border-dark p-0.5 bg-surface-dark">
          {LICENSE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setLicenseFilter(f.value)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-bold transition-colors",
                licenseFilter === f.value
                  ? "bg-primary/20 text-primary"
                  : "text-text-muted hover:text-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="size-4 accent-primary"
          />
          Verified only
        </label>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption | "relevance")}
          className="bg-surface-dark border border-border-dark rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
          aria-label="Sort by"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {isError ? (
        <QueryError error={error} onRetry={() => refetch()} label="Couldn't load marketplace" />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-16 text-center space-y-3">
          <span className="icon text-5xl text-text-muted">storefront</span>
          <p className="font-bold text-lg">No packages found</p>
          <p className="font-mono text-[11px] text-text-muted/80 max-w-md mx-auto leading-relaxed">
            SYS_QUERY_RETURN: NULL. No marketplace entities match the current active filter
            criteria.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setType("");
              setVerifiedOnly(false);
              setLicenseFilter("all");
              setSort("relevance");
            }}
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg border border-border-dark text-xs font-bold text-primary hover:bg-primary/10 transition-colors"
          >
            <span className="icon text-[16px]">filter_alt_off</span>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      )}
    </div>
  );
}
