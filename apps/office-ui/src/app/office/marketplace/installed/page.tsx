"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/store/useToastStore";
import {
  listInstalled,
  listAvailableUpdates,
  uninstallPackage,
  upgradePackage,
  type InstalledPackage,
  type UpdateAvailable,
} from "@/lib/marketplace-api";

/*
 * Installed-packages management view.
 *
 * Lists every installation in the current workspace and surfaces:
 *   - status pill (active / disabled / failed)
 *   - installed version (mono)
 *   - "vX.Y.Z available" amber affordance when packagehub has a newer
 *     non-yanked version (cross-checked via /workspaces/:wsId/updates)
 *   - per-row actions: Configure (link to detail), Update, Uninstall
 *
 * Workspace selector is hardcoded "default" until multi-workspace UX
 * lands — same convention as useApprovalEvents and the existing widgets.
 */

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "personality", label: "Personalities" },
  { value: "skill", label: "Skills" },
  { value: "mcp_connector", label: "Connectors" },
];

function StatusPill({ status }: { status: InstalledPackage["status"] }) {
  const map = {
    installed: { label: "Active", dot: "bg-emerald-400", text: "text-emerald-400" },
    installing: { label: "Installing", dot: "bg-sky-400", text: "text-sky-400" },
    pending: { label: "Pending", dot: "bg-text-muted", text: "text-text-muted" },
    removing: { label: "Removing", dot: "bg-orange-400", text: "text-orange-400" },
    failed: { label: "Failed", dot: "bg-red-400", text: "text-red-400" },
  } as const;
  const { label, dot, text } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase ${text}`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export default function InstalledPackagesPage() {
  const workspaceId = "default";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [confirmRemove, setConfirmRemove] = useState<InstalledPackage | null>(null);

  const installed = useQuery<InstalledPackage[]>({
    queryKey: ["installed", workspaceId],
    queryFn: () => listInstalled(workspaceId),
    refetchInterval: 30_000,
  });

  const updates = useQuery<UpdateAvailable[]>({
    queryKey: ["installed-updates", workspaceId],
    queryFn: () => listAvailableUpdates(workspaceId),
    enabled: installed.isSuccess,
    refetchInterval: 60_000,
  });

  const updateMap = useMemo(() => {
    const m = new Map<string, UpdateAvailable>();
    for (const u of updates.data ?? []) m.set(u.installationId, u);
    return m;
  }, [updates.data]);

  const upgradeMutation = useMutation({
    mutationFn: ({ id, version }: { id: string; version?: string }) => upgradePackage(id, version),
    onSuccess: (row) => {
      toast.success("Package updated", `${row.packageName} is now at ${row.version}.`);
      queryClient.invalidateQueries({ queryKey: ["installed", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["installed-updates", workspaceId] });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Update failed";
      toast.error("Update failed", message);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (id: string) => uninstallPackage(id),
    onSuccess: () => {
      toast.success("Package uninstalled");
      queryClient.invalidateQueries({ queryKey: ["installed", workspaceId] });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Uninstall failed";
      toast.error("Uninstall failed", message);
    },
  });

  const filtered = (installed.data ?? []).filter((p) => {
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    if (search && !p.packageName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (installed.isError) {
    return (
      <QueryError
        error={installed.error}
        onRetry={() => installed.refetch()}
        label="Couldn't load installed packages"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="glass-panel rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter packages…"
            className="w-full bg-surface-dark border border-border-dark rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border-dark p-0.5 bg-surface-dark">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-bold transition-colors",
                typeFilter === f.value
                  ? "bg-primary/20 text-primary"
                  : "text-text-muted hover:text-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {installed.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-16 text-center space-y-3">
          <span className="icon text-5xl text-text-muted">deployed_code</span>
          <p className="font-bold text-lg">
            {installed.data?.length === 0 ? "No packages installed yet" : "No packages match your filter"}
          </p>
          {installed.data?.length === 0 ? (
            <p className="text-text-muted text-sm">
              Browse the{" "}
              <Link href="/office/marketplace" className="text-primary hover:underline" data-inline>
                marketplace
              </Link>{" "}
              to install your first package.
            </p>
          ) : (
            <button
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
              }}
              className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg border border-border-dark text-xs font-bold text-primary hover:bg-primary/10"
            >
              <span className="icon text-[16px]">filter_alt_off</span>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((pkg) => {
            const updateInfo = updateMap.get(pkg.id);
            const isUpgrading = upgradeMutation.isPending && upgradeMutation.variables?.id === pkg.id;
            const isUninstalling = uninstallMutation.isPending && uninstallMutation.variables === pkg.id;
            return (
              <li
                key={pkg.id}
                className="glass-panel rounded-xl p-4 flex items-start gap-4"
              >
                <span className="icon text-primary text-2xl shrink-0 mt-0.5">deployed_code</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <Link
                      href={`/office/marketplace/${encodeURIComponent(pkg.packageName)}`}
                      className="font-mono font-bold truncate hover:text-primary"
                      data-inline
                    >
                      {pkg.packageName}
                    </Link>
                    <StatusPill status={pkg.status} />
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5 font-mono">
                    {pkg.type} · installed {new Date(pkg.installedAt).toLocaleDateString()}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-surface-dark border border-border-dark text-[11px] font-mono text-foreground/80">
                      v{pkg.version || "—"}
                    </span>
                    {updateInfo && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400">
                        <span className="size-1.5 rounded-full bg-amber-400" />
                        v{updateInfo.latestVersion} available
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Link
                      href={`/office/marketplace/${encodeURIComponent(pkg.packageName)}`}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg border border-border-dark hover:bg-primary/10 hover:text-primary transition-colors"
                      data-inline
                    >
                      Configure
                    </Link>
                    {updateInfo && (
                      <button
                        onClick={() =>
                          upgradeMutation.mutate({ id: pkg.id, version: updateInfo.latestVersion })
                        }
                        disabled={isUpgrading}
                        className={cn(
                          "text-xs font-bold px-3 py-1.5 rounded-lg transition-colors",
                          isUpgrading
                            ? "bg-primary/40 text-background-dark cursor-wait"
                            : "bg-primary text-background-dark hover:bg-primary/90",
                        )}
                      >
                        {isUpgrading ? "Updating…" : `Update to v${updateInfo.latestVersion}`}
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmRemove(pkg)}
                      disabled={isUninstalling}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      {isUninstalling ? "Uninstalling…" : "Uninstall"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmRemove && (
        <ConfirmDialog
          open
          title="Uninstall package?"
          description={`This removes "${confirmRemove.packageName}" from your workspace. Any agents currently using it will lose access. This can't be undone.`}
          confirmLabel="Uninstall"
          variant="destructive"
          onConfirm={() => {
            uninstallMutation.mutate(confirmRemove.id);
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
