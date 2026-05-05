/**
 * Multi-service API client for Urule Office UI.
 *
 * Routes requests to the correct backend service based on the URL prefix.
 * In development, each service runs on a different port. In production,
 * a reverse proxy (nginx/traefik) routes by path prefix.
 *
 * Tokens are stored in the zustand auth store (persisted to localStorage
 * under the "urule-auth" key).
 */
import axios from "axios";
import { toast } from "@/store/useToastStore";

/**
 * Service URL configuration.
 * In development, services run on different ports.
 * In production, these would all be behind a single reverse proxy.
 */
const SERVICE_URLS: Record<string, string> = {
  registry: process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:3001",
  adapter: process.env.NEXT_PUBLIC_ADAPTER_URL ?? "http://localhost:3002",
  broker: process.env.NEXT_PUBLIC_BROKER_URL ?? "http://localhost:4500",
  approvals: process.env.NEXT_PUBLIC_APPROVALS_URL ?? "http://localhost:3003",
  governance: process.env.NEXT_PUBLIC_GOVERNANCE_URL ?? "http://localhost:3004",
  "mcp-gateway": process.env.NEXT_PUBLIC_MCP_GATEWAY_URL ?? "http://localhost:3005",
  "channel-router": process.env.NEXT_PUBLIC_CHANNEL_ROUTER_URL ?? "http://localhost:3006",
  state: process.env.NEXT_PUBLIC_STATE_URL ?? "http://localhost:3007",
  packages: process.env.NEXT_PUBLIC_PACKAGES_URL ?? "http://localhost:3008",
  packagehub: process.env.NEXT_PUBLIC_PACKAGEHUB_URL ?? "http://localhost:3009",
};

/**
 * Route map: URL prefix → service name.
 * Order matters — first match wins.
 */
const ROUTE_MAP: [string, string][] = [
  ["/orgs", "registry"],
  ["/workspaces", "registry"],
  ["/agents", "registry"],
  ["/runtimes", "registry"],
  ["/providers", "registry"],
  ["/conversations", "registry"],
  ["/approvals", "approvals"],
  ["/approval-rules", "approvals"],
  ["/governance", "governance"],
  ["/mcp", "mcp-gateway"],
  ["/channels", "channel-router"],
  ["/channel-bindings", "channel-router"],
  ["/identity-mappings", "channel-router"],
  ["/rooms", "state"],
  ["/tasks", "state"],
  ["/owners", "state"],
  ["/widget-state", "state"],
  ["/sessions", "broker"],
  ["/chat", "adapter"],
  ["/runs", "adapter"],
  ["/capabilities", "adapter"],
  ["/packages", "packages"],
  ["/users", "approvals"],
  ["/catalog", "registry"],
];

function resolveServiceUrl(path: string): string {
  const apiPath = path.replace(/^\/api\/v1/, "");
  for (const [prefix, service] of ROUTE_MAP) {
    if (apiPath.startsWith(prefix)) {
      return `${SERVICE_URLS[service]}/api/v1${apiPath}`;
    }
  }
  // Default to registry
  return `${SERVICE_URLS.registry}/api/v1${apiPath}`;
}

const api = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

/** Read a value from the persisted zustand auth store. */
function getPersistedAuthValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("urule-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.[key] ?? null;
  } catch {
    return null;
  }
}

// Resolve service URL and attach token on every request
api.interceptors.request.use((config) => {
  // Resolve the full URL from the relative path
  if (config.url && !config.url.startsWith("http")) {
    config.url = resolveServiceUrl(config.url);
  }

  const token = getPersistedAuthValue("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Mint a correlation ID at the browser so every backend hop logs the same value
  if (!config.headers["x-correlation-id"]) {
    config.headers["x-correlation-id"] =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return config;
});

/**
 * Avoid redirecting to /login from the login page itself — the unauthenticated
 * pages (login/register/forgot-password) live under the (auth) route group
 * and may issue requests that 401 by design (e.g., probing whether a session
 * is still valid). A naive redirect there causes a same-page reload loop.
 */
function isOnAuthPage(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return path === "/login" || path === "/register" || path === "/forgot-password";
}

function redirectToLogin(): void {
  if (typeof window === "undefined" || isOnAuthPage()) return;
  window.location.href = "/login";
}

// Auto-refresh on 401, surface 403 as a toast (the user is authenticated but
// lacks permission — redirecting to login is wrong; staying put + toast is
// the consistent UX).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = getPersistedAuthValue("refresh_token");
      if (refreshToken) {
        try {
          const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8281";
          const { data } = await axios.post(
            `${keycloakUrl}/realms/urule/protocol/openid-connect/token`,
            new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshToken,
              client_id: "urule-office",
            }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );
          const raw = localStorage.getItem("urule-auth");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.state) {
              parsed.state.access_token = data.access_token;
              parsed.state.refresh_token = data.refresh_token;
              localStorage.setItem("urule-auth", JSON.stringify(parsed));
            }
          }
          originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem("urule-auth");
          redirectToLogin();
        }
      } else {
        redirectToLogin();
      }
    }

    if (status === 403) {
      const serverMessage =
        (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
      toast.error(
        "Permission denied",
        serverMessage ?? "You don't have access to this resource.",
      );
    }

    return Promise.reject(error);
  }
);

export default api;
export { SERVICE_URLS, resolveServiceUrl };
