"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { cn } from "@/lib/utils";
import type { Conversation, Agent } from "@/types";
import { useState } from "react";

export default function MeetingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["meetings"],
    queryFn: () => api.get("/conversations").then((r) => r.data),
  });

  const workspaceId = useWorkspaceId();
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/agents`).then((r) => r.data),
    enabled: !!workspaceId,
  });

  const meetings = conversations.filter((c) => c.type === "meeting");

  const createMeeting = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/conversations", {
        title: title || "New Meeting",
        type: "meeting",
      });
      // Add selected agents as participants
      for (const agentId of selectedAgents) {
        await api.post(`/conversations/${data.id}/participants`, {
          participant_id: agentId,
          participant_type: "agent",
        });
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setShowCreate(false);
      setTitle("");
      setSelectedAgents([]);
      router.push(`/office/chat/${data.id}`);
    },
  });

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Meetings</h1>
          <p className="text-text-muted mt-1 text-sm">
            Collaborate with AI agents in structured meeting sessions
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-5 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          <span className="icon text-sm">video_call</span>
          New Meeting
        </button>
      </div>

      {/* Active meetings */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-panel rounded-xl p-5 h-40 animate-pulse" />
          ))}
        </div>
      ) : meetings.length === 0 ? (
        <div className="glass-panel rounded-xl p-16 text-center">
          <span className="icon text-5xl text-text-muted">groups</span>
          <p className="mt-4 font-bold text-lg">No meetings yet</p>
          <p className="text-text-muted text-sm mt-1">
            Start a meeting to collaborate with your AI agents
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-6 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-6 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all"
          >
            <span className="icon text-sm">video_call</span>
            Start First Meeting
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {meetings.map((meeting) => (
            <Link
              key={meeting.id}
              href={`/office/chat/${meeting.id}`}
              className="glass-panel rounded-xl p-5 group hover:border-primary/40 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="icon text-primary">groups</span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  {new Date(meeting.created_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="font-bold mt-3 group-hover:text-primary transition-colors">
                {meeting.title || "Untitled Meeting"}
              </h3>
              {meeting.session_label && (
                <p className="text-xs text-text-muted mt-1">{meeting.session_label}</p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] text-primary font-bold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                  Meeting
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create meeting modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel rounded-2xl p-8 w-full max-w-lg mx-4 border border-primary/20">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">New Meeting</h2>
              <button onClick={() => setShowCreate(false)} className="icon text-text-muted hover:text-white">
                close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted block mb-2">
                  Meeting Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Sprint Planning, Design Review..."
                  className="w-full px-4 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted block mb-2">
                  Invite Agents
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {agents.filter((a) => a.status !== "offline").map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() =>
                        setSelectedAgents((prev) =>
                          prev.includes(agent.id)
                            ? prev.filter((id) => id !== agent.id)
                            : [...prev, agent.id]
                        )
                      }
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-all",
                        selectedAgents.includes(agent.id)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border-dark hover:border-primary/30"
                      )}
                    >
                      <div
                        className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: `${agent.accent_color}20`, color: agent.accent_color }}
                      >
                        {agent.name.charAt(0)}
                      </div>
                      <span className="truncate font-medium">{agent.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-bold text-text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createMeeting.mutate()}
                disabled={createMeeting.isPending}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-6 py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
              >
                {createMeeting.isPending ? "Starting..." : "Start Meeting"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
