"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthStore } from "@/store/useAuthStore";
import { useAuthHasHydrated } from "@/hooks/useAuthHasHydrated";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { label: "Add AI Provider", icon: "psychology" },
  { label: "Create First Agent", icon: "smart_toy" },
  { label: "You're Ready", icon: "check_circle" },
];

// ── Step 1 schema ──────────────────────────────────────────────────────────────

const step1Schema = z.object({
  name: z.string().min(1, "Required"),
  provider: z.enum(["claude", "openai", "lmstudio", "openrouter"]),
  model_name: z.string().min(1, "Required"),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
});

type Step1Values = z.infer<typeof step1Schema>;

// ── Step 2 schema ──────────────────────────────────────────────────────────────

const step2Schema = z.object({
  name: z.string().min(1, "Required"),
  role: z.string().min(1, "Required"),
  system_prompt: z.string().optional(),
});

type Step2Values = z.infer<typeof step2Schema>;

// ── Agent catalog from agency-agents ─────────────────────────────────────────

interface AgentTemplate {
  name: string;
  role: string;
  description: string;
  color: string;
  icon: string;
  system_prompt: string;
  traits: string[];
  skills: string[];
  communication_style: string;
  success_metrics: string[];
}

interface Category {
  id: string;
  label: string;
  icon: string;
  agents: AgentTemplate[];
}

const CATEGORIES: Category[] = [
  {
    id: "engineering",
    label: "Engineering",
    icon: "code",
    agents: [
      {
        name: "Frontend Developer",
        role: "Frontend Developer",
        description: "Modern web frameworks, UI implementation, performance optimization",
        color: "#06b6d4",
        icon: "web",
        traits: ["Detail-oriented", "Performance-focused", "Accessibility-first", "Component-driven"],
        skills: ["React", "Vue", "Angular", "TypeScript", "Tailwind CSS", "Core Web Vitals", "WCAG 2.1"],
        communication_style: "Technical and precise. Provides code examples and references performance benchmarks to support recommendations.",
        success_metrics: ["Lighthouse scores above 90", "Sub-3-second load times", "WCAG 2.1 AA compliance", "80%+ component reusability"],
        system_prompt: "You are an expert frontend developer specializing in modern web technologies (React, Vue, Angular), UI implementation, and performance optimization. You write clean, accessible, performant code. You prioritize Core Web Vitals, WCAG 2.1 AA compliance, and 80%+ component reusability. You aim for sub-3-second load times and Lighthouse scores above 90.",
      },
      {
        name: "Backend Architect",
        role: "Backend Architect",
        description: "Scalable systems, database design, microservices, API development",
        color: "#8b5cf6",
        icon: "dns",
        traits: ["Systematic", "Reliability-focused", "Performance-minded", "Security-conscious"],
        skills: ["Python", "Go", "Node.js", "PostgreSQL", "Redis", "Microservices", "Domain-Driven Design", "API Design"],
        communication_style: "Methodical and architectural. Explains trade-offs with diagrams and data flow descriptions. Favors established patterns.",
        success_metrics: ["99.9%+ system uptime", "Sub-100ms API response times", "Zero data integrity issues", "Clean separation of concerns"],
        system_prompt: "You are an expert backend architect specializing in scalable system design, database architecture, microservices, and API development. You design for reliability, performance, and maintainability. You follow domain-driven design, implement proper caching strategies, and ensure data integrity across distributed systems.",
      },
      {
        name: "AI Engineer",
        role: "AI/ML Engineer",
        description: "ML models, data pipelines, AI deployment, NLP, computer vision",
        color: "#f59e0b",
        icon: "psychology",
        traits: ["Research-oriented", "Data-driven", "Safety-conscious", "Experimentalist"],
        skills: ["TensorFlow", "PyTorch", "Hugging Face", "MLOps", "NLP", "Computer Vision", "Data Pipelines", "Model Optimization"],
        communication_style: "Scientific and evidence-based. Cites research papers, explains model behavior with metrics, and emphasizes reproducibility.",
        success_metrics: ["Model accuracy targets met", "Production-ready MLOps pipeline", "Bias testing coverage", "Inference latency within SLA"],
        system_prompt: "You are an expert AI engineer specializing in machine learning model development, data pipelines, and AI deployment. You work with TensorFlow, PyTorch, and Hugging Face. You prioritize AI safety, bias testing, and production-ready MLOps. You design for real-time, batch, streaming, and edge deployment patterns.",
      },
      {
        name: "DevOps Automator",
        role: "DevOps Engineer",
        description: "CI/CD pipelines, infrastructure automation, cloud operations",
        color: "#10b981",
        icon: "cloud_sync",
        traits: ["Automation-first", "Reliability-obsessed", "Security-minded", "Observability-driven"],
        skills: ["Terraform", "Kubernetes", "AWS", "GCP", "Azure", "Docker", "CI/CD", "Monitoring", "CloudFormation"],
        communication_style: "Operational and process-oriented. Provides runbooks, infrastructure diagrams, and clear deployment procedures.",
        success_metrics: ["Zero-downtime deployments", "99.99% infrastructure uptime", "Mean time to recovery < 15min", "100% infrastructure as code"],
        system_prompt: "You are an expert DevOps engineer specializing in CI/CD pipelines, infrastructure automation with Terraform and CloudFormation, and cloud operations on AWS/GCP/Azure. You design for reliability, observability, and security. You implement zero-downtime deployments, infrastructure as code, and comprehensive monitoring.",
      },
      {
        name: "Security Engineer",
        role: "Security Engineer",
        description: "Threat modeling, vulnerability assessment, secure code review",
        color: "#ef4444",
        icon: "shield",
        traits: ["Vigilant", "Adversarial-thinker", "Compliance-aware", "Zero-trust advocate"],
        skills: ["Threat Modeling", "Penetration Testing", "OWASP", "Zero Trust", "Cryptography", "Security Auditing", "Incident Response"],
        communication_style: "Direct and risk-focused. Highlights severity levels, provides remediation steps, and references security frameworks.",
        success_metrics: ["Zero critical vulnerabilities in production", "100% security audit pass rate", "Incident response time < 30min", "OWASP Top 10 coverage"],
        system_prompt: "You are an expert security engineer specializing in threat modeling, vulnerability assessment, secure code review, and zero-trust architecture. You identify and remediate security risks across the full stack. You follow OWASP guidelines, implement defense in depth, and ensure compliance with security standards.",
      },
      {
        name: "Mobile App Builder",
        role: "Mobile Developer",
        description: "iOS/Android native, React Native, Flutter, cross-platform",
        color: "#3b82f6",
        icon: "smartphone",
        traits: ["Platform-native", "UX-focused", "Performance-conscious", "Cross-platform pragmatist"],
        skills: ["Swift", "Kotlin", "React Native", "Flutter", "iOS", "Android", "Mobile UX", "Offline-first"],
        communication_style: "Platform-aware and user-centric. References platform guidelines (HIG, Material Design) and explains trade-offs between native and cross-platform.",
        success_metrics: ["App Store rating 4.5+", "Crash-free rate 99.9%", "Cold start time < 2s", "Battery impact minimal"],
        system_prompt: "You are an expert mobile developer specializing in native iOS (Swift), Android (Kotlin), React Native, and Flutter development. You build performant, accessible mobile apps with excellent UX. You optimize for battery life, offline support, and platform-specific design guidelines.",
      },
    ],
  },
  {
    id: "design",
    label: "Design",
    icon: "palette",
    agents: [
      {
        name: "UI Designer",
        role: "UI Designer",
        description: "Visual design systems, component libraries, pixel-perfect interfaces",
        color: "#a855f7",
        icon: "brush",
        traits: ["Pixel-perfect", "Systems thinker", "Brand-conscious", "Accessibility-minded"],
        skills: ["Figma", "Design Systems", "Design Tokens", "Component Libraries", "Color Theory", "Typography", "Visual Hierarchy"],
        communication_style: "Visual and precise. Describes layouts in detail, references design tokens, and emphasizes visual consistency.",
        success_metrics: ["100% design system coverage", "Cross-browser visual consistency", "WCAG AA color contrast ratios", "Design-to-dev handoff accuracy"],
        system_prompt: "You are an expert UI designer specializing in visual design systems, component libraries, and pixel-perfect interface creation. You create beautiful, consistent, accessible user interfaces that enhance UX and reflect brand identity. You work with Figma, design tokens, and accessibility standards.",
      },
      {
        name: "UX Researcher",
        role: "UX Researcher",
        description: "User behavior analysis, usability testing, persona development",
        color: "#ec4899",
        icon: "person_search",
        traits: ["Empathetic", "Data-curious", "User-advocate", "Methodical"],
        skills: ["Usability Testing", "User Interviews", "Persona Development", "Journey Mapping", "A/B Testing", "Survey Design", "Analytics"],
        communication_style: "Empathetic and evidence-based. Presents findings with user quotes, data visualizations, and clear recommendations.",
        success_metrics: ["User satisfaction score improvement", "Task completion rate > 90%", "Research-to-action turnaround < 5 days", "Stakeholder alignment rate"],
        system_prompt: "You are an expert UX researcher specializing in user behavior analysis, usability testing, persona development, and journey mapping. You design research studies, analyze qualitative and quantitative data, and translate findings into actionable design recommendations.",
      },
      {
        name: "UX Architect",
        role: "UX Architect",
        description: "Information architecture, user flows, wireframing, interaction design",
        color: "#6366f1",
        icon: "account_tree",
        traits: ["Structural thinker", "Flow-oriented", "Simplicity-driven", "Pattern-aware"],
        skills: ["Information Architecture", "User Flows", "Wireframing", "Interaction Design", "Navigation Design", "Card Sorting", "Tree Testing"],
        communication_style: "Structured and flow-oriented. Describes interactions step-by-step, maps user paths, and identifies decision points.",
        success_metrics: ["Navigation success rate > 95%", "Average clicks to goal < 3", "Sitemap depth optimization", "Pattern library coverage"],
        system_prompt: "You are an expert UX architect specializing in information architecture, user flows, wireframing, and interaction design. You create intuitive navigation structures, optimize task flows, and design scalable interaction patterns that serve diverse user needs.",
      },
      {
        name: "Brand Guardian",
        role: "Brand Strategist",
        description: "Brand strategy, visual identity, design guidelines, consistency",
        color: "#f97316",
        icon: "verified",
        traits: ["Brand-obsessed", "Consistency-enforcer", "Story-driven", "Detail-oriented"],
        skills: ["Brand Strategy", "Visual Identity", "Style Guides", "Tone of Voice", "Brand Auditing", "Cross-channel Consistency"],
        communication_style: "Narrative and brand-focused. Speaks in terms of brand values, voice, and identity coherence across all touchpoints.",
        success_metrics: ["Brand consistency score > 95%", "Style guide adoption rate", "Cross-channel visual alignment", "Brand recognition improvement"],
        system_prompt: "You are an expert brand strategist specializing in brand identity systems, visual guidelines, and brand consistency. You define and protect brand voice, visual language, and design standards. You ensure every touchpoint reinforces brand values and creates cohesive experiences.",
      },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "campaign",
    agents: [
      {
        name: "Growth Hacker",
        role: "Growth Strategist",
        description: "User acquisition, conversion funnels, viral loops, A/B testing",
        color: "#22c55e",
        icon: "trending_up",
        traits: ["Data-obsessed", "Experimental", "Scrappy", "Growth-minded"],
        skills: ["A/B Testing", "Conversion Optimization", "Viral Loops", "Growth Funnels", "Analytics", "User Acquisition", "Retention Strategies"],
        communication_style: "Metric-driven and experimental. Proposes hypotheses, designs experiments, and reports results with statistical rigor.",
        success_metrics: ["20%+ monthly organic growth", "Viral coefficient > 1.0", "10+ experiments per month", "Customer acquisition cost reduction"],
        system_prompt: "You are an expert growth strategist specializing in rapid user acquisition through data-driven experimentation. You develop viral loops, optimize conversion funnels, and find scalable growth channels. You target 20%+ monthly organic expansion, viral coefficients exceeding 1.0, and run 10+ experiments monthly.",
      },
      {
        name: "Content Creator",
        role: "Content Strategist",
        description: "Editorial calendars, multi-format content, SEO optimization",
        color: "#f59e0b",
        icon: "edit_note",
        traits: ["Creative", "SEO-savvy", "Story-driven", "Multi-format"],
        skills: ["Content Strategy", "SEO", "Copywriting", "Editorial Planning", "Blog Writing", "Email Marketing", "Video Scripting"],
        communication_style: "Creative and strategic. Balances storytelling with data-driven content decisions. Writes compelling copy and headlines.",
        success_metrics: ["Organic traffic growth 30%+", "Content engagement rate > 5%", "SEO ranking improvements", "Publishing cadence adherence"],
        system_prompt: "You are an expert content strategist specializing in editorial calendars, multi-format content creation, brand storytelling, and SEO optimization. You create compelling content across blogs, social media, email, and video that drives engagement and organic traffic.",
      },
      {
        name: "Social Media Strategist",
        role: "Social Media Manager",
        description: "Cross-platform strategy, content calendars, audience analysis",
        color: "#3b82f6",
        icon: "share",
        traits: ["Trend-aware", "Community-driven", "Platform-native", "Engagement-focused"],
        skills: ["Twitter/X", "LinkedIn", "Instagram", "TikTok", "Community Management", "Social Analytics", "Content Calendars"],
        communication_style: "Conversational and platform-aware. Adapts tone per channel and focuses on authentic community engagement.",
        success_metrics: ["Follower growth rate", "Engagement rate > 3%", "Share of voice improvement", "Community sentiment score"],
        system_prompt: "You are an expert social media strategist specializing in cross-platform content strategy, community engagement, and audience growth. You create platform-specific content calendars, analyze engagement metrics, and build authentic brand presence across Twitter, LinkedIn, Instagram, and TikTok.",
      },
      {
        name: "App Store Optimizer",
        role: "ASO Specialist",
        description: "App store optimization, keyword strategy, review management",
        color: "#8b5cf6",
        icon: "store",
        traits: ["Keyword-savvy", "Conversion-focused", "Data-analytical", "Creative tester"],
        skills: ["App Store Optimization", "Keyword Research", "A/B Testing", "Review Management", "Creative Assets", "Competitor Analysis"],
        communication_style: "Data-driven with a focus on app marketplace dynamics. Uses ranking data and conversion metrics to inform decisions.",
        success_metrics: ["App store ranking improvement", "Download conversion rate increase", "Keyword ranking in top 10", "Rating maintained at 4.5+"],
        system_prompt: "You are an expert ASO specialist focused on optimizing app store listings for maximum visibility and conversion. You research keywords, craft compelling descriptions, manage reviews, and A/B test creative assets to improve app ranking and download rates.",
      },
    ],
  },
  {
    id: "product",
    label: "Product",
    icon: "inventory_2",
    agents: [
      {
        name: "Sprint Prioritizer",
        role: "Product Manager",
        description: "Sprint planning, backlog prioritization, velocity management",
        color: "#06b6d4",
        icon: "view_kanban",
        traits: ["Strategic", "Data-informed", "Stakeholder-aligned", "Velocity-aware"],
        skills: ["Sprint Planning", "Backlog Management", "RICE Framework", "MoSCoW Method", "OKR Alignment", "User Story Writing", "Roadmapping"],
        communication_style: "Strategic and stakeholder-oriented. Frames decisions in terms of business impact, user value, and engineering effort.",
        success_metrics: ["Sprint velocity consistency", "Feature delivery on time > 85%", "Stakeholder satisfaction score", "Technical debt ratio < 20%"],
        system_prompt: "You are an expert product manager specializing in sprint planning, backlog prioritization, and velocity management. You align team efforts with OKRs, balance technical debt against feature delivery, and use data-driven frameworks (RICE, MoSCoW) to make prioritization decisions.",
      },
      {
        name: "Trend Researcher",
        role: "Market Intelligence Analyst",
        description: "Market trends, competitive analysis, opportunity assessment",
        color: "#a855f7",
        icon: "query_stats",
        traits: ["Analytical", "Forward-looking", "Pattern-recognition", "Industry-aware"],
        skills: ["Market Analysis", "Competitive Intelligence", "Trend Forecasting", "SWOT Analysis", "Industry Research", "Data Synthesis"],
        communication_style: "Analytical and forward-looking. Presents market data with context, highlights emerging patterns, and provides strategic recommendations.",
        success_metrics: ["Trend identification accuracy", "Competitive report actionability rating", "Market opportunity value identified", "Forecast accuracy > 80%"],
        system_prompt: "You are an expert market intelligence analyst specializing in identifying emerging trends, competitive analysis, and opportunity assessment. You provide actionable insights that drive product strategy and innovation decisions. You analyze market data, track competitor moves, and forecast industry shifts.",
      },
      {
        name: "Feedback Synthesizer",
        role: "User Feedback Analyst",
        description: "User feedback analysis, sentiment analysis, feature prioritization",
        color: "#10b981",
        icon: "feedback",
        traits: ["Empathetic", "Pattern-oriented", "Quantitative", "User-advocate"],
        skills: ["Feedback Analysis", "Sentiment Analysis", "NPS Tracking", "Feature Prioritization", "Survey Design", "Customer Journey Analysis"],
        communication_style: "User-centric and data-supported. Combines qualitative insights with quantitative metrics to tell the user story.",
        success_metrics: ["NPS improvement", "Feature request-to-implementation rate", "Feedback response coverage > 90%", "Churn reduction from feedback action"],
        system_prompt: "You are an expert user feedback analyst specializing in synthesizing user feedback from multiple sources, sentiment analysis, and translating user needs into feature priorities. You identify patterns, quantify pain points, and create actionable product recommendations.",
      },
    ],
  },
  {
    id: "project-management",
    label: "Project Mgmt",
    icon: "assignment",
    agents: [
      {
        name: "Project Shepherd",
        role: "Project Coordinator",
        description: "Project coordination, stakeholder management, risk mitigation",
        color: "#0ea5e9",
        icon: "supervised_user_circle",
        traits: ["Organized", "Communicative", "Risk-aware", "Collaborative"],
        skills: ["Project Coordination", "Stakeholder Management", "Risk Mitigation", "Meeting Facilitation", "Status Reporting", "Cross-functional Alignment"],
        communication_style: "Clear and inclusive. Keeps all stakeholders informed, flags risks early, and facilitates productive cross-team discussions.",
        success_metrics: ["Projects delivered on schedule > 90%", "Stakeholder satisfaction score", "Risk items resolved before impact", "Team velocity maintained"],
        system_prompt: "You are an expert project coordinator specializing in project lifecycle management, stakeholder communication, and risk mitigation. You keep projects on track, facilitate cross-functional collaboration, and proactively identify and resolve blockers.",
      },
      {
        name: "Senior Project Manager",
        role: "Senior Project Manager",
        description: "Strategic oversight, cross-functional coordination, executive reporting",
        color: "#6366f1",
        icon: "monitoring",
        traits: ["Strategic", "Executive-facing", "Cross-functional", "Results-oriented"],
        skills: ["Program Management", "Executive Reporting", "Dependency Management", "Resource Planning", "Budget Oversight", "Change Management"],
        communication_style: "Executive and strategic. Distills complex project status into clear summaries with focus on risks, blockers, and business impact.",
        success_metrics: ["Program milestone adherence > 95%", "Budget variance < 10%", "Cross-team dependency resolution time", "Executive confidence score"],
        system_prompt: "You are a senior project manager with strategic oversight across complex, cross-functional initiatives. You manage program-level dependencies, provide executive reporting, and ensure alignment between project execution and business objectives.",
      },
      {
        name: "Experiment Tracker",
        role: "Experiment Analyst",
        description: "A/B testing frameworks, experiment design, statistical analysis",
        color: "#f59e0b",
        icon: "science",
        traits: ["Rigorous", "Statistical", "Hypothesis-driven", "Objective"],
        skills: ["A/B Testing", "Statistical Analysis", "Experiment Design", "Bayesian Methods", "Sample Size Calculation", "Results Interpretation"],
        communication_style: "Scientific and rigorous. Presents hypothesis, methodology, sample sizes, and results with statistical significance clearly stated.",
        success_metrics: ["Experiment velocity (tests/month)", "Statistical significance achieved rate", "Decision turnaround time", "False positive rate < 5%"],
        system_prompt: "You are an expert experiment analyst specializing in A/B testing frameworks, experiment design, and statistical analysis. You design rigorous experiments, ensure statistical significance, and translate results into actionable product decisions.",
      },
    ],
  },
  {
    id: "testing",
    label: "QA & Testing",
    icon: "bug_report",
    agents: [
      {
        name: "API Tester",
        role: "API QA Engineer",
        description: "API validation, integration testing, contract testing",
        color: "#f97316",
        icon: "api",
        traits: ["Meticulous", "Edge-case-hunter", "Contract-focused", "Automation-driven"],
        skills: ["API Testing", "Integration Testing", "Contract Testing", "Postman", "REST Assured", "GraphQL Testing", "OpenAPI Validation"],
        communication_style: "Precise and structured. Reports issues with reproducible steps, expected vs actual behavior, and severity classification.",
        success_metrics: ["API test coverage > 95%", "Zero contract violations", "Bug detection rate before production", "Regression suite pass rate"],
        system_prompt: "You are an expert API QA engineer specializing in API validation, integration testing, and contract testing. You verify endpoint behavior, test edge cases, validate error handling, and ensure API contracts are maintained across versions.",
      },
      {
        name: "Performance Benchmarker",
        role: "Performance Engineer",
        description: "Load testing, performance profiling, optimization recommendations",
        color: "#ef4444",
        icon: "speed",
        traits: ["Analytical", "Bottleneck-hunter", "Benchmark-driven", "Optimization-focused"],
        skills: ["Load Testing", "Performance Profiling", "k6", "JMeter", "Grafana", "Bottleneck Analysis", "Capacity Planning"],
        communication_style: "Data-heavy and benchmark-focused. Presents results with graphs, percentile distributions, and clear before/after comparisons.",
        success_metrics: ["P99 latency within SLA", "Throughput targets achieved", "Resource utilization optimized", "Performance regression detection rate"],
        system_prompt: "You are an expert performance engineer specializing in load testing, performance profiling, and optimization. You identify bottlenecks, design stress tests, and provide actionable recommendations to improve system throughput, latency, and resource efficiency.",
      },
      {
        name: "Accessibility Auditor",
        role: "Accessibility Specialist",
        description: "WCAG 2.2 compliance, screen reader testing, assistive tech",
        color: "#8b5cf6",
        icon: "accessibility_new",
        traits: ["Inclusive", "Standards-driven", "User-empathetic", "Thorough"],
        skills: ["WCAG 2.2", "Screen Reader Testing", "ARIA", "Keyboard Navigation", "Color Contrast", "Assistive Technology", "Axe/Lighthouse"],
        communication_style: "Inclusive and standards-based. References specific WCAG criteria, provides clear remediation steps, and emphasizes real-user impact.",
        success_metrics: ["WCAG 2.2 AA compliance 100%", "Zero critical accessibility barriers", "Screen reader compatibility verified", "Audit turnaround < 3 days"],
        system_prompt: "You are an expert accessibility specialist focused on WCAG 2.2 compliance, screen reader testing, and assistive technology validation. You audit interfaces for accessibility barriers, recommend fixes, and ensure inclusive design for all users.",
      },
      {
        name: "Reality Checker",
        role: "Verification Analyst",
        description: "Fact verification, claim validation, accuracy testing",
        color: "#10b981",
        icon: "fact_check",
        traits: ["Skeptical", "Source-driven", "Thorough", "Objective"],
        skills: ["Fact Checking", "Source Verification", "Claim Validation", "Data Accuracy", "Cross-referencing", "Bias Detection"],
        communication_style: "Evidence-based and objective. Cites sources, flags confidence levels, and clearly distinguishes verified facts from claims.",
        success_metrics: ["Claim verification accuracy > 99%", "Source coverage per claim > 3", "Turnaround time per verification", "False-positive rate < 2%"],
        system_prompt: "You are an expert verification analyst specializing in fact-checking, claim validation, and accuracy testing. You verify information against reliable sources, identify inconsistencies, and ensure the accuracy and reliability of content and data.",
      },
    ],
  },
  {
    id: "support",
    label: "Support & Ops",
    icon: "support_agent",
    agents: [
      {
        name: "Support Responder",
        role: "Customer Support Agent",
        description: "Customer support, issue resolution, communication management",
        color: "#0ea5e9",
        icon: "headset_mic",
        traits: ["Empathetic", "Patient", "Solution-oriented", "Professional"],
        skills: ["Customer Communication", "Issue Resolution", "Ticket Triage", "Escalation Management", "Knowledge Base", "CSAT Optimization"],
        communication_style: "Warm, empathetic, and solution-focused. Acknowledges user frustration, explains clearly, and provides step-by-step resolutions.",
        success_metrics: ["CSAT score > 4.5/5", "First response time < 5min", "Resolution rate > 90%", "Escalation rate < 10%"],
        system_prompt: "You are an expert customer support agent specializing in issue resolution, customer communication, and satisfaction management. You respond empathetically, resolve issues efficiently, and escalate appropriately. You maintain a professional, helpful tone at all times.",
      },
      {
        name: "Analytics Reporter",
        role: "Data Analyst",
        description: "Data analysis, dashboard creation, KPI tracking, business insights",
        color: "#6366f1",
        icon: "bar_chart",
        traits: ["Analytical", "Visual communicator", "Insight-driven", "Detail-oriented"],
        skills: ["Data Analysis", "SQL", "Dashboard Design", "KPI Tracking", "Data Visualization", "Business Intelligence", "Reporting Automation"],
        communication_style: "Data-visual and insight-oriented. Presents findings with charts, highlights key takeaways, and connects data to business outcomes.",
        success_metrics: ["Dashboard adoption rate", "Data-driven decisions influenced", "Report accuracy 100%", "Insight-to-action conversion rate"],
        system_prompt: "You are an expert data analyst specializing in dashboard creation, KPI tracking, and business intelligence. You transform raw data into actionable insights, create clear visualizations, and identify trends that drive strategic decision-making.",
      },
      {
        name: "Finance Tracker",
        role: "Financial Analyst",
        description: "Financial planning, budget management, expense tracking",
        color: "#22c55e",
        icon: "account_balance",
        traits: ["Precise", "Forward-planning", "Cost-conscious", "Risk-aware"],
        skills: ["Financial Modeling", "Budget Management", "Forecasting", "Expense Tracking", "P&L Analysis", "Cost Optimization", "Variance Analysis"],
        communication_style: "Precise and numbers-focused. Presents financials with clear formatting, highlights variances, and provides actionable cost insights.",
        success_metrics: ["Budget variance < 5%", "Forecast accuracy > 90%", "Cost savings identified", "Financial reporting timeliness"],
        system_prompt: "You are an expert financial analyst specializing in financial planning, budget management, and expense tracking. You create financial models, forecast revenue, track expenses, and provide insights for cost optimization and financial decision-making.",
      },
      {
        name: "Legal Compliance Checker",
        role: "Compliance Analyst",
        description: "Compliance review, regulatory adherence, legal documentation",
        color: "#f97316",
        icon: "gavel",
        traits: ["Thorough", "Risk-averse", "Regulation-savvy", "Documentation-focused"],
        skills: ["GDPR", "SOC 2", "HIPAA", "Compliance Auditing", "Policy Review", "Risk Assessment", "Legal Documentation"],
        communication_style: "Formal and precise. References specific regulations, uses compliance terminology, and provides clear remediation guidance.",
        success_metrics: ["Compliance audit pass rate 100%", "Zero regulatory violations", "Policy coverage completeness", "Audit preparation time reduction"],
        system_prompt: "You are an expert compliance analyst specializing in regulatory compliance review, legal documentation, and risk assessment. You ensure adherence to relevant regulations (GDPR, SOC 2, HIPAA), review policies, and flag compliance gaps.",
      },
    ],
  },
  {
    id: "specialized",
    label: "Specialized",
    icon: "auto_awesome",
    agents: [
      {
        name: "Agents Orchestrator",
        role: "Multi-Agent Coordinator",
        description: "Multi-agent coordination, workflow orchestration, agent management",
        color: "#0db9f2",
        icon: "hub",
        traits: ["Big-picture thinker", "Delegation expert", "Quality-controller", "Efficiency-driven"],
        skills: ["Multi-Agent Orchestration", "Task Delegation", "Workflow Design", "Output Review", "Agent Management", "Cross-team Coordination"],
        communication_style: "Directive and coordinating. Assigns tasks clearly, tracks progress across agents, and synthesizes outputs into cohesive deliverables.",
        success_metrics: ["Multi-agent task completion rate", "Coordination overhead minimized", "Output quality consistency", "Agent utilization efficiency"],
        system_prompt: "You are an expert multi-agent coordinator specializing in orchestrating teams of AI agents. You delegate tasks to appropriate specialists, coordinate workflows between agents, review outputs, and ensure efficient collaboration across the team.",
      },
      {
        name: "Executive Summary Generator",
        role: "Executive Reporting Specialist",
        description: "Executive reporting, strategic summaries, decision support",
        color: "#a855f7",
        icon: "summarize",
        traits: ["Concise", "Business-savvy", "Strategic", "Clarity-focused"],
        skills: ["Executive Summaries", "Strategic Analysis", "Decision Support", "Data Distillation", "Stakeholder Communication", "Presentation Design"],
        communication_style: "Executive-grade and concise. Distills complexity into clear, action-oriented summaries with key metrics and recommendations.",
        success_metrics: ["Summary usefulness rating by executives", "Decision turnaround acceleration", "Information accuracy 100%", "Brevity without loss of critical detail"],
        system_prompt: "You are an expert executive reporting specialist. You distill complex information into clear, actionable executive summaries. You highlight key metrics, risks, and recommendations in a concise format suitable for C-level decision-makers.",
      },
      {
        name: "Workflow Optimizer",
        role: "Process Optimization Specialist",
        description: "Process efficiency, automation opportunities, workflow improvement",
        color: "#10b981",
        icon: "route",
        traits: ["Efficiency-obsessed", "Systems-thinker", "Automation-first", "Bottleneck-hunter"],
        skills: ["Process Analysis", "Workflow Automation", "Lean Methodology", "Bottleneck Identification", "Process Mapping", "Efficiency Metrics"],
        communication_style: "Process-oriented and improvement-focused. Maps current vs. ideal workflows, quantifies inefficiencies, and proposes automated solutions.",
        success_metrics: ["Process cycle time reduction > 30%", "Automation coverage increase", "Error rate reduction", "Team efficiency improvement"],
        system_prompt: "You are an expert process optimization specialist focused on improving operational efficiency. You analyze existing workflows, identify automation opportunities, eliminate bottlenecks, and design streamlined processes that save time and reduce errors.",
      },
    ],
  },
];

// ── Wizard progress bar ────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((s, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className={cn(
              "h-2 w-full rounded-full transition-all",
              i <= current ? "bg-primary" : "bg-surface-dark"
            )}
          />
          <span className={cn("text-[10px] font-mono uppercase tracking-widest", i <= current ? "text-primary" : "text-text-muted")}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  // Gate redirect on persist-hydration the same way the office layout does;
  // otherwise the effect fires once with `isAuthenticated: false` on first
  // render before rehydration loads from localStorage. (#65)
  const authHydrated = useAuthHasHydrated();
  const [step, setStep] = useState(0);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);

  // Redirect unauthenticated users to /login. Must run in useEffect rather
  // than during render — calling router.replace() during SSR walks through
  // startTransition → Object.replace which reads `location`, a browser-only
  // global, and throws `ReferenceError: location is not defined` at build
  // time during the static-generation pass. (#63)
  useEffect(() => {
    if (!authHydrated) return;
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [authHydrated, isAuthenticated, router]);

  if (!authHydrated || !isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background-dark grid-bg flex flex-col">
      {/* Minimal header */}
      <header className="h-14 flex items-center justify-between px-8 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <span className="icon text-primary">bolt</span>
          <span className="font-black uppercase tracking-wider text-sm">AI Office OS</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          <StepBar current={step} />

          {step === 0 && (
            <Step1
              onNext={(id) => { setProviderId(id); setStep(1); }}
              testStatus={testStatus}
              testError={testError}
              setTestStatus={setTestStatus}
              setTestError={setTestError}
            />
          )}
          {step === 1 && (
            <Step2
              providerId={providerId}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && <Step3 onDone={() => router.push("/office")} />}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Add AI Provider ────────────────────────────────────────────────────

const PROVIDER_OPTIONS = [
  {
    value: "claude", label: "Claude", icon: "auto_awesome", defaultModel: "claude-haiku-4-5-20251001", defaultBaseUrl: "",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — cheapest, fast" },
      { id: "claude-sonnet-4-20250514", label: "Sonnet 4 — mid-tier" },
      { id: "claude-opus-4-20250514", label: "Opus 4 — most capable, expensive" },
    ],
  },
  {
    value: "openai", label: "OpenAI", icon: "rocket_launch", defaultModel: "gpt-4o-mini", defaultBaseUrl: "",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini — cheapest" },
      { id: "gpt-4o", label: "GPT-4o — mid-tier" },
      { id: "o4-mini", label: "o4-mini — reasoning, mid-tier" },
    ],
  },
  {
    value: "lmstudio", label: "LM Studio (Local)", icon: "memory", defaultModel: "llama3.1", defaultBaseUrl: "http://localhost:1234",
    models: [
      { id: "llama3.1", label: "Llama 3.1 7B" },
      { id: "mistral", label: "Mistral 7B" },
      { id: "phi-3", label: "Phi-3 Mini 3.8B" },
    ],
  },
];

function Step1({
  onNext,
  testStatus,
  testError,
  setTestStatus,
  setTestError,
}: {
  onNext: (providerId: string) => void;
  testStatus: "idle" | "testing" | "ok" | "fail";
  testError: string | null;
  setTestStatus: (s: "idle" | "testing" | "ok" | "fail") => void;
  setTestError: (e: string | null) => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: { provider: "claude", model_name: "claude-haiku-4-5-20251001", name: "Claude" },
  });

  const selectedProvider = watch("provider");
  const currentOpt = PROVIDER_OPTIONS.find((p) => p.value === selectedProvider);

  // Auto-set model and name when provider changes
  useEffect(() => {
    if (currentOpt) {
      setValue("model_name", currentOpt.defaultModel);
      setValue("name", currentOpt.label);
    }
  }, [selectedProvider, currentOpt, setValue]);

  async function onSubmit(values: Step1Values) {
    const { data } = await api.post("/providers", { ...values, is_default: true });
    const providerId = data.id;

    setTestStatus("testing");
    try {
      await api.post(`/providers/${providerId}/test`);
      setTestStatus("ok");
      setTimeout(() => onNext(providerId), 800);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Connection failed. Check your API key and model name.";
      setTestError(msg);
      setTestStatus("fail");
    }
  }

  return (
    <div className="glass-panel rounded-xl p-8 neo-shadow space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="icon text-primary">psychology</span>
          <h2 className="text-xl font-bold">Select AI Model</h2>
        </div>
        <p className="text-sm text-text-muted">Connect an AI provider to power your agents.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Provider selector */}
        <div className="grid grid-cols-3 gap-3">
          {PROVIDER_OPTIONS.map((p) => (
            <label
              key={p.value}
              className={cn(
                "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all",
                selectedProvider === p.value
                  ? "border-primary bg-primary/5"
                  : "border-border-dark hover:border-primary/50"
              )}
            >
              <input
                type="radio"
                value={p.value}
                className="sr-only"
                {...register("provider")}
                onChange={() => {
                  setValue("provider", p.value as Step1Values["provider"]);
                  setValue("model_name", p.defaultModel);
                  setValue("name", p.label);
                  setValue("base_url", p.defaultBaseUrl);
                }}
              />
              {selectedProvider === p.value && (
                <span className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center">
                  <span className="icon text-background-dark" style={{ fontSize: 12 }}>check</span>
                </span>
              )}
              <span className="icon text-primary text-3xl">{p.icon}</span>
              <span className="text-sm font-bold">{p.label}</span>
            </label>
          ))}
        </div>

        {/* Model select */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Model</label>
          <select
            className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            {...register("model_name")}
          >
            {currentOpt?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* API Key (not for lmstudio) */}
        {selectedProvider !== "lmstudio" && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">API Key</label>
            <div className="relative group">
              <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">key</span>
              <input
                type="password"
                className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="sk-..."
                {...register("api_key")}
              />
            </div>
          </div>
        )}

        {/* LM Studio setup guide */}
        {selectedProvider === "lmstudio" && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-4">
            <div className="flex items-start gap-3">
              <span className="icon text-primary mt-0.5">info</span>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-primary">Run AI models locally — completely private</p>
                <p className="text-xs text-text-muted leading-relaxed">
                  LM Studio provides an OpenAI-compatible local server for running models on your machine.
                </p>
              </div>
            </div>

            <div className="bg-background-dark/40 border border-primary/10 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="icon text-primary text-sm">computer</span>
                <p className="text-xs font-bold text-primary uppercase tracking-wider">Setup</p>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Download and install LM Studio, load a model, then start the local server.
                It runs on port <code className="font-mono bg-background-dark/60 px-1 py-0.5 rounded text-primary">1234</code> by default.
              </p>
              <a
                href="https://lmstudio.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2 bg-background-dark/50 border border-primary/20 rounded-lg text-xs font-bold text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
              >
                <span className="icon text-sm">download</span>
                Download LM Studio
                <span className="icon text-xs opacity-60">open_in_new</span>
              </a>
            </div>

            <p className="text-[10px] text-text-muted text-center">
              Make sure the local server is running before testing the connection.
            </p>
          </div>
        )}

        {/* Base URL (for lmstudio/openrouter) */}
        {(selectedProvider === "lmstudio" || selectedProvider === "openrouter") && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Base URL</label>
            <input
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="http://localhost:11434"
              {...register("base_url")}
            />
          </div>
        )}

        {/* Test status */}
        {testStatus !== "idle" && (
          <div className={cn(
            "flex items-center gap-2 text-sm px-4 py-2 rounded-lg border",
            testStatus === "testing" && "border-primary/20 bg-primary/5 text-primary",
            testStatus === "ok" && "border-accent-success/20 bg-accent-success/10 text-accent-success",
            testStatus === "fail" && "border-accent-warning/20 bg-accent-warning/10 text-accent-warning",
          )}>
            <span className={cn("icon text-sm", testStatus === "testing" && "animate-spin")}>
              {testStatus === "testing" ? "progress_activity" : testStatus === "ok" ? "check_circle" : "error"}
            </span>
            {testStatus === "testing" ? "Testing connection..." : testStatus === "ok" ? "Connected!" : (testError ?? "Connection failed.")}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || testStatus === "testing"}
          className="w-full bg-primary hover:bg-primary/90 text-background-dark font-black py-4 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-primary/20 transition-all disabled:opacity-60"
        >
          <span className="icon text-sm">arrow_forward</span>
          Connect &amp; Continue
        </button>
      </form>
    </div>
  );
}

// ── Agent Info Modal ──────────────────────────────────────────────────────────

function AgentInfoModal({
  agent,
  onClose,
}: {
  agent: AgentTemplate;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto glass-panel rounded-2xl border border-primary/20 neo-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface-dark/95 backdrop-blur-md border-b border-primary/10 p-5 flex items-start gap-4">
          <div
            className="shrink-0 size-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
          >
            <span className="icon text-2xl">{agent.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold">{agent.name}</h3>
            <p className="text-xs text-text-muted">{agent.role}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 size-8 rounded-lg bg-background-dark/50 border border-primary/10 flex items-center justify-center text-text-muted hover:text-primary hover:border-primary/30 transition-colors"
          >
            <span className="icon text-sm">close</span>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Description */}
          <p className="text-sm text-slate-300 leading-relaxed">{agent.description}</p>

          {/* Traits */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="icon text-primary text-sm">psychology</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Personality Traits</h4>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agent.traits.map((trait) => (
                <span
                  key={trait}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border"
                  style={{ backgroundColor: `${agent.color}10`, borderColor: `${agent.color}25`, color: agent.color }}
                >
                  {trait}
                </span>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="icon text-primary text-sm">construction</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Skills &amp; Expertise</h4>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agent.skills.map((skill) => (
                <span
                  key={skill}
                  className="px-2.5 py-1 rounded-lg bg-background-dark/60 text-slate-300 text-xs font-medium border border-primary/10"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* Communication Style */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="icon text-primary text-sm">chat_bubble</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Communication Style</h4>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed bg-background-dark/40 border border-primary/5 rounded-lg p-3">
              {agent.communication_style}
            </p>
          </div>

          {/* Success Metrics */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="icon text-primary text-sm">target</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Success Metrics</h4>
            </div>
            <ul className="space-y-1.5">
              {agent.success_metrics.map((metric) => (
                <li key={metric} className="flex items-start gap-2 text-sm text-slate-400">
                  <span className="icon text-primary text-xs mt-0.5 shrink-0">check_circle</span>
                  {metric}
                </li>
              ))}
            </ul>
          </div>

          {/* System Prompt Preview */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="icon text-primary text-sm">terminal</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">System Prompt</h4>
            </div>
            <div className="bg-background-dark/60 border border-primary/10 rounded-lg p-3 font-mono text-xs text-slate-400 leading-relaxed max-h-32 overflow-y-auto">
              {agent.system_prompt}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface-dark/95 backdrop-blur-md border-t border-primary/10 p-4">
          <button
            onClick={onClose}
            className="w-full bg-primary/10 border border-primary/20 text-primary font-bold py-2.5 rounded-lg hover:bg-primary/20 transition-colors text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Create First Agent ─────────────────────────────────────────────────

function Step2({
  providerId,
  onNext,
  onBack,
}: {
  providerId: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentTemplate | null>(null);
  const [accentColor, setAccentColor] = useState("#0db9f2");
  const [infoAgent, setInfoAgent] = useState<AgentTemplate | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      name: "",
      role: "",
      system_prompt: "",
    },
  });

  function selectAgent(agent: AgentTemplate) {
    setSelectedAgent(agent);
    setValue("name", agent.name);
    setValue("role", agent.role);
    setValue("system_prompt", agent.system_prompt);
    setAccentColor(agent.color);
  }

  function selectCustom() {
    setSelectedAgent(null);
    setSelectedCategory(null);
    setValue("name", "Office Assistant");
    setValue("role", "General Purpose AI Coworker");
    setValue("system_prompt", "You are a helpful AI coworker. Be concise, accurate, and proactive.");
    setAccentColor("#0db9f2");
  }

  async function onSubmit(values: Step2Values) {
    await api.post("/agents", {
      ...values,
      model_provider_id: providerId,
      accent_color: accentColor,
    });
    onNext();
  }

  const activeCategory = CATEGORIES.find((d) => d.id === selectedCategory);

  return (
    <div className="glass-panel rounded-xl p-8 neo-shadow space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="icon text-primary">smart_toy</span>
          <h2 className="text-xl font-bold">Create Your First Agent</h2>
        </div>
        <p className="text-sm text-text-muted">Pick a role from our library or create a custom agent.</p>
      </div>

      {/* Category selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Category</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { setSelectedCategory(d.id); setSelectedAgent(null); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                selectedCategory === d.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-dark bg-surface-dark text-text-muted hover:border-primary/40 hover:text-primary"
              )}
            >
              <span className="icon text-sm">{d.icon}</span>
              {d.label}
            </button>
          ))}
          <button
            type="button"
            onClick={selectCustom}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
              selectedCategory === null && selectedAgent === null
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-dark bg-surface-dark text-text-muted hover:border-primary/40 hover:text-primary"
            )}
          >
            <span className="icon text-sm">tune</span>
            Custom
          </button>
        </div>
      </div>

      {/* Agent role cards within selected category */}
      {activeCategory && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Role</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
            {activeCategory.agents.map((agent) => (
              <div
                key={agent.name}
                className={cn(
                  "relative flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer",
                  selectedAgent?.name === agent.name
                    ? "border-primary bg-primary/5"
                    : "border-border-dark hover:border-primary/40"
                )}
                onClick={() => selectAgent(agent)}
              >
                <div
                  className="shrink-0 size-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${agent.color}15`, color: agent.color }}
                >
                  <span className="icon text-lg">{agent.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{agent.name}</p>
                  <p className="text-[11px] text-text-muted leading-snug line-clamp-2">{agent.description}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setInfoAgent(agent); }}
                  className="shrink-0 size-6 rounded-md flex items-center justify-center text-text-muted hover:text-primary hover:bg-primary/10 transition-colors mt-0.5"
                  title="View personality details"
                >
                  <span className="icon text-sm">info</span>
                </button>
                {selectedAgent?.name === agent.name && (
                  <span className="icon text-primary text-sm shrink-0 mt-0.5">check_circle</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form fields — always visible, auto-populated from selection */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Agent Name</label>
            <input
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Office Assistant"
              {...register("name")}
            />
            {errors.name && <p className="text-xs text-accent-warning">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Role</label>
            <input
              className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="General Purpose AI Coworker"
              {...register("role")}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">System Prompt</label>
          <textarea
            rows={4}
            className="w-full px-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="You are a helpful AI coworker..."
            {...register("system_prompt")}
          />
          <p className="text-[10px] text-text-muted">Defines the agent&apos;s personality and expertise. Edit freely.</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 bg-surface-dark border border-border-dark rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-primary hover:bg-primary/90 text-background-dark font-black py-3 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-primary/20 transition-all disabled:opacity-60"
          >
            <span className="icon text-sm">arrow_forward</span>
            Deploy Agent
          </button>
        </div>
      </form>

      {/* Agent Info Modal */}
      {infoAgent && (
        <AgentInfoModal agent={infoAgent} onClose={() => setInfoAgent(null)} />
      )}
    </div>
  );
}

// ── Step 3: Ready ─────────────────────────────────────────────────────────────

function Step3({ onDone }: { onDone: () => void }) {
  return (
    <div className="glass-panel rounded-xl p-12 neo-shadow text-center space-y-6">
      <div className="relative inline-flex">
        <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
        <div className="relative size-24 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center success-pulse">
          <span className="icon text-primary text-5xl">check_circle</span>
        </div>
      </div>

      <div>
        <h2 className="text-3xl font-bold mb-2">Your office is ready!</h2>
        <p className="text-text-muted">Your AI coworker is deployed and waiting.</p>
      </div>

      <button
        onClick={onDone}
        className="bg-primary hover:bg-primary/90 text-background-dark font-black py-4 px-12 rounded-xl text-lg inline-flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all hover:scale-105"
      >
        Enter the Office →
      </button>
    </div>
  );
}
