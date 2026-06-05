"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import { toast } from "@/store/useToastStore";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { Agent } from "@/types";

interface ConversationListItem {
  id: string;
  workspace_id: string;
  title: string | null;
  type: string;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  last_message: {
    id: string;
    content: string;
    sender_type: string;
    created_at: string;
  } | null;
  agents: { id: string; name: string; accent_color: string | null }[];
}

type FilterType = "all" | "direct" | "meeting" | "group";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ChatListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const workspaceId = useWorkspaceId();

  // Workspace-scoped + membership-gated (#4/#95): the cross-workspace
  // `GET /conversations` is admin-only, so non-admin members 403'd on it.
  const { data: conversations = [], isLoading } = useQuery<ConversationListItem[]>({
    queryKey: ["conversations", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/conversations`).then((r) => r.data),
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data).catch(() => []),
    enabled: !!workspaceId,
  });

  const filtered = conversations.filter((c) => {
    if (filter !== "all" && c.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchTitle = (c.title || "").toLowerCase().includes(q);
      const matchAgent = c.agents.some((a) => a.name.toLowerCase().includes(q));
      if (!matchTitle && !matchAgent) return false;
    }
    return true;
  });

  async function handleNewChat() {
    // Show a simple agent picker — create direct conversation with selected agent
    const agentId = prompt("Enter agent ID to chat with (or pick from Agents page):");
    if (!agentId) return;
    try {
      const agent = agents.find((a) => a.id === agentId);
      // Get workspaceId from the agent or fetch workspaces
      let workspaceId = agent?.workspace_id ?? "default";
      if (workspaceId === "default") {
        try {
          const wsRes = await api.get("/workspaces");
          if (wsRes.data?.length > 0) workspaceId = wsRes.data[0].id;
        } catch {}
      }
      const { data } = await api.post("/conversations", {
        workspaceId,
        title: agent ? `Chat with ${agent.name}` : "New conversation",
        type: "direct",
        agentIds: [agentId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/office/chat/${data.id}`);
    } catch {
      toast.error("Failed to create conversation", "Check the agent ID and try again.");
    }
  }

  async function handleDelete(convId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this conversation? All messages will be lost.")) return;
    try {
      await api.delete(`/conversations/${convId}`);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {}
  }

  const filterButtons: { key: FilterType; label: string; icon: string }[] = [
    { key: "all", label: "All", icon: "forum" },
    { key: "direct", label: "Direct", icon: "chat" },
    { key: "meeting", label: "Meetings", icon: "groups" },
    { key: "group", label: "Groups", icon: "group" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black">Chat</h1>
          <p className="text-sm text-text-muted mt-1">
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 bg-primary text-background-dark font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
        >
          <span className="icon text-[18px]">add</span>
          New Chat
        </button>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-1 bg-surface-dark/50 rounded-xl p-1 border border-white/5">
          {filterButtons.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-text-muted hover:text-white hover:bg-white/5"
              )}
            >
              <span className="icon text-sm">{f.icon}</span>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">search</span>
          <input
            type="text"
            placeholder="Search conversations or agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface-dark/50 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-text-muted focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Conversation List */}
      {isLoading ? (
        <SkeletonList count={8} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <span className="icon text-text-muted text-4xl mb-3 block">chat_bubble_outline</span>
          <p className="text-text-muted text-sm">
            {search || filter !== "all" ? "No conversations match your filters" : "No conversations yet"}
          </p>
          <p className="text-text-muted/60 text-xs mt-1">
            Start a chat from an agent&apos;s detail page or click &quot;New Chat&quot;
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((conv) => {
            const convIcon =
              conv.type === "meeting" ? "groups" : conv.type === "group" ? "group" : "chat";
            const agentColors = conv.agents.map((a) => a.accent_color || "#0db9f2");
            return (
              <Link
                key={conv.id}
                href={`/office/chat/${conv.id}`}
                className="flex items-center gap-4 p-4 rounded-xl hover:bg-surface-dark/50 border border-transparent hover:border-white/5 transition-all group"
              >
                {/* Icon / Avatar */}
                <div className="relative shrink-0">
                  {conv.agents.length > 0 ? (
                    <div
                      className="size-10 rounded-full flex items-center justify-center text-sm font-bold border"
                      style={{
                        backgroundColor: agentColors[0] + "20",
                        borderColor: agentColors[0] + "40",
                        color: agentColors[0],
                      }}
                    >
                      {conv.agents[0].name.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <div className="size-10 rounded-full bg-surface-dark border border-white/10 flex items-center justify-center">
                      <span className="icon text-text-muted text-lg">{convIcon}</span>
                    </div>
                  )}
                  {conv.agents.length > 1 && (
                    <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-accent-dark border border-background-dark flex items-center justify-center text-[9px] font-bold text-text-muted">
                      +{conv.agents.length - 1}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                      {conv.title || conv.agents.map((a) => a.name).join(", ") || "Untitled"}
                    </h3>
                    <span className="text-[10px] text-text-muted shrink-0">
                      {timeAgo(conv.last_message?.created_at || conv.updated_at)}
                    </span>
                  </div>
                  {conv.last_message?.content ? (
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {conv.last_message.sender_type === "agent" && (
                        <span className="text-primary/60">
                          {conv.agents.length === 1 ? conv.agents[0].name : "Agent"}:{" "}
                        </span>
                      )}
                      {conv.last_message.content}
                    </p>
                  ) : (
                    <p className="text-xs text-text-muted/50 italic mt-0.5">No messages yet</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-md capitalize",
                        conv.type === "meeting"
                          ? "bg-purple-500/10 text-purple-400"
                          : conv.type === "group"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-primary/10 text-primary"
                      )}
                    >
                      {conv.type}
                    </span>
                    {conv.message_count > 0 && (
                      <span className="text-[10px] text-text-muted">
                        {conv.message_count} message{conv.message_count !== 1 ? "s" : ""}
                      </span>
                    )}
                    {conv.agents.length > 0 && (
                      <span className="text-[10px] text-text-muted">
                        {conv.agents.map((a) => a.name).join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <button
                  onClick={(e) => handleDelete(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-accent-warning shrink-0"
                  title="Delete conversation"
                >
                  <span className="icon text-lg">delete</span>
                </button>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
