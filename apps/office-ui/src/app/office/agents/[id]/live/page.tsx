"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import api from "@/lib/api";
import type { Agent } from "@/types";

export default function AgentLivePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: agent } = useQuery<Agent>({
    queryKey: ["agent", params.id],
    queryFn: () => api.get(`/agents/${params.id}`).then((r) => r.data),
  });

  // Confetti effect on mount
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const confetti = (await import("canvas-confetti")).default;
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.4 },
          colors: ["#0db9f2", "#0bda57", "#ffffff"],
        });
      } catch {
        // canvas-confetti not available
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const accent = agent?.accent_color ?? "#0db9f2";

  return (
    <div className="min-h-screen bg-background-dark grid-bg flex flex-col">
      {/* Minimal header */}
      <header className="h-14 flex items-center justify-between px-8 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <span className="icon text-primary">bolt</span>
          <span className="font-black uppercase tracking-wider text-sm">AI Office OS</span>
        </div>
      </header>

      {/* Blur orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 blur-[100px] rounded-full" />
      </div>

      <div className="flex-1 flex items-center justify-center p-8 relative">
        <div className="w-full max-w-5xl space-y-8">
          {/* Success hero */}
          <div className="text-center space-y-4">
            <div className="relative inline-flex">
              <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
              <div className="relative size-28 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center success-pulse">
                <span className="icon text-primary text-6xl">check_circle</span>
              </div>
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold">
                {agent ? `${agent.name} is now Live!` : "Agent is now Live!"}
              </h1>
              <p className="text-text-muted mt-2">
                {agent?.role
                  ? `Your ${agent.role.toLowerCase()} is ready and waiting for tasks.`
                  : "Your AI coworker is deployed and waiting."}
              </p>
            </div>
          </div>

          {/* Main grid */}
          <div className="grid lg:grid-cols-12 gap-6">
            {/* Left: Agent identity + What's next */}
            <div className="lg:col-span-8 space-y-4">
              {/* Agent identity card */}
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  <div
                    className="md:w-48 p-6 flex items-center justify-center"
                    style={{ background: `${accent}15` }}
                  >
                    <div
                      className="size-24 rounded-full border-4 flex items-center justify-center"
                      style={{ borderColor: `${accent}40`, background: `${accent}20` }}
                    >
                      <span className="icon text-5xl" style={{ color: accent }}>
                        smart_toy
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                        Agent Identity
                      </span>
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-success/10 text-accent-success border border-accent-success/20 text-[10px] font-bold">
                        <span className="size-1.5 rounded-full bg-accent-success animate-pulse" />
                        Online
                      </span>
                    </div>
                    <h2 className="text-2xl font-bold">{agent?.name ?? "Loading..."}</h2>
                    <div className="mt-3 space-y-2">
                      {agent?.role && (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <span className="icon text-base">work</span>
                          {agent.role}
                        </div>
                      )}
                      {agent?.category && (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <span className="icon text-base">category</span>
                          {agent.category}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm text-accent-success">
                        <span className="icon text-base">shield</span>
                        System Health: Nominal
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* What's next */}
              <div className="glass-panel rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4">What&apos;s Next?</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    {
                      icon: "chat",
                      title: "Start a Chat",
                      desc: "Talk directly with your agent",
                      href: "/office/agents/" + params.id,
                    },
                    {
                      icon: "assignment_add",
                      title: "Assign a Task",
                      desc: "Give your agent its first mission",
                      href: "/office/projects",
                    },
                    {
                      icon: "terminal",
                      title: "View Logs",
                      desc: "Monitor agent activity",
                      href: `/office/logs?agent_id=${params.id}`,
                    },
                  ].map((action) => (
                    <Link
                      key={action.title}
                      href={action.href}
                      className="group flex flex-col items-center gap-3 p-4 rounded-xl border border-border-dark hover:border-primary/40 hover:bg-primary/5 transition-all text-center"
                    >
                      <div className="size-12 rounded-xl bg-primary/10 group-hover:bg-primary flex items-center justify-center transition-colors">
                        <span className="icon text-primary group-hover:text-background-dark transition-colors">
                          {action.icon}
                        </span>
                      </div>
                      <div>
                        <p className="font-bold text-sm">{action.title}</p>
                        <p className="text-[11px] text-text-muted mt-0.5">{action.desc}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: System health */}
            <div className="lg:col-span-4 space-y-4">
              <div className="glass-panel rounded-xl p-5 bg-primary/5 border border-primary/20">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-4">
                  System Health
                </p>
                <div className="space-y-4">
                  {[
                    { label: "Inference Speed", value: "Ready", pct: 100 },
                    { label: "Context Window", value: "Available", pct: 0 },
                    { label: "Status", value: "Idle", pct: 100 },
                  ].map((m) => (
                    <div key={m.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-muted">{m.label}</span>
                        <span className="text-primary font-bold">{m.value}</span>
                      </div>
                      <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${m.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {agent && (
                <div className="glass-panel rounded-xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">
                    Quick Info
                  </p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Agent ID</span>
                      <span className="font-mono text-primary truncate max-w-[120px]">
                        {agent.id.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Status</span>
                      <span className="text-accent-success font-bold capitalize">{agent.status}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer CTAs */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => router.push("/office")}
              className="bg-primary hover:bg-primary/90 text-background-dark font-black py-4 px-12 rounded-xl text-lg inline-flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all hover:scale-105"
            >
              Go to Dashboard →
            </button>
            <Link href="/office/agents" className="text-text-muted text-sm hover:text-primary transition-colors">
              Back to Agent Hub
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
