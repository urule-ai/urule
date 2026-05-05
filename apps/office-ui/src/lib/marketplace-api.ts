"use client";

/*
 * Thin axios wrapper that always targets the packagehub service for
 * marketplace browse/detail flows. The default `api` client routes
 * `/packages` to the *packages* install service via ROUTE_MAP, but
 * marketplace UI needs the *packagehub* discovery API instead. Rather
 * than overload `/packages` (the install routes need it), this module
 * goes direct.
 *
 * Auth is propagated by reading the same `urule-auth` localStorage entry
 * the main client uses, so a logged-in user's token reaches packagehub
 * without a separate sign-in.
 */

import axios from "axios";
import { SERVICE_URLS } from "./api";

function withAuth<T extends import("axios").AxiosRequestConfig>(config: T): T {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("urule-auth");
      if (raw) {
        const parsed = JSON.parse(raw);
        const token = parsed?.state?.access_token;
        if (token) {
          config.headers = { ...(config.headers ?? {}), Authorization: `Bearer ${token}` };
        }
      }
    } catch {
      // missing/corrupt auth — fall through unauthenticated.
    }
  }
  return config;
}

const marketplace = axios.create({
  baseURL: `${SERVICE_URLS["packagehub"]}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

marketplace.interceptors.request.use((config) => withAuth(config));

// Same shape, different base — `packages` is the install service, with
// its own routes (`/packages/install`, `/workspaces/:wsId/packages`) that
// the default `api` client routes through (the install action) but
// /workspaces/:wsId/* would otherwise hit the registry. Going direct.
const installedClient = axios.create({
  baseURL: `${SERVICE_URLS["packages"]}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

installedClient.interceptors.request.use((config) => withAuth(config));

export interface MarketplacePackage {
  id: string;
  name: string;
  type: string;
  description: string;
  author: string;
  repository: string | null;
  homepage: string | null;
  license: string | null;
  verified: boolean;
  downloads: number;
  tags: string[];
  publisherPubkey: string | null;
  pubkeyKind: string;
  licenseTier: "free" | "paid" | "subscription";
  priceCents: number | null;
  paymentProvider: string | null;
  paymentLink: string | null;
  createdAt: string;
  updatedAt: string;
  // Attached by the list endpoint:
  latestVersion?: { version: string; readme?: string; manifest?: Record<string, unknown> };
}

export interface PackageVersion {
  id: string;
  packageId: string;
  version: string;
  readme: string | null;
  yanked: boolean;
  publishedAt: string;
}

export type SortOption = "popular" | "recent";

export interface SearchFilters {
  q?: string;
  type?: string;
  verified?: boolean;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}

export async function searchPackages(filters: SearchFilters = {}): Promise<MarketplacePackage[]> {
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.type) params.type = filters.type;
  if (filters.verified !== undefined) params.verified = String(filters.verified);
  if (filters.sort) params.sort = filters.sort;
  if (filters.limit) params.limit = String(filters.limit);
  if (filters.offset) params.offset = String(filters.offset);
  const { data } = await marketplace.get<MarketplacePackage[]>("/packages", { params });
  return data;
}

export async function getPackage(name: string): Promise<MarketplacePackage> {
  const { data } = await marketplace.get<MarketplacePackage>(`/packages/${encodeURIComponent(name)}`);
  return data;
}

export async function getPackageVersions(name: string): Promise<PackageVersion[]> {
  const { data } = await marketplace.get<PackageVersion[]>(
    `/packages/${encodeURIComponent(name)}/versions`,
  );
  return data;
}

/**
 * Format `priceCents` as a localised currency string. Defaults to USD
 * since payment-provider integration is one-shot Stripe today; if/when
 * multi-currency lands the package row gains a currency code.
 */
export function formatPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/* -------- Installed package management (packages service) ------- */

export interface InstalledPackage {
  id: string;
  workspaceId: string;
  packageName: string;
  version: string;
  type: string;
  status: "pending" | "installing" | "installed" | "failed" | "removing";
  installedAt: string;
  config: Record<string, unknown>;
}

export interface UpdateAvailable {
  installationId: string;
  packageName: string;
  installedVersion: string;
  latestVersion: string;
}

export async function listInstalled(workspaceId: string): Promise<InstalledPackage[]> {
  const { data } = await installedClient.get<{ packages: InstalledPackage[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/packages`,
  );
  return data.packages ?? [];
}

export async function listAvailableUpdates(workspaceId: string): Promise<UpdateAvailable[]> {
  const { data } = await installedClient.get<{ updates: UpdateAvailable[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/updates`,
  );
  return data.updates ?? [];
}

export async function uninstallPackage(installId: string): Promise<void> {
  await installedClient.delete(`/packages/${encodeURIComponent(installId)}`);
}

export async function upgradePackage(installId: string, version?: string): Promise<InstalledPackage> {
  const { data } = await installedClient.post<InstalledPackage>(
    `/packages/${encodeURIComponent(installId)}/upgrade`,
    version ? { version } : {},
  );
  return data;
}
