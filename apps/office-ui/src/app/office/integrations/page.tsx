"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { QueryError } from "@/components/ui/QueryError";

// -- Types ------------------------------------------------------------------

interface Integration {
  id: string;
  name: string;
  category: "communication" | "productivity" | "development" | "custom_mcp";
  integration_type: string;
  status: "active" | "needs_attention" | "disconnected";
  settings: Record<string, unknown>;
  mcp_command?: string;
  connected_at?: string;
  last_synced_at?: string;
  created_at: string;
}

type Category = Integration["category"] | "all";

interface SandboxMcpServer {
  id: string;
  name: string;
  enabled: boolean;
  tools: { name: string; description: string; enabled: boolean }[];
}

interface SandboxToolInfo {
  name: string;
  description: string;
  source: "builtin" | { mcp: { id: string; name: string } };
  enabled: boolean;
}

// -- Available tool definitions (hardcoded) ---------------------------------

const AVAILABLE_TOOLS = [
  { name: "Slack", type: "slack", category: "communication" as const, icon: "forum", color: "#4A154B" },
  { name: "GitHub", type: "github", category: "development" as const, icon: "code", color: "#24292e" },
  { name: "Jira", type: "jira", category: "productivity" as const, icon: "assignment", color: "#0052CC" },
  { name: "Notion", type: "notion", category: "productivity" as const, icon: "edit_note", color: "#000000" },
  { name: "Linear", type: "linear", category: "productivity" as const, icon: "timeline", color: "#5E6AD2" },
  { name: "Postgres", type: "postgres", category: "development" as const, icon: "database", color: "#336791" },
  { name: "Brave Search", type: "brave_search", category: "productivity" as const, icon: "travel_explore", color: "#FB542B" },
];

const TABS: { value: Category; label: string }[] = [
  { value: "all", label: "All Tools" },
  { value: "communication", label: "Communication" },
  { value: "productivity", label: "Productivity" },
  { value: "development", label: "Development" },
  { value: "custom_mcp", label: "Custom MCP" },
];

const STATUS_CONFIG: Record<
  Integration["status"],
  { label: string; dotClass: string; badgeClass: string }
> = {
  active: {
    label: "Active",
    dotClass: "bg-accent-success",
    badgeClass: "bg-accent-success/10 border-accent-success/30 text-accent-success",
  },
  needs_attention: {
    label: "Needs Attention",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-500/10 border-red-500/30 text-red-400",
  },
  disconnected: {
    label: "Disconnected",
    dotClass: "bg-slate-500",
    badgeClass: "bg-surface-dark border-border-dark text-text-muted",
  },
};

// -- Toggle -----------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-primary" : "bg-surface-dark",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

// -- Toast ------------------------------------------------------------------

function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl border shadow-2xl text-sm font-bold animate-in slide-in-from-bottom-4",
        type === "success"
          ? "bg-accent-success/10 border-accent-success/30 text-accent-success"
          : "bg-red-500/10 border-red-500/30 text-red-400"
      )}
    >
      <span className="icon text-lg">
        {type === "success" ? "check_circle" : "error"}
      </span>
      {message}
    </div>
  );
}

// -- Integration Card -------------------------------------------------------

function IntegrationCard({
  integration,
  onConfigure,
  onReconnect,
  onConnect,
}: {
  integration: Integration;
  onConfigure: () => void;
  onReconnect: () => void;
  onConnect: () => void;
}) {
  const status = STATUS_CONFIG[integration.status];
  const tool = AVAILABLE_TOOLS.find((t) => t.type === integration.integration_type);
  const iconColor = tool?.color ?? "#0db9f2";

  return (
    <div className="glass-panel rounded-xl p-5 flex flex-col gap-4 group hover:border-primary/40 transition-all">
      {/* Top row: icon + status badge */}
      <div className="flex items-start justify-between">
        <div
          className="size-12 rounded-lg flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${iconColor}30, ${iconColor}60)`,
          }}
        >
          <span className="icon text-2xl" style={{ color: iconColor }}>
            {tool?.icon ?? "extension"}
          </span>
        </div>

        {integration.status !== "disconnected" && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide",
              status.badgeClass
            )}
          >
            <span className={cn("size-2 rounded-full", status.dotClass)} />
            {status.label}
          </div>
        )}
      </div>

      {/* Name + category */}
      <div>
        <h3 className="text-sm font-bold group-hover:text-primary transition-colors">
          {integration.name}
        </h3>
        <p className="text-[10px] text-text-muted uppercase tracking-widest mt-0.5 font-mono">
          {integration.category.replace("_", " ")}
        </p>
      </div>

      {/* Action button */}
      <div className="mt-auto">
        {integration.status === "active" && (
          <button
            onClick={onConfigure}
            className="w-full text-xs font-bold px-4 py-2 rounded-lg border border-primary/20 bg-primary/10 text-primary hover:bg-primary hover:text-background-dark transition-all text-center"
          >
            Configure
          </button>
        )}
        {integration.status === "needs_attention" && (
          <button
            onClick={onReconnect}
            className="w-full text-xs font-bold px-4 py-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all text-center"
          >
            Reconnect
          </button>
        )}
        {integration.status === "disconnected" && (
          <button
            onClick={onConnect}
            className="w-full text-xs font-bold px-4 py-2 rounded-lg border border-border-dark bg-surface-dark text-text-muted hover:border-primary/30 hover:text-primary transition-all text-center"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

// -- Available Tool Card ----------------------------------------------------

function AvailableToolCard({
  tool,
  onConnect,
  isPending,
}: {
  tool: (typeof AVAILABLE_TOOLS)[number];
  onConnect: () => void;
  isPending: boolean;
}) {
  return (
    <div className="glass-panel rounded-xl p-5 flex flex-col gap-4 group hover:border-primary/40 transition-all">
      <div
        className="size-12 rounded-lg flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${tool.color}30, ${tool.color}60)`,
        }}
      >
        <span className="icon text-2xl" style={{ color: tool.color }}>
          {tool.icon}
        </span>
      </div>

      <div>
        <h3 className="text-sm font-bold group-hover:text-primary transition-colors">
          {tool.name}
        </h3>
        <p className="text-[10px] text-text-muted uppercase tracking-widest mt-0.5 font-mono">
          {tool.category}
        </p>
      </div>

      <button
        onClick={onConnect}
        disabled={isPending}
        className="mt-auto w-full text-xs font-bold px-4 py-2 rounded-lg border border-border-dark bg-surface-dark text-text-muted hover:border-primary/30 hover:text-primary transition-all text-center disabled:opacity-50"
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-1.5">
            <span className="icon text-xs animate-spin">progress_activity</span>
            Connecting...
          </span>
        ) : (
          "Connect"
        )}
      </button>
    </div>
  );
}

// -- Main page --------------------------------------------------------------

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<Category>("all");
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [humanInTheLoop, setHumanInTheLoop] = useState(true);
  const [connectingType, setConnectingType] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => setToast({ message, type }),
    []
  );

  // -- Data fetching --------------------------------------------------------

  const { data: integrations = [], isLoading, isError, error, refetch } = useQuery<Integration[]>({
    queryKey: ["integrations", category],
    queryFn: () =>
      api
        .get("/integrations", {
          params: category !== "all" ? { category } : undefined,
        })
        .then((r) => r.data),
  });

  // -- Mutations ------------------------------------------------------------

  const connectTool = useMutation({
    mutationFn: (payload: { name: string; integration_type: string; category: string }) =>
      api.post("/integrations", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("Integration connected", "success");
      setConnectingType(null);
    },
    onError: () => {
      showToast("Failed to connect integration", "error");
      setConnectingType(null);
    },
  });

  const reconnectTool = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/${id}/reconnect`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("Integration reconnected", "success");
    },
    onError: () => showToast("Failed to reconnect integration", "error"),
  });

  const addMcpServer = useMutation({
    mutationFn: (payload: { name: string; mcp_command: string }) =>
      api.post("/integrations/mcp", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setMcpName("");
      setMcpCommand("");
      showToast("MCP server added", "success");
    },
    onError: () => showToast("Failed to add MCP server", "error"),
  });

  const removeMcpServer = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/mcp/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("MCP server removed", "success");
    },
    onError: () => showToast("Failed to remove MCP server", "error"),
  });

  // -- Sandbox MCP (sandboxed.sh proxy) ------------------------------------

  const { data: healthData } = useQuery<{ sandboxed: string }>({
    queryKey: ["health"],
    queryFn: () => axios.get("/health").then((r) => r.data),
    staleTime: 60000,
    retry: false,
  });
  const sandboxedAvailable = healthData?.sandboxed === "ok";

  const { data: sandboxMcpServers = [] } = useQuery<SandboxMcpServer[]>({
    queryKey: ["sandbox-mcp"],
    queryFn: () => api.get("/sandbox/mcp").then((r) => r.data),
    enabled: sandboxedAvailable,
    refetchInterval: 15000,
  });

  const { data: sandboxTools = [] } = useQuery<SandboxToolInfo[]>({
    queryKey: ["sandbox-tools"],
    queryFn: () => api.get("/sandbox/tools").then((r) => r.data),
    enabled: sandboxedAvailable,
    refetchInterval: 15000,
  });

  const [sbMcpExpanded, setSbMcpExpanded] = useState<string | null>(null);
  const [sbAddName, setSbAddName] = useState("");
  const [sbAddCommand, setSbAddCommand] = useState("");

  const sbToggleServer = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      api.post(`/sandbox/mcp/${id}/${enable ? "enable" : "disable"}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-mcp"] });
      queryClient.invalidateQueries({ queryKey: ["sandbox-tools"] });
    },
    onError: () => showToast("Failed to toggle MCP server", "error"),
  });

  const sbRefreshMcp = useMutation({
    mutationFn: () => api.post("/sandbox/mcp/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-mcp"] });
      queryClient.invalidateQueries({ queryKey: ["sandbox-tools"] });
      showToast("MCP servers refreshed", "success");
    },
    onError: () => showToast("Failed to refresh MCP servers", "error"),
  });

  const sbAddServer = useMutation({
    mutationFn: (payload: { name: string; command: string }) =>
      api.post("/sandbox/mcp", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-mcp"] });
      setSbAddName("");
      setSbAddCommand("");
      showToast("Sandbox MCP server added", "success");
    },
    onError: () => showToast("Failed to add sandbox MCP server", "error"),
  });

  const sbDeleteServer = useMutation({
    mutationFn: (id: string) => api.delete(`/sandbox/mcp/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-mcp"] });
      showToast("Sandbox MCP server removed", "success");
    },
    onError: () => showToast("Failed to remove sandbox MCP server", "error"),
  });

  const sbToggleTool = useMutation({
    mutationFn: (name: string) => api.post(`/sandbox/tools/${name}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-tools"] });
    },
    onError: () => showToast("Failed to toggle tool", "error"),
  });

  // -- Derived data ---------------------------------------------------------

  const connectedTypes = new Set(integrations.map((i) => i.integration_type));

  const availableTools = AVAILABLE_TOOLS.filter(
    (t) =>
      !connectedTypes.has(t.type) &&
      (category === "all" || t.category === category)
  );

  const connectedIntegrations = integrations.filter(
    (i) => i.category !== "custom_mcp"
  );

  const mcpServers = integrations.filter(
    (i) => i.category === "custom_mcp"
  );

  // -- Handlers -------------------------------------------------------------

  function handleConnectTool(tool: (typeof AVAILABLE_TOOLS)[number]) {
    setConnectingType(tool.type);
    connectTool.mutate({
      name: tool.name,
      integration_type: tool.type,
      category: tool.category,
    });
  }

  function handleAddMcpServer() {
    if (!mcpName.trim() || !mcpCommand.trim()) return;
    addMcpServer.mutate({ name: mcpName.trim(), mcp_command: mcpCommand.trim() });
  }

  // -- Error state ----------------------------------------------------------

  if (isError) {
    return (
      <div className="p-8">
        <QueryError error={error} onRetry={() => refetch()} label="Couldn't load integrations" />
      </div>
    );
  }

  // -- Loading state --------------------------------------------------------

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-10 w-64 bg-surface-dark rounded-lg animate-pulse" />
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-9 w-28 bg-surface-dark rounded-full animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-panel rounded-xl p-5 h-48 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // -- Render ---------------------------------------------------------------

  return (
    <div className="p-8 space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Integrations</h1>
          <p className="text-text-muted mt-1 text-sm">
            {integrations.length} tool{integrations.length !== 1 ? "s" : ""} connected to your workspace
          </p>
        </div>
        <button
          onClick={() => {
            const el = document.getElementById("available-tools");
            el?.scrollIntoView({ behavior: "smooth" });
          }}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          <span className="icon text-sm">add</span>
          Add Tool
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-border-dark/50 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setCategory(tab.value)}
            className={cn(
              "px-4 py-2 text-sm font-bold rounded-t-lg border-b-2 transition-all",
              category === tab.value
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-text-muted hover:text-white hover:border-border-dark"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Connected Tools */}
      {connectedIntegrations.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold">Connected Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {connectedIntegrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onConfigure={() =>
                  showToast(`Opening settings for ${integration.name}...`, "success")
                }
                onReconnect={() => reconnectTool.mutate(integration.id)}
                onConnect={() => {
                  const tool = AVAILABLE_TOOLS.find(
                    (t) => t.type === integration.integration_type
                  );
                  if (tool) handleConnectTool(tool);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Available Integrations */}
      {availableTools.length > 0 && (
        <section id="available-tools" className="space-y-4">
          <h2 className="text-lg font-bold">Available Integrations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {availableTools.map((tool) => (
              <AvailableToolCard
                key={tool.type}
                tool={tool}
                onConnect={() => handleConnectTool(tool)}
                isPending={connectingType === tool.type && connectTool.isPending}
              />
            ))}
          </div>
        </section>
      )}

      {/* Custom MCP Servers */}
      {(category === "all" || category === "custom_mcp") && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold">Custom MCP Servers</h2>
          <div className="glass-panel rounded-xl p-6 bg-background-dark/60 space-y-6">
            {/* Info banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
              <span className="icon text-primary mt-0.5">info</span>
              <div>
                <p className="text-xs font-bold text-primary">
                  Model Context Protocol
                </p>
                <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                  Add custom MCP servers to extend agent capabilities. Provide a
                  server name and the shell command used to start the server.
                </p>
              </div>
            </div>

            {/* Add form */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Server Name
                </label>
                <input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="e.g. my-custom-server"
                  className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-[2] space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Connection Command
                </label>
                <input
                  value={mcpCommand}
                  onChange={(e) => setMcpCommand(e.target.value)}
                  placeholder="e.g. npx -y @modelcontextprotocol/server-filesystem /path"
                  className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAddMcpServer}
                  disabled={
                    !mcpName.trim() || !mcpCommand.trim() || addMcpServer.isPending
                  }
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                >
                  {addMcpServer.isPending ? (
                    <>
                      <span className="icon text-sm animate-spin">progress_activity</span>
                      Adding...
                    </>
                  ) : (
                    <>
                      <span className="icon text-sm">add</span>
                      Add Server
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Active MCP servers */}
            {mcpServers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Active Servers
                </p>
                <div className="flex flex-wrap gap-2">
                  {mcpServers.map((server) => (
                    <div
                      key={server.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-dark border border-border-dark text-sm font-medium"
                    >
                      <span className="size-2 rounded-full bg-accent-success" />
                      <span>{server.name}</span>
                      {server.mcp_command && (
                        <span className="text-[10px] text-text-muted font-mono max-w-[200px] truncate">
                          {server.mcp_command}
                        </span>
                      )}
                      <button
                        onClick={() => removeMcpServer.mutate(server.id)}
                        disabled={removeMcpServer.isPending}
                        className="text-text-muted hover:text-red-400 transition-colors ml-1"
                      >
                        <span className="icon text-base">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mcpServers.length === 0 && (
              <div className="text-center py-6">
                <span className="icon text-4xl text-text-muted">dns</span>
                <p className="text-sm text-text-muted mt-2">
                  No custom MCP servers configured yet
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Sandbox MCP Servers (from sandboxed.sh) */}
      {sandboxedAvailable && (category === "all" || category === "custom_mcp") && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Sandbox MCP Servers</h2>
              <span className="text-[9px] font-mono uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                sandboxed.sh
              </span>
            </div>
            <button
              onClick={() => sbRefreshMcp.mutate()}
              disabled={sbRefreshMcp.isPending}
              className="flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-primary transition-colors"
            >
              <span className={cn("icon text-sm", sbRefreshMcp.isPending && "animate-spin")}>
                {sbRefreshMcp.isPending ? "progress_activity" : "refresh"}
              </span>
              Refresh
            </button>
          </div>

          <div className="glass-panel rounded-xl p-6 bg-background-dark/60 space-y-4">
            {/* Add sandbox MCP server */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Server Name
                </label>
                <input
                  value={sbAddName}
                  onChange={(e) => setSbAddName(e.target.value)}
                  placeholder="e.g. filesystem"
                  className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-[2] space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Command
                </label>
                <input
                  value={sbAddCommand}
                  onChange={(e) => setSbAddCommand(e.target.value)}
                  placeholder="e.g. npx -y @modelcontextprotocol/server-filesystem /workspace"
                  className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    if (sbAddName.trim() && sbAddCommand.trim())
                      sbAddServer.mutate({ name: sbAddName.trim(), command: sbAddCommand.trim() });
                  }}
                  disabled={!sbAddName.trim() || !sbAddCommand.trim() || sbAddServer.isPending}
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                >
                  <span className="icon text-sm">add</span>
                  Add
                </button>
              </div>
            </div>

            {/* Server list */}
            {sandboxMcpServers.length > 0 ? (
              <div className="space-y-2">
                {sandboxMcpServers.map((server) => (
                  <div key={server.id} className="rounded-lg border border-border-dark overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-dark/30">
                      <Toggle
                        checked={server.enabled}
                        onChange={() => sbToggleServer.mutate({ id: server.id, enable: !server.enabled })}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold">{server.name}</p>
                        <p className="text-[10px] text-text-muted">
                          {server.tools.length} tool{server.tools.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => setSbMcpExpanded(sbMcpExpanded === server.id ? null : server.id)}
                        className="p-1.5 rounded-lg hover:bg-background-dark transition-colors text-text-muted"
                      >
                        <span className="icon text-sm">
                          {sbMcpExpanded === server.id ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                      <button
                        onClick={() => sbDeleteServer.mutate(server.id)}
                        disabled={sbDeleteServer.isPending}
                        className="p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors text-text-muted hover:text-rose-400"
                      >
                        <span className="icon text-sm">delete</span>
                      </button>
                    </div>

                    {/* Expanded tools list */}
                    {sbMcpExpanded === server.id && server.tools.length > 0 && (
                      <div className="border-t border-border-dark/50 px-4 py-3 space-y-1.5">
                        {server.tools.map((tool) => (
                          <div key={tool.name} className="flex items-center gap-3 py-1">
                            <Toggle
                              checked={tool.enabled}
                              onChange={() => sbToggleTool.mutate(tool.name)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold font-mono">{tool.name}</p>
                              {tool.description && (
                                <p className="text-[10px] text-text-muted truncate">{tool.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <span className="icon text-4xl text-text-muted">dns</span>
                <p className="text-sm text-text-muted mt-2">
                  No sandbox MCP servers configured
                </p>
              </div>
            )}

            {/* Builtin tools summary */}
            {sandboxTools.filter((t) => t.source === "builtin").length > 0 && (
              <details className="rounded-lg border border-border-dark overflow-hidden">
                <summary className="px-4 py-3 bg-surface-dark/30 cursor-pointer flex items-center gap-2 hover:bg-surface-dark/50 transition-colors">
                  <span className="icon text-sm text-primary">build</span>
                  <span className="text-xs font-bold">
                    Built-in Tools ({sandboxTools.filter((t) => t.source === "builtin").length})
                  </span>
                </summary>
                <div className="border-t border-border-dark/50 px-4 py-3 space-y-1.5">
                  {sandboxTools
                    .filter((t) => t.source === "builtin")
                    .map((tool) => (
                      <div key={tool.name} className="flex items-center gap-3 py-1">
                        <Toggle
                          checked={tool.enabled}
                          onChange={() => sbToggleTool.mutate(tool.name)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold font-mono">{tool.name}</p>
                          {tool.description && (
                            <p className="text-[10px] text-text-muted truncate">{tool.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        </section>
      )}

      {/* Global Permissions banner */}
      <section className="glass-panel rounded-xl p-6 border-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="icon text-primary text-xl">shield</span>
            </div>
            <div>
              <h2 className="text-lg font-bold">Global Permissions</h2>
              <p className="text-sm text-text-muted mt-0.5">
                Require human approval before agents execute actions through
                connected integrations. When enabled, agents will pause and
                request confirmation for every tool invocation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-6 shrink-0">
            <span className="text-xs font-bold text-text-muted">
              Human-in-the-loop
            </span>
            <Toggle checked={humanInTheLoop} onChange={setHumanInTheLoop} />
          </div>
        </div>
      </section>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
