"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { toast } from "@/store/useToastStore";
import {
  getPackage,
  getPackageVersions,
  listInstalled,
  formatPrice,
  installWidgetFromPackage,
  verifyWidgetVersion,
  type MarketplacePackage,
  type PackageVersion,
  type InstalledPackage,
} from "@/lib/marketplace-api";
import { useInstalledWidgetsStore } from "@/store/useInstalledWidgetsStore";
import { widgetRegistry } from "@/widgets";

/*
 * Package detail page — discovery + install + purchase + manage in one
 * surface. Calls into packagehub for metadata, packages service for
 * install/upgrade and to read the installed-status of this package in
 * the current workspace.
 *
 * CTA is state-aware:
 *   not installed + free        → INSTALL FOR FREE
 *   not installed + paid        → PURCHASE $9.99 (opens interstitial)
 *   not installed + subscription → SUBSCRIBE (opens interstitial)
 *   installed (newer published)  → UPDATE TO vX.Y.Z
 *   installed (current)          → MANAGE (links to installed list)
 *   in-flight                    → spinner + Installing…/Updating…
 *
 * The interstitial copy is tier-driven so adding a new pricing model
 * is a values change in TIER_COPY rather than a new modal component.
 */

const TAB_VALUES = ["readme", "versions", "dependencies"] as const;
type TabValue = (typeof TAB_VALUES)[number];

const WORKSPACE_ID = "default"; // shared with the rest of the app today

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

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(/[.\-+]/).map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function TrustPanel({ pkg }: { pkg: MarketplacePackage }) {
  if (!pkg.publisherPubkey) return null;
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
        Every published version is cryptographically signed and verified at install time
        against the publisher's public key.
      </p>
      <div className="text-[11px] font-mono text-text-muted bg-background-dark/40 rounded px-2 py-1.5">
        {truncated} · {pkg.pubkeyKind}
      </div>
    </div>
  );
}

/* ---------- Tier-aware purchase interstitial ---------- */

interface TierCopy {
  feeLabel: string;
  bullets: string[];
  ctaLabel: string;
}

const TIER_COPY: Record<"paid" | "subscription", TierCopy> = {
  paid: {
    feeLabel: "ONE-TIME FEE",
    bullets: ["Lifetime access to current major version", "Direct support from publisher"],
    ctaLabel: "Open checkout",
  },
  subscription: {
    feeLabel: "SUBSCRIPTION",
    bullets: ["Always on the latest version", "Cancel anytime", "Direct support from publisher"],
    ctaLabel: "Open checkout",
  },
};

function PurchaseInterstitial({
  pkg,
  onClose,
}: {
  pkg: MarketplacePackage;
  onClose: () => void;
}) {
  const tier = pkg.licenseTier === "subscription" ? "subscription" : "paid";
  const copy = TIER_COPY[tier];
  const priceLine =
    tier === "subscription"
      ? `${formatPrice(pkg.priceCents) || "Contact publisher"} / mo`
      : formatPrice(pkg.priceCents) || "Contact publisher";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-xl max-w-md w-full neo-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 p-5 border-b border-border-dark/40">
          <div className="flex items-center gap-2">
            <span className="icon text-primary text-[22px]">lock</span>
            <h2 id="purchase-title" className="text-base font-bold">
              Purchase required to install
            </h2>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
            aria-label="Close"
          >
            <span className="icon text-[18px]">close</span>
          </button>
        </header>

        <div className="p-6 space-y-5">
          <div className="flex flex-col items-center gap-3">
            <div className="size-16 rounded-lg border border-border-dark/60 bg-background-dark/40 flex items-center justify-center">
              <span className="icon text-primary text-3xl">deployed_code</span>
            </div>
            <div className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
              {copy.feeLabel}
            </div>
            <div className="text-4xl font-black text-primary tabular-nums">{priceLine}</div>
          </div>

          <p className="text-xs text-text-muted text-center">
            <span className="font-mono">{pkg.name}</span> is offered by{" "}
            <span className="font-mono px-1.5 py-0.5 rounded bg-surface-dark border border-border-dark">
              {pkg.author}
            </span>
            .
          </p>

          <ul className="space-y-2 border-t border-border-dark/40 pt-4">
            {copy.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-xs">
                <span className="icon text-primary text-[16px] shrink-0 mt-0.5">check</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="border-t border-border-dark/40 p-4 space-y-2">
          {pkg.paymentLink ? (
            <a
              href={pkg.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-background-dark font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
            >
              <span className="icon text-[18px]">shopping_cart</span>
              {copy.ctaLabel}
            </a>
          ) : (
            <button
              disabled
              className="w-full px-4 py-2.5 rounded-lg bg-surface-dark/60 text-text-muted text-sm font-bold cursor-not-allowed"
            >
              No checkout link configured
            </button>
          )}
          {pkg.paymentProvider && (
            <p className="text-[10px] font-mono text-text-muted text-center uppercase tracking-wider">
              Transaction secured via {pkg.paymentProvider}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

export default function PackageDetailPage() {
  const params = useParams<{ name: string }>();
  const name = params?.name ? decodeURIComponent(params.name) : "";
  const queryClient = useQueryClient();
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

  const installedQuery = useQuery<InstalledPackage[]>({
    queryKey: ["installed", WORKSPACE_ID],
    queryFn: () => listInstalled(WORKSPACE_ID),
    // Only need this when we have a package to compare against.
    enabled: pkgQuery.isSuccess,
  });

  const pkg = pkgQuery.data;
  const installedRow = installedQuery.data?.find((p) => p.packageName === pkg?.name);
  const latestVersion =
    versionsQuery.data?.find((v) => !v.yanked)?.version ??
    pkg?.latestVersion?.version;
  const updateAvailable =
    !!installedRow &&
    !!latestVersion &&
    compareVersions(latestVersion, installedRow.version) > 0;

  const manifestDeps = (pkg?.latestVersion?.manifest?.["dependencies"] ?? {}) as Record<string, string>;
  const dependencies = Object.entries(manifestDeps);

  async function handleInstall() {
    if (!pkg) return;
    if (!installedRow && pkg.licenseTier !== "free") {
      setShowPaywall(true);
      return;
    }
    setInstalling(true);
    try {
      // Widget packages take a different install path: there's no
      // server-side install lifecycle (the widget runs entirely in the
      // browser, either as a registered native React component or as
      // an iframe-loaded external resource). Instead, we register the
      // embedded WidgetManifest into the persisted `useInstalledWidgetsStore`
      // and the in-memory widgetRegistry; the dashboard sees it on the
      // next render.
      if (pkg.type === "widget") {
        // #39 — verify/install binding + fail-closed gate live in
        // installWidgetFromPackage (unit-tested). The version verified is the
        // manifest's own source version (`pkg.latestVersion`), never the page's
        // `latestVersion` (newest non-yanked), so a yanked-latest can't verify
        // one version while we register another's entryUrl.
        await installWidgetFromPackage(pkg, WORKSPACE_ID, {
          verify: verifyWidgetVersion,
          install: (workspaceId, manifest, verification) =>
            useInstalledWidgetsStore.getState().install(workspaceId, manifest, verification),
          register: (manifest) => widgetRegistry.registerManifest(manifest),
          onSuccess: (manifest) =>
            toast.success("Widget installed", `${manifest.name} is now available on your dashboard.`),
          onError: (title, message) => toast.error(title, message),
        });
        return;
      }
      if (installedRow && updateAvailable) {
        await api.post(`/packages/${installedRow.id}/upgrade`, {
          version: latestVersion,
        });
        toast.success("Package updated", `${pkg.name} is now at ${latestVersion}.`);
      } else if (!installedRow) {
        await api.post("/packages/install", {
          workspaceId: WORKSPACE_ID,
          packageName: pkg.name,
        });
        toast.success("Package installed", `${pkg.name} is now available in your workspace.`);
      }
      queryClient.invalidateQueries({ queryKey: ["installed", WORKSPACE_ID] });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown } };
      if (e.response?.status === 402) {
        setShowPaywall(true);
      } else {
        const data = e.response?.data;
        toast.error(
          "Install failed",
          typeof data === "object" ? JSON.stringify(data) : String(data ?? "unknown error"),
        );
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

  /* ---------- CTA state machine ---------- */
  type CtaState =
    | { kind: "install-free" }
    | { kind: "purchase" }
    | { kind: "subscribe" }
    | { kind: "update"; version: string }
    | { kind: "manage" };

  function ctaState(): CtaState {
    if (!installedRow) {
      if (pkg!.licenseTier === "subscription") return { kind: "subscribe" };
      if (pkg!.licenseTier === "paid") return { kind: "purchase" };
      return { kind: "install-free" };
    }
    if (updateAvailable && latestVersion) return { kind: "update", version: latestVersion };
    return { kind: "manage" };
  }

  const cta = ctaState();
  const ctaLabel: string = (() => {
    if (installing) return cta.kind === "update" ? "Updating…" : "Installing…";
    switch (cta.kind) {
      case "install-free":
        return "Install for free";
      case "purchase":
        return `Purchase ${formatPrice(pkg.priceCents) || ""}`.trim();
      case "subscribe":
        return "Subscribe";
      case "update":
        return `Update to v${cta.version}`;
      case "manage":
        return "Manage";
    }
  })();
  const ctaIcon: string = (() => {
    switch (cta.kind) {
      case "install-free":
        return "download";
      case "purchase":
      case "subscribe":
        return "shopping_cart";
      case "update":
        return "system_update";
      case "manage":
        return "settings";
    }
  })();

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
          {installedRow && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              INSTALLED · v{installedRow.version}
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
          <p className="text-base text-foreground/90">
            {pkg.description || "No description provided."}
          </p>

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
                <p className="text-sm text-text-muted">
                  No README has been published for this package yet.
                </p>
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
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-text-muted text-xs"
                      >
                        No versions published yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "dependencies" && (
            <div className="rounded-lg border border-border-dark/60 overflow-hidden">
              {dependencies.length === 0 ? (
                <p className="px-3 py-6 text-center text-text-muted text-xs">
                  No dependencies declared.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-dark/60">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="px-3 py-2">Package</th>
                      <th className="px-3 py-2 text-right">Required range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dependencies.map(([dep, range]) => (
                      <tr key={dep} className="border-t border-border-dark/40">
                        <td className="px-3 py-2">
                          <Link
                            href={`/office/marketplace/${encodeURIComponent(dep)}`}
                            className="font-mono text-primary hover:underline"
                            data-inline
                          >
                            {dep}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-text-muted">{range}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="glass-panel rounded-xl p-4 space-y-3">
            {cta.kind === "manage" ? (
              <Link
                href="/office/marketplace/installed"
                className="w-full inline-flex items-center justify-center gap-2 bg-surface-dark hover:bg-primary/10 hover:text-primary text-foreground font-bold text-sm px-4 py-2.5 rounded-xl border border-border-dark transition-colors"
              >
                <span className="icon text-[18px]">{ctaIcon}</span>
                {ctaLabel}
              </Link>
            ) : (
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
                <span className="icon text-[18px]">{ctaIcon}</span>
                {ctaLabel}
              </button>
            )}

            {/* Hint line under the CTA */}
            {cta.kind === "manage" && (
              <p className="text-[11px] text-text-muted text-center">
                Already installed at v{installedRow!.version}.
              </p>
            )}
            {cta.kind === "update" && installedRow && (
              <p className="text-[11px] text-text-muted text-center">
                Currently at v{installedRow.version}.
              </p>
            )}

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
