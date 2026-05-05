"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { toast } from "@/store/useToastStore";
import {
  getPackage,
  getPackageVersions,
  formatPrice,
  type MarketplacePackage,
  type PackageVersion,
} from "@/lib/marketplace-api";

/*
 * Package detail page — calls into packagehub for metadata + version
 * history, and into the *packages* service for install. Free packages
 * get an inline Install CTA that POSTs to /api/v1/packages/install;
 * paid packages open the publisher's `paymentLink` in a new tab.
 *
 * Trust panel surfaces signing state (Ed25519 pubkey hash) and
 * verified status; hidden entirely for unsigned packages so the
 * default-anonymous flow stays clean.
 *
 * The "Purchase required" interstitial appears when the install path
 * returns 402 ENTITLEMENT_REQUIRED — packages service forwards
 * packagehub's paymentLink in the error body so we don't have to
 * fetch it twice.
 */

const TAB_VALUES = ["readme", "versions"] as const;
type TabValue = (typeof TAB_VALUES)[number];

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function TrustPanel({ pkg }: { pkg: MarketplacePackage }) {
  if (!pkg.publisherPubkey) return null;
  // Truncate the base64 pubkey for display: first 8 + last 8 chars.
  const truncated =
    pkg.publisherPubkey.length > 20
      ? `${pkg.publisherPubkey.slice(0, 10)}…${pkg.publisherPubkey.slice(-8)}`
      : pkg.publisherPubkey;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="icon text-emerald-400 text-[20px]">verified_user</span>
        <span className="text-sm font-bold text-emerald-400">Verified publisher</span>
      </div>
      <p className="text-xs text-text-muted">
        Every published version is cryptographically signed and verified at install
        time against the publisher's public key.
      </p>
      <div className="text-[11px] font-mono text-text-muted bg-background-dark/40 rounded px-2 py-1.5">
        {truncated} · {pkg.pubkeyKind}
      </div>
    </div>
  );
}

function PurchaseInterstitial({
  pkg,
  onClose,
}: {
  pkg: MarketplacePackage;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-xl p-6 max-w-md w-full space-y-4 neo-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="icon text-amber-400 text-2xl">payments</span>
          <h2 className="text-lg font-bold">Purchase required</h2>
        </div>
        <p className="text-sm text-text-muted">
          <span className="font-mono">{pkg.name}</span> is offered as a {" "}
          {pkg.licenseTier === "subscription" ? "subscription" : "paid package"} by {" "}
          {pkg.author}.
        </p>
        <div className="rounded-lg bg-surface-dark/60 border border-border-dark p-3">
          <div className="text-2xl font-black text-primary tabular-nums">
            {formatPrice(pkg.priceCents) || "Contact publisher"}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {pkg.licenseTier === "subscription" ? "per workspace, billed by publisher" : "one-time"}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-text-muted hover:text-primary transition-colors"
          >
            Close
          </button>
          {pkg.paymentLink && (
            <a
              href={pkg.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-bold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <span className="icon text-[16px]">open_in_new</span>
              Open checkout
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PackageDetailPage() {
  const params = useParams<{ name: string }>();
  const name = params?.name ? decodeURIComponent(params.name) : "";
  const [tab, setTab] = useState<TabValue>("readme");
  const [showPaywall, setShowPaywall] = useState(false);
  const [installing, setInstalling] = useState(false);

  const pkgQuery = useQuery<MarketplacePackage>({
    queryKey: ["package", name],
    queryFn: () => getPackage(name),
    enabled: !!name,
  });

  const versionsQuery = useQuery<PackageVersion[]>({
    queryKey: ["package", name, "versions"],
    queryFn: () => getPackageVersions(name),
    enabled: !!name && pkgQuery.isSuccess,
  });

  const pkg = pkgQuery.data;

  async function handleInstall() {
    if (!pkg) return;
    if (pkg.licenseTier !== "free") {
      setShowPaywall(true);
      return;
    }
    setInstalling(true);
    try {
      // workspaceId hardcoded "default" until multi-workspace UX lands —
      // matches the rest of the app today.
      await api.post("/packages/install", {
        workspaceId: "default",
        packageName: pkg.name,
      });
      toast.success("Package installed", `${pkg.name} is now available in your workspace.`);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { paymentLink?: string } } };
      if (e.response?.status === 402) {
        // packages service forwards packagehub's paymentLink in the body —
        // fall through to the paywall.
        setShowPaywall(true);
      } else {
        toast.error("Install failed", e.response?.data && JSON.stringify(e.response.data));
      }
    } finally {
      setInstalling(false);
    }
  }

  if (pkgQuery.isError) {
    return (
      <div className="p-8">
        <QueryError
          error={pkgQuery.error}
          onRetry={() => pkgQuery.refetch()}
          label={`Couldn't load "${name}"`}
        />
      </div>
    );
  }

  if (pkgQuery.isLoading || !pkg) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const ctaLabel =
    pkg.licenseTier === "free"
      ? "Install"
      : pkg.licenseTier === "subscription"
        ? "Subscribe"
        : `Purchase ${formatPrice(pkg.priceCents) || ""}`.trim();

  return (
    <div className="p-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-text-muted">
        <Link href="/office/marketplace" className="hover:text-primary" data-inline>
          Marketplace
        </Link>
        <span>›</span>
        <span className="text-foreground/80 font-mono truncate">{pkg.name}</span>
      </nav>

      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-black">{pkg.name}</h1>
          {pkg.verified && (
            <span
              className="icon text-primary text-2xl"
              title="Verified by Urule"
              aria-label="verified"
            >
              verified
            </span>
          )}
          {pkg.publisherPubkey && (
            <span
              className="icon text-emerald-400 text-xl"
              title="Cryptographically signed (Ed25519)"
              aria-label="signed"
            >
              key
            </span>
          )}
        </div>
        <p className="text-sm text-text-muted">
          <span className="font-mono">{pkg.type}</span> · by {pkg.author} · {pkg.downloads.toLocaleString()} installs
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          <p className="text-base text-foreground/90">{pkg.description || "No description provided."}</p>

          <div className="border-b border-border-dark/50 flex gap-2">
            {TAB_VALUES.map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn(
                  "px-3 py-2 text-sm font-bold capitalize transition-colors border-b-2",
                  tab === value
                    ? "border-primary text-primary"
                    : "border-transparent text-text-muted hover:text-primary",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          {tab === "readme" && (
            <article className="prose prose-invert max-w-none">
              {versionsQuery.data?.[0]?.readme ? (
                <pre className="text-xs whitespace-pre-wrap font-sans leading-6">
                  {versionsQuery.data[0].readme}
                </pre>
              ) : (
                <p className="text-sm text-text-muted">No README has been published for this package yet.</p>
              )}
            </article>
          )}

          {tab === "versions" && (
            <div className="rounded-lg border border-border-dark/60 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-dark/60">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Published</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {versionsQuery.isLoading && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  )}
                  {versionsQuery.data?.map((v) => (
                    <tr key={v.id} className="border-t border-border-dark/40">
                      <td className="px-3 py-2 font-mono">{v.version}</td>
                      <td className="px-3 py-2 text-text-muted">{timeAgo(v.publishedAt)}</td>
                      <td className="px-3 py-2 text-right">
                        {v.yanked ? (
                          <span className="text-[10px] font-bold text-amber-400">YANKED</span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-400">PUBLISHED</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {versionsQuery.data?.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-text-muted text-xs">
                        No versions published yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column — install panel + meta */}
        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="glass-panel rounded-xl p-4 space-y-3">
            <button
              onClick={handleInstall}
              disabled={installing}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 font-bold text-sm px-4 py-2.5 rounded-xl transition-colors",
                installing
                  ? "bg-primary/40 text-background-dark cursor-wait"
                  : "bg-primary hover:bg-primary/90 text-background-dark shadow-lg shadow-primary/20",
              )}
            >
              <span className="icon text-[18px]">
                {pkg.licenseTier === "free" ? "download" : "shopping_cart"}
              </span>
              {installing ? "Installing…" : ctaLabel}
            </button>

            <dl className="text-xs text-text-muted space-y-1.5 pt-2 border-t border-border-dark/40">
              {pkg.license && (
                <div className="flex items-center justify-between">
                  <dt>License</dt>
                  <dd className="font-mono text-foreground/80">{pkg.license}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt>License tier</dt>
                <dd className="font-bold">{pkg.licenseTier}</dd>
              </div>
              {pkg.repository && (
                <div className="flex items-center justify-between">
                  <dt>Repository</dt>
                  <dd>
                    <a
                      href={pkg.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      data-inline
                    >
                      View
                      <span className="icon text-[12px]">open_in_new</span>
                    </a>
                  </dd>
                </div>
              )}
              {pkg.homepage && (
                <div className="flex items-center justify-between">
                  <dt>Homepage</dt>
                  <dd>
                    <a
                      href={pkg.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      data-inline
                    >
                      Visit
                      <span className="icon text-[12px]">open_in_new</span>
                    </a>
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt>Last updated</dt>
                <dd>{timeAgo(pkg.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <TrustPanel pkg={pkg} />
        </aside>
      </div>

      {showPaywall && <PurchaseInterstitial pkg={pkg} onClose={() => setShowPaywall(false)} />}
    </div>
  );
}
