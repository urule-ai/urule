"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/store/useToastStore";
import type { ModelProvider } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentTemplate {
  name: string;
  role: string;
  description: string;
  vibe: string;
  color: string;
  icon: string;
  system_prompt: string;
  traits: string[];
  skills: string[];
  communication_style: string;
  success_metrics: string[];
  tools_allowed?: string[];
  source_url: string;
  source_name: string;
  kind?: "personality" | "runtime";
  package_id?: string;
}

// ── Category icon mapping (derived from source repo folder structure) ─────────

const CATEGORY_ICONS: Record<string, string> = {
  engineering: "terminal",
  design: "brush",
  marketing: "trending_up",
  product: "target",
  "project-management": "assignment",
  specialized: "science",
  leadership: "business_center",
  testing: "bug_report",
};

// ── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  { label: "Browse & Select", icon: "person_search" },
  { label: "Configure", icon: "tune" },
  { label: "Review & Deploy", icon: "rocket_launch" },
];

// ── Category Catalog (loaded from PackageHub at runtime) ─────────────────────

// Type alias for agent entries (populated from PackageHub at runtime)
type AgentEntry = AgentTemplate & { category: string; categoryLabel: string };
// ALL_AGENTS — populated from PackageHub at runtime
const ALL_AGENTS: (AgentTemplate & { category: string; categoryLabel: string })[] = [];

// ── Thinking Depth Levels ────────────────────────────────────────────────────

const THINKING_LEVELS = [
  {
    value: "precise",
    label: "Precise",
    desc: "Deterministic, follows instructions exactly. Best for code, data, compliance.",
    temp: 0.2,
    icon: "precision_manufacturing",
    prompt_suffix: "\n\n## Thinking Mode: Precise\nBe deterministic and exact. Follow instructions literally. Minimize speculation. Cite sources. Double-check calculations. When uncertain, say so rather than guessing.",
  },
  {
    value: "balanced",
    label: "Balanced",
    desc: "Default — reliable answers with room for judgment calls.",
    temp: 0.5,
    icon: "balance",
    prompt_suffix: "\n\n## Thinking Mode: Balanced\nProvide reliable, well-reasoned answers. Use judgment when appropriate. Balance thoroughness with practicality.",
  },
  {
    value: "exploratory",
    label: "Exploratory",
    desc: "Creative problem-solving, brainstorming, diverse perspectives.",
    temp: 0.8,
    icon: "lightbulb",
    prompt_suffix: "\n\n## Thinking Mode: Exploratory\nExplore multiple angles and possibilities. Generate diverse ideas. Challenge assumptions. Think laterally. It's okay to suggest unconventional approaches.",
  },
] as const;

// ── Verbosity / Output Style ────────────────────────────────────────────────

const VERBOSITY_LEVELS = [
  {
    value: "terse",
    icon: "bolt",
    label: "Terse",
    desc: "Bullet points, no fluff. Just the answer.",
    prompt_suffix: "\n\n## Output Style: Terse\nKeep responses extremely concise. Use bullet points. No preamble, no filler. Lead with the answer. If it can be said in one sentence, don't use three.",
  },
  {
    value: "standard",
    icon: "chat_bubble",
    label: "Standard",
    desc: "Clear explanations with enough context to act on.",
    prompt_suffix: "\n\n## Output Style: Standard\nProvide clear, actionable responses with enough context to understand the reasoning. Use structured formatting when helpful.",
  },
  {
    value: "thorough",
    icon: "menu_book",
    label: "Thorough",
    desc: "Detailed analysis, full reasoning, comprehensive coverage.",
    prompt_suffix: "\n\n## Output Style: Thorough\nProvide comprehensive, detailed responses. Include full reasoning, alternatives considered, tradeoffs, and supporting evidence. Use sections and structure for readability.",
  },
] as const;

const ACCENT_COLORS = [
  "#0db9f2", "#0bda57", "#fa5f38", "#a78bfa", "#f59e0b",
  "#ec4899", "#14b8a6", "#6366f1",
];

// ── Progress Bar ─────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8" role="group" aria-label="Agent creation progress">
      {STEPS.map((s, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1" aria-label={`Step ${i + 1}: ${s.label}`} aria-current={i === current ? "step" : undefined}>
          <div
            className={cn(
              "h-2 w-full rounded-full transition-all",
              i <= current ? "bg-primary" : "bg-surface-dark"
            )}
            role="progressbar"
            aria-valuenow={i <= current ? 100 : 0}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <span
            className={cn(
              "text-[10px] font-mono uppercase tracking-widest",
              i <= current ? "text-primary" : "text-text-muted"
            )}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Agent Detail Modal ───────────────────────────────────────────────────────

function AgentDetailModal({
  agent,
  onClose,
  onSelect,
}: {
  agent: (typeof ALL_AGENTS)[0];
  onClose: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Agent details">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto glass-panel rounded-2xl border border-primary/20 p-8 neo-shadow">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div
              className="size-14 rounded-xl flex items-center justify-center"
              style={{ background: `${agent.color}20` }}
            >
              <span className="icon text-3xl" style={{ color: agent.color }}>
                {agent.icon}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-black">{agent.role}</h2>
              <p className="text-xs text-slate-500">{agent.name}</p>
              <span
                className="inline-block mt-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: `${agent.color}15`, color: agent.color }}
              >
                {agent.categoryLabel}
              </span>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Powered by{" "}
                <a
                  href={agent.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/70 hover:text-primary hover:underline"
                >
                  {agent.source_name}
                </a>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close agent details"
            className="size-8 rounded-lg bg-surface-dark border border-border-dark flex items-center justify-center hover:border-primary/30"
          >
            <span className="icon text-sm">close</span>
          </button>
        </div>

        {/* Vibe */}
        <div className="mb-5 p-3 rounded-lg bg-primary/5 border border-primary/10">
          <p className="text-sm text-primary/80 italic leading-relaxed">&ldquo;{agent.vibe}&rdquo;</p>
        </div>

        {/* Description */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Description</h3>
          <p className="text-sm leading-relaxed">{agent.description}</p>
        </div>

        {/* Personality Traits */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Personality Traits</h3>
          <div className="flex flex-wrap gap-2">
            {agent.traits.map((t) => (
              <span key={t} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Skills */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Skills & Expertise</h3>
          <div className="flex flex-wrap gap-2">
            {agent.skills.map((s) => (
              <span key={s} className="px-2.5 py-1 rounded bg-surface-dark text-xs border border-border-dark">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Communication Style */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Communication Style</h3>
          <p className="text-sm text-slate-300 leading-relaxed">{agent.communication_style}</p>
        </div>

        {/* Goals / Success Metrics */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Goals & Success Metrics</h3>
          <ul className="space-y-1.5">
            {agent.success_metrics.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="icon text-primary text-sm mt-0.5">check_circle</span>
                <span className="text-slate-300">{m}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Tools */}
        {agent.tools_allowed && agent.tools_allowed.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">Available Tools</h3>
            <div className="flex flex-wrap gap-2">
              {agent.tools_allowed.map((t) => (
                <span key={t} className="px-2.5 py-1 rounded bg-accent-dark/60 text-xs text-primary border border-primary/20 font-mono">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-border-dark">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { onSelect(); onClose(); }}
            className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          >
            <span className="icon text-sm">check</span>
            Select This Agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Browse & Select ──────────────────────────────────────────────────

function Step1({
  selectedAgent,
  onSelect,
  onCustom,
  onNext,
}: {
  selectedAgent: (typeof ALL_AGENTS)[0] | null;
  onSelect: (agent: (typeof ALL_AGENTS)[0]) => void;
  onCustom: () => void;
  onNext: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [detailAgent, setDetailAgent] = useState<(typeof ALL_AGENTS)[0] | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [allAgents, setAllAgents] = useState<(typeof ALL_AGENTS)>([]);
  const [categories, setCategories] = useState<{ id: string; label: string; icon: string }[]>([]);

  // Fetch ALL packages from PackageHub (single source of truth)
  useEffect(() => {
    const packagehubUrl = process.env.NEXT_PUBLIC_PACKAGEHUB_URL ?? "http://localhost:3009";
    fetch(`${packagehubUrl}/api/v1/packages`)
      .then(r => r.ok ? r.json() : [])
      .then((pkgs: Array<{
        id: string;
        name: string;
        description: string;
        latest_version?: {
          manifest?: {
            kind?: string;
            source?: { name: string; url: string };
            category?: string;
            categoryLabel?: string;
            display?: { color?: string; icon?: string; vibe?: string };
            personality?: { systemPrompt?: string; goals?: string[]; defaultTools?: string[]; operatingStyle?: string };
            traits?: string[];
            skills?: string[];
            successMetrics?: string[];
            runtime?: Record<string, unknown>;
            capabilities?: { tools?: string[] };
          };
        };
      }>) => {
        const mapped = pkgs.map(pkg => {
          const m = pkg.latest_version?.manifest;
          const display = m?.display ?? {};
          const personality = m?.personality ?? {};
          const source = m?.source ?? { name: "PackageHub", url: "" };
          // Generate a readable display name from the package name
          const displayName = pkg.name
            .replace(/^@[^/]+\//, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
          return {
            name: displayName,
            role: pkg.description || displayName,
            description: pkg.description || "",
            vibe: display.vibe || personality.operatingStyle || "",
            color: display.color || "#6366f1",
            icon: display.icon || "smart_toy",
            system_prompt: personality.systemPrompt || "",
            traits: m?.traits || (personality.goals || []).slice(0, 4),
            skills: m?.skills || personality.defaultTools || [],
            communication_style: personality.operatingStyle || "",
            success_metrics: m?.successMetrics || [],
            tools_allowed: m?.capabilities?.tools || personality.defaultTools || [],
            source_url: source.url || "",
            source_name: source.name || "PackageHub",
            kind: (m?.kind || "personality") as "personality" | "runtime",
            package_id: pkg.id,
            category: m?.category || "other",
            categoryLabel: m?.categoryLabel || "Other",
          };
        });
        setAllAgents(mapped);

        // Build unique categories from the data
        const catMap = new Map<string, string>();
        mapped.forEach(a => catMap.set(a.category, a.categoryLabel));
        const cats = Array.from(catMap.entries()).map(([id, label]) => ({
          id,
          label,
          icon: CATEGORY_ICONS[id] || "folder",
        }));
        setCategories(cats);
      })
      .catch(() => toast.error("Failed to load templates", "Could not fetch agent templates from PackageHub."));
  }, []);

  const filtered = activeCategory === "all"
    ? allAgents
    : allAgents.filter((a) => a.category === activeCategory);

  return (
    <>
      <div className="glass-panel rounded-xl p-8 neo-shadow space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="icon text-primary">person_search</span>
          <h2 className="text-xl font-bold">Browse Agent Catalog</h2>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Agent categories">
          <button
            onClick={() => setActiveCategory("all")}
            role="tab"
            aria-selected={activeCategory === "all"}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              activeCategory === "all"
                ? "bg-primary text-background-dark"
                : "bg-surface-dark border border-border-dark text-text-muted hover:border-primary/30"
            )}
          >
            All
          </button>
          {categories.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveCategory(d.id)}
              role="tab"
              aria-selected={activeCategory === d.id}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                activeCategory === d.id
                  ? "bg-primary text-background-dark"
                  : "bg-surface-dark border border-border-dark text-text-muted hover:border-primary/30"
              )}
            >
              <span className="icon" style={{ fontSize: 14 }}>{d.icon}</span>
              {d.label}
            </button>
          ))}
        </div>

        {/* Agent grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="tabpanel" aria-label={`${activeCategory === "all" ? "All" : categories.find(c => c.id === activeCategory)?.label ?? activeCategory} agents`}>
          {filtered.map((agent) => {
            const isSelected = !isCustom && selectedAgent?.name === agent.name;
            return (
              <div
                key={agent.name}
                className={cn(
                  "relative flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all group",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border-dark hover:border-primary/40"
                )}
                onClick={() => {
                  setIsCustom(false);
                  onSelect(agent);
                }}
              >
                {isSelected && (
                  <span className="absolute top-3 right-3 size-5 rounded-full bg-primary flex items-center justify-center">
                    <span className="icon text-background-dark" style={{ fontSize: 12 }}>check</span>
                  </span>
                )}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="size-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${agent.color}20` }}
                  >
                    <span className="icon text-xl" style={{ color: agent.color }}>
                      {agent.icon}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                      {agent.role}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">{agent.name}</p>
                  </div>
                </div>
                <p className="text-[11px] text-primary/60 italic mb-1">{agent.vibe}</p>
                <p className="text-xs text-slate-400 line-clamp-2 mb-3 flex-1">
                  {agent.description}
                </p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {agent.skills.slice(0, 4).map((s) => (
                    <span key={s} className="px-1.5 py-0.5 rounded bg-background-dark/60 text-[10px] text-slate-300 border border-primary/10">
                      {s}
                    </span>
                  ))}
                  {agent.skills.length > 4 && (
                    <span className="px-1.5 py-0.5 rounded bg-background-dark/60 text-[10px] text-text-muted border border-primary/10">
                      +{agent.skills.length - 4}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] text-slate-500">
                    Powered by{" "}
                    <a
                      href={agent.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary/70 hover:text-primary hover:underline"
                    >
                      {agent.source_name}
                    </a>
                  </p>
                  {agent.kind === "runtime" && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-[9px] font-bold text-amber-400 border border-amber-500/20 uppercase">
                      Runtime
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailAgent(agent);
                  }}
                  className="text-xs text-primary font-bold hover:underline self-start"
                >
                  More Detail →
                </button>
              </div>
            );
          })}
        </div>

        {/* Custom agent option */}
        <div
          className={cn(
            "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
            isCustom
              ? "border-primary bg-primary/5"
              : "border-dashed border-border-dark hover:border-primary/30"
          )}
          onClick={() => {
            setIsCustom(true);
            onCustom();
          }}
        >
          <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="icon text-primary text-xl">edit_note</span>
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm">Custom Agent</p>
            <p className="text-xs text-text-muted">Start from scratch with your own system prompt and configuration</p>
          </div>
          {isCustom && (
            <span className="size-5 rounded-full bg-primary flex items-center justify-center shrink-0">
              <span className="icon text-background-dark" style={{ fontSize: 12 }}>check</span>
            </span>
          )}
        </div>

        <div className="flex justify-between pt-2">
          <Link
            href="/office/agents"
            className="px-6 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={onNext}
            disabled={!selectedAgent && !isCustom}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black px-6 py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            Next Step
            <span className="icon text-sm">arrow_forward</span>
          </button>
        </div>
      </div>

      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          onClose={() => setDetailAgent(null)}
          onSelect={() => {
            setIsCustom(false);
            onSelect(detailAgent);
          }}
        />
      )}
    </>
  );
}

// ── Step 2: Configure ────────────────────────────────────────────────────────

function Step2({
  selectedAgent,
  isCustom,
  onNext,
  onBack,
}: {
  selectedAgent: (typeof ALL_AGENTS)[0] | null;
  isCustom: boolean;
  onNext: (config: ConfigValues) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(selectedAgent?.name ?? "");
  const [role, setRole] = useState(selectedAgent?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(selectedAgent?.system_prompt ?? "");
  const [accentColor, setAccentColor] = useState(selectedAgent?.color ?? "#0db9f2");
  const [verbosity, setVerbosity] = useState<string>("standard");
  const [thinkingLevel, setThinkingLevel] = useState<string>("balanced");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enabledTools, setEnabledTools] = useState<string[]>(selectedAgent?.tools_allowed ?? []);
  const [agentChannels, setAgentChannels] = useState<string[]>([]);
  const [nameError, setNameError] = useState("");
  const [roleError, setRoleError] = useState("");
  const [useCustomRole, setUseCustomRole] = useState(false);
  const [category, setCategory] = useState(selectedAgent?.category ?? "");
  const [categoryLabel, setCategoryLabel] = useState(selectedAgent?.categoryLabel ?? "");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [previewId] = useState(() => crypto.randomUUID());
  const [providerStatus, setProviderStatus] = useState<Record<string, "testing" | "ok" | "error">>({});

  const { data: providers = [] } = useQuery<ModelProvider[]>({
    queryKey: ["providers"],
    queryFn: () => api.get("/providers").then((r) => r.data),
  });

  const { data: toolDefs = [] } = useQuery<{ name: string; description: string }[]>({
    queryKey: ["tools"],
    queryFn: () => api.get("/tools").then((r) => r.data),
  });

  const { data: existingAgents = [] } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["agents-list"],
    queryFn: () => api.get("/agents").then((r) => r.data?.agents ?? r.data ?? []),
  });

  // Test provider connections on load
  useEffect(() => {
    providers.forEach(async (p) => {
      if (!p.is_active) {
        setProviderStatus((prev) => ({ ...prev, [p.id]: "error" }));
        return;
      }
      setProviderStatus((prev) => ({ ...prev, [p.id]: "testing" }));
      try {
        await api.post(`/providers/${p.id}/test`);
        setProviderStatus((prev) => ({ ...prev, [p.id]: "ok" }));
      } catch {
        setProviderStatus((prev) => ({ ...prev, [p.id]: "error" }));
      }
    });
  }, [providers]);

  // Auto-select first working provider
  useEffect(() => {
    if (selectedProviderId && providerStatus[selectedProviderId] === "ok") return;
    const firstOk = providers.find((p) => providerStatus[p.id] === "ok");
    if (firstOk) {
      setSelectedProviderId(firstOk.id);
      setSelectedModel(firstOk.model_name);
    }
  }, [providerStatus, providers, selectedProviderId]);

  function handleRoleChange(value: string) {
    if (value === "__custom__") {
      setUseCustomRole(true);
      setRole("");
      setCategory("");
      setCategoryLabel("");
      return;
    }
    setRole(value);
    // The role comes from the selected agent which is already set in Step 1
    if (selectedAgent && selectedAgent.role === value) {
      setCategory(selectedAgent.category);
      setCategoryLabel(selectedAgent.categoryLabel);
      if (!nameManuallyEdited) {
        setName(selectedAgent.name);
      }
    }
  }

  function handleSubmit() {
    let valid = true;
    if (!name.trim()) { setNameError("Required"); valid = false; } else { setNameError(""); }
    if (!role.trim()) { setRoleError("Required"); valid = false; } else { setRoleError(""); }
    if (!valid) return;

    const thinking = THINKING_LEVELS.find((t) => t.value === thinkingLevel);
    const verb = VERBOSITY_LEVELS.find((v) => v.value === verbosity);
    const temp = thinking?.temp ?? 0.5;

    // Append thinking mode and verbosity instructions to the system prompt
    const finalPrompt = systemPrompt
      + (thinking?.prompt_suffix ?? "")
      + (verb?.prompt_suffix ?? "");

    onNext({
      name,
      role,
      systemPrompt: finalPrompt,
      accentColor,
      verbosity,
      thinkingLevel,
      temperature: temp,
      selectedProviderId,
      selectedModel,
      enabledTools,
      agentChannels,
      category,
    });
  }

  const PROVIDER_ICON: Record<string, string> = {
    claude: "auto_awesome",
    openai: "rocket_launch",
    lmstudio: "memory",
    openrouter: "hub",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Identity */}
          <div className="glass-panel rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="icon text-primary">badge</span>
              <h2 className="text-lg font-bold">Agent Identity</h2>
            </div>

            {/* Agent ID */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Agent ID</label>
              <div className="px-4 py-2.5 bg-background-dark/30 border border-border-dark rounded-lg text-xs font-mono text-text-muted tracking-wide select-all">
                {previewId}
              </div>
              <p className="text-[10px] text-text-muted">Unique identifier — assigned on deploy</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Name *</label>
                <input
                  className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Agent name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setNameManuallyEdited(true); }}
                />
                {selectedAgent && !isCustom ? (
                  name === selectedAgent.name ? (
                    <p className="text-[10px] text-primary/70 flex items-center gap-1">
                      <span className="icon" style={{ fontSize: 10 }}>link</span>
                      From {selectedAgent.name} template
                    </p>
                  ) : (
                    <p className="text-[10px] text-text-muted flex items-center gap-1">
                      <span className="icon" style={{ fontSize: 10 }}>edit</span>
                      Customized from {selectedAgent.name}
                    </p>
                  )
                ) : null}
                {nameError && <p className="text-xs text-accent-warning">{nameError}</p>}
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Role *</label>
                {useCustomRole ? (
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="e.g. Data Pipeline Architect"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { setUseCustomRole(false); setRole(selectedAgent?.role ?? ""); }}
                      className="px-3 py-3 bg-surface-dark border border-border-dark rounded-lg hover:border-primary/30 transition-colors"
                      title="Switch to role catalog"
                    >
                      <span className="icon text-sm text-text-muted">list</span>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Agent role (e.g. Frontend Developer)"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    />
                    {selectedAgent && !isCustom && role !== selectedAgent.role && (
                      <button
                        onClick={() => handleRoleChange(selectedAgent.role)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-primary hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                )}
                {roleError && <p className="text-xs text-accent-warning">{roleError}</p>}
                {categoryLabel && !useCustomRole && (
                  <p className="text-[10px] text-text-muted flex items-center gap-1">
                    <span className="icon" style={{ fontSize: 10 }}>folder</span>
                    {categoryLabel}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* AI Model */}
          <div className="glass-panel rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="icon text-primary">psychology</span>
              <h2 className="text-lg font-bold">AI Model</h2>
            </div>
            {providers.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border-dark rounded-xl">
                <span className="icon text-3xl text-text-muted">cloud_off</span>
                <p className="mt-2 text-sm text-text-muted">No providers configured.</p>
                <Link href="/office/settings" className="mt-2 inline-flex items-center gap-1 text-primary text-sm font-bold hover:underline">
                  Add a provider <span className="icon text-sm">arrow_forward</span>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {providers.map((p) => {
                  const status = providerStatus[p.id];
                  const isDisabled = status === "error" || status === "testing";
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center",
                        isDisabled
                          ? "border-border-dark opacity-40 cursor-not-allowed"
                          : selectedProviderId === p.id
                            ? "border-primary bg-primary/5 cursor-pointer"
                            : "border-border-dark hover:border-primary/50 cursor-pointer"
                      )}
                    >
                      <input type="radio" className="sr-only" disabled={isDisabled} checked={selectedProviderId === p.id}
                        onChange={() => { if (!isDisabled) { setSelectedProviderId(p.id); setSelectedModel(p.model_name); } }}
                      />
                      <span className={cn("icon text-xl", isDisabled ? "text-text-muted" : "text-primary")}>
                        {PROVIDER_ICON[p.provider] ?? "psychology"}
                      </span>
                      <span className="text-xs font-bold truncate w-full">{p.name}</span>
                      <span className="text-[10px] text-text-muted font-mono truncate w-full">{p.model_name}</span>
                      {status === "testing" && (
                        <span className="text-[10px] text-text-muted animate-pulse">Connecting...</span>
                      )}
                      {status === "ok" && (
                        <span className="text-[10px] text-accent-success flex items-center gap-0.5">
                          <span className="icon" style={{ fontSize: 10 }}>check_circle</span> Connected
                        </span>
                      )}
                      {status === "error" && (
                        <span className="text-[10px] text-accent-warning flex items-center gap-0.5">
                          <span className="icon" style={{ fontSize: 10 }}>error</span> Not configured
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* System Prompt */}
          <div className="glass-panel rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="icon text-primary">description</span>
              <h2 className="text-lg font-bold">System Prompt</h2>
            </div>
            <textarea
              rows={6}
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono"
              placeholder="You are an AI assistant specialized in..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>

          {/* Output Style / Verbosity */}
          <div className="glass-panel rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="icon text-primary">chat_bubble</span>
              <h2 className="text-lg font-bold">Output Style</h2>
              <span className="text-[10px] text-text-muted font-mono">(controls response verbosity)</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {VERBOSITY_LEVELS.map((vl) => (
                <label
                  key={vl.value}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all",
                    verbosity === vl.value ? "border-primary bg-primary/5" : "border-border-dark hover:border-primary/30"
                  )}
                >
                  <input type="radio" className="sr-only" value={vl.value}
                    checked={verbosity === vl.value} onChange={() => setVerbosity(vl.value)}
                  />
                  <span className="icon text-primary text-2xl">{vl.icon}</span>
                  <span className="text-sm font-bold">{vl.label}</span>
                  <span className="text-[10px] text-text-muted text-center">{vl.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Thinking Depth */}
          <div className="glass-panel rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="icon text-primary">neurology</span>
              <h2 className="text-lg font-bold">Thinking Mode</h2>
              <span className="text-[10px] text-text-muted font-mono">(reasoning style + temperature)</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {THINKING_LEVELS.map((tl) => (
                <label
                  key={tl.value}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all",
                    thinkingLevel === tl.value ? "border-primary bg-primary/5" : "border-border-dark hover:border-primary/30"
                  )}
                >
                  <input type="radio" className="sr-only" value={tl.value}
                    checked={thinkingLevel === tl.value} onChange={() => setThinkingLevel(tl.value)}
                  />
                  <span className="icon text-primary text-2xl">{tl.icon}</span>
                  <span className="text-sm font-bold">{tl.label}</span>
                  <span className="text-[10px] text-text-muted text-center">{tl.desc}</span>
                  <span className="text-[10px] font-mono text-primary">temp: {tl.temp}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Advanced Configuration (collapsible) */}
          <div className="glass-panel rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-6 hover:bg-surface-dark/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="icon text-primary">settings</span>
                <h2 className="text-lg font-bold">Advanced Configuration</h2>
              </div>
              <span className={cn("icon text-text-muted transition-transform", showAdvanced && "rotate-180")}>
                expand_more
              </span>
            </button>

            {showAdvanced && (
              <div className="px-6 pb-6 space-y-6 border-t border-border-dark pt-4">
                {/* Tool Access */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
                    <span className="icon text-primary text-sm">build</span>
                    Tool Access
                  </h3>
                  {toolDefs.length === 0 ? (
                    <p className="text-xs text-text-muted py-3">No tools available. Configure tools in Settings → Integrations.</p>
                  ) : (
                    <div className="space-y-2">
                      {toolDefs.map((tool) => (
                        <label key={tool.name} className="flex items-center justify-between p-3 rounded-lg bg-background-dark/40 border border-border-dark hover:border-primary/20 cursor-pointer transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{tool.name}</p>
                            <p className="text-[10px] text-text-muted truncate">{tool.description}</p>
                          </div>
                          <div className={cn(
                            "relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ml-3",
                            enabledTools.includes(tool.name) ? "bg-primary" : "bg-surface-dark border border-border-dark"
                          )}>
                            <input type="checkbox" className="sr-only"
                              checked={enabledTools.includes(tool.name)}
                              onChange={() => {
                                setEnabledTools((prev) =>
                                  prev.includes(tool.name)
                                    ? prev.filter((t) => t !== tool.name)
                                    : [...prev, tool.name]
                                );
                              }}
                            />
                            <div className={cn(
                              "absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform",
                              enabledTools.includes(tool.name) && "translate-x-5"
                            )} />
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Agent Communication Channels */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
                    <span className="icon text-primary text-sm">forum</span>
                    Agent Communication Channels
                  </h3>
                  <p className="text-[10px] text-text-muted mb-3">Select which agents this one can communicate with directly.</p>
                  {existingAgents.length === 0 ? (
                    <p className="text-xs text-text-muted py-3">No other agents deployed yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {existingAgents.map((other) => (
                        <label key={other.id} className="flex items-center justify-between p-3 rounded-lg bg-background-dark/40 border border-border-dark hover:border-primary/20 cursor-pointer transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                              <span className="icon text-primary text-sm">smart_toy</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium">{other.name}</p>
                              <p className="text-[10px] text-text-muted">{other.role}</p>
                            </div>
                          </div>
                          <div className={cn(
                            "relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ml-3",
                            agentChannels.includes(other.id) ? "bg-primary" : "bg-surface-dark border border-border-dark"
                          )}>
                            <input type="checkbox" className="sr-only"
                              checked={agentChannels.includes(other.id)}
                              onChange={() => {
                                setAgentChannels((prev) =>
                                  prev.includes(other.id)
                                    ? prev.filter((id) => id !== other.id)
                                    : [...prev, other.id]
                                );
                              }}
                            />
                            <div className={cn(
                              "absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform",
                              agentChannels.includes(other.id) && "translate-x-5"
                            )} />
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Accent Color */}
          <div className="glass-panel rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="icon text-primary">palette</span>
              <h2 className="text-lg font-bold">Accent Color</h2>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAccentColor(color)}
                  className={cn(
                    "size-10 rounded-lg border-2 transition-all",
                    accentColor === color ? "border-white scale-110" : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div
              className="mt-4 p-4 rounded-xl border flex items-center gap-3"
              style={{
                background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}30)`,
                borderColor: `${accentColor}40`,
              }}
            >
              <div className="size-12 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}20` }}>
                <span className="icon text-2xl" style={{ color: accentColor }}>smart_toy</span>
              </div>
              <div>
                <p className="font-bold text-sm">{name || "Agent Name"}</p>
                <p className="text-xs text-text-muted">{role || "Role"}</p>
              </div>
            </div>
          </div>

          {/* Based On card */}
          {selectedAgent && !isCustom && (
            <div className="glass-panel rounded-xl p-5 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Based On</p>
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg flex items-center justify-center" style={{ background: `${selectedAgent.color}20` }}>
                  <span className="icon text-xl" style={{ color: selectedAgent.color }}>{selectedAgent.icon}</span>
                </div>
                <div>
                  <p className="text-sm font-bold">{selectedAgent.name}</p>
                  <p className="text-[10px] text-text-muted">{selectedAgent.categoryLabel}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Powered by{" "}
                    <a
                      href={selectedAgent.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary/70 hover:text-primary hover:underline"
                    >
                      {selectedAgent.source_name}
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Config Summary */}
          <div className="glass-panel rounded-xl p-5 bg-primary/5 border border-primary/20 space-y-3">
            <div className="flex items-start gap-3">
              <span className="icon text-primary mt-0.5">info</span>
              <div>
                <p className="text-xs font-bold text-primary">Configuration Tips</p>
                <ul className="text-[11px] text-text-muted mt-1 leading-relaxed space-y-1">
                  <li>• Lower thinking depth = faster, cheaper responses</li>
                  <li>• Enable only the tools the agent actually needs</li>
                  <li>• Agent channels enable direct AI-to-AI collaboration</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          <span className="icon text-sm">arrow_forward</span>
          Continue to Review
        </button>
      </div>
    </div>
  );
}

// ── Config values from Step 2 ────────────────────────────────────────────────

interface ConfigValues {
  name: string;
  role: string;
  systemPrompt: string;
  accentColor: string;
  verbosity: string;
  thinkingLevel: string;
  temperature: number;
  selectedProviderId: string;
  selectedModel: string;
  enabledTools: string[];
  agentChannels: string[];
  category: string;
}

// ── Step 3: Review & Deploy ──────────────────────────────────────────────────

function Step3({
  config,
  onBack,
  onDeploy,
  deploying,
}: {
  config: ConfigValues;
  onBack: () => void;
  onDeploy: () => void;
  deploying: boolean;
}) {
  const thinkingLabel = THINKING_LEVELS.find((t) => t.value === config.thinkingLevel)?.label ?? "Balanced";
  const verbosityLabel = VERBOSITY_LEVELS.find((v) => v.value === config.verbosity)?.label ?? "Standard";

  return (
    <div className="glass-panel rounded-xl p-8 neo-shadow space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <span className="icon text-primary">fact_check</span>
        <h2 className="text-xl font-bold">Review & Deploy</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity */}
        <div className="space-y-3 p-4 rounded-xl bg-background-dark/40 border border-border-dark">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Agent Identity</p>
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-xl flex items-center justify-center" style={{ background: `${config.accentColor}20` }}>
              <span className="icon text-2xl" style={{ color: config.accentColor }}>smart_toy</span>
            </div>
            <div>
              <p className="font-bold">{config.name}</p>
              <p className="text-sm text-text-muted">{config.role}</p>
              {config.category && (
                <p className="text-[10px] text-primary uppercase font-mono">{config.category}</p>
              )}
            </div>
          </div>
        </div>

        {/* Configuration */}
        <div className="space-y-3 p-4 rounded-xl bg-background-dark/40 border border-border-dark">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Configuration</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Model</span>
              <span className="font-mono text-xs">{config.selectedModel || "Default"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Thinking</span>
              <span className="font-medium">{thinkingLabel} (temp {config.temperature})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Output</span>
              <span className="capitalize">{config.verbosity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Tools</span>
              <span>{config.enabledTools.length} enabled</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Channels</span>
              <span>{config.agentChannels.length} agent{config.agentChannels.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Prompt Preview */}
      {config.systemPrompt && (
        <div className="p-4 rounded-xl bg-background-dark/40 border border-border-dark">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">System Prompt</p>
          <p className="text-sm text-slate-300 leading-relaxed line-clamp-6 font-mono">{config.systemPrompt}</p>
        </div>
      )}

      {/* Enabled Tools */}
      {config.enabledTools.length > 0 && (
        <div className="p-4 rounded-xl bg-background-dark/40 border border-border-dark">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Enabled Tools</p>
          <div className="flex flex-wrap gap-2">
            {config.enabledTools.map((t) => (
              <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent-success/10 text-accent-success text-xs border border-accent-success/20">
                <span className="icon" style={{ fontSize: 12 }}>check_circle</span>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onDeploy}
          disabled={deploying}
          className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-black py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {deploying ? (
            <>
              <span className="icon text-sm animate-spin">progress_activity</span>
              Deploying...
            </>
          ) : (
            <>
              <span className="icon text-sm">rocket_launch</span>
              Deploy Agent
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main Wizard Page ─────────────────────────────────────────────────────────

export default function NewAgentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<(typeof ALL_AGENTS)[0] | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [config, setConfig] = useState<ConfigValues | null>(null);
  const [deploying, setDeploying] = useState(false);

  async function handleDeploy() {
    if (!config) return;
    setDeploying(true);
    try {
      // Get or create a default workspace
      let workspaceId = 'default';
      try {
        const wsRes = await api.get("/workspaces");
        if (wsRes.data && wsRes.data.length > 0) {
          workspaceId = wsRes.data[0].id;
        }
      } catch {
        // Use default
      }
      const payload = {
        workspaceId,
        name: config.name,
        description: config.role || '',
        config: {
          role: config.role,
          systemPrompt: config.systemPrompt,
          accentColor: config.accentColor,
          category: config.category || null,
          provider_id: config.selectedProviderId || null,
          modelConfig: { temperature: config.temperature },
          toolPermissions: {
            allowed: config.enabledTools || [],
            approval_required: [],
          },
        },
      };
      const { data } = await api.post("/agents", payload);
      router.push(`/office/agents/${data.id}/live`);
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="min-h-screen bg-background-dark grid-bg flex flex-col">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-8 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <span className="icon text-primary">bolt</span>
          <span className="font-black uppercase tracking-wider text-sm">AI Office OS</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/office/agents"
            className="size-8 rounded-lg bg-surface-dark border border-border-dark flex items-center justify-center hover:border-primary/30 transition-colors"
          >
            <span className="icon text-sm">close</span>
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center p-8">
        <div className="w-full max-w-5xl">
          <div className="mb-6">
            <h1 className="text-2xl font-black">Create New Agent</h1>
            <p className="text-text-muted text-sm mt-1">
              Deploy an AI coworker to your workspace
            </p>
          </div>

          <StepBar current={step} />

          {step === 0 && (
            <Step1
              selectedAgent={selectedAgent}
              onSelect={(agent) => {
                setSelectedAgent(agent);
                setIsCustom(false);
              }}
              onCustom={() => {
                setSelectedAgent(null);
                setIsCustom(true);
              }}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <Step2
              selectedAgent={selectedAgent}
              isCustom={isCustom}
              onNext={(values) => {
                setConfig(values);
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && config && (
            <Step3
              config={config}
              onBack={() => setStep(1)}
              onDeploy={handleDeploy}
              deploying={deploying}
            />
          )}
        </div>
      </div>
    </div>
  );
}
