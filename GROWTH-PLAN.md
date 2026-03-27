# Urule Growth Plan

A step-by-step strategy to make Urule the go-to open-source control plane for AI coworkers.

---

## What We Have Today

### Technical Foundation (Complete)
- 18 packages across 8 GitHub repos (urule-os org)
- 308+ tests (unit + E2E Playwright)
- Full security stack (JWT auth, Zod validation, CORS, rate limiting, audit logging)
- Office UI with light/dark mode, mobile support, skeleton loaders, accessibility
- OpenAPI docs on all 11 services (/docs)
- Docker Compose for full-stack development

### Documentation (Complete)
- README with badges, comparison table, quick start
- GETTING-STARTED.md (zero-to-hero guide)
- CLAUDE.md + .cursorrules + copilot-instructions.md (AI-friendly)
- ARCHITECTURE.md (design decisions + ADRs)
- ROADMAP.md (~140 improvement items)
- USER-JOURNEYS.md (12 UX journeys + Playwright tests)
- AI-JOURNEYS.md (14 AI agent journeys)
- SKILLS.md (machine-readable capability reference)
- 3 examples (hello-agent, custom-widget, mcp-tool)
- CHANGELOG.md, CODE_OF_CONDUCT.md, SECURITY.md

### Infrastructure (Complete)
- GitHub Actions CI + E2E workflows
- Issue templates, PR template
- GitHub Sponsors (FUNDING.yml)
- GitHub topics on all repos
- 18 npm keywords for search

---

## Strategy: Three Pillars

```
FIND IT          -->    TRY IT          -->    STAY & CONTRIBUTE
(Discovery)            (First Experience)       (Community)
```

---

## Phase 1: Launch (Week 1)

### 1.1 Enable GitHub Features
- [ ] **Enable Discussions** on urule-os/urule (Settings > Features > Discussions)
  - Create categories: Announcements, Q&A, Show & Tell, Ideas
- [ ] **Enable GitHub Sponsors** at github.com/sponsors/PanoramicRum
  - Set tiers: $5/mo (Individual), $25/mo (Team), $100/mo (Company)
- [ ] **Pin the urule repo** to your GitHub profile and the urule-os org page
- [ ] **Add org description** at github.com/urule-os: "Open-source control plane for AI coworkers"

### 1.2 Create Social Presence
- [ ] **Twitter/X**: Create @urule_os account
  - Bio: "A Linux for AI. Open-source control plane for AI coworkers. Apache 2.0."
  - Pin: Launch announcement tweet with GitHub link
- [ ] **Add social links** to README footer and GitHub org profile

### 1.3 Record Demo Video
- [ ] Record a 2-3 minute walkthrough:
  1. Login (demo mode)
  2. Deploy an agent from the template catalog
  3. Chat with the agent (show streaming)
  4. Show an approval flow
  5. Browse the dashboard
- [ ] Upload to YouTube
- [ ] Embed in README (replace the architecture section with video + architecture below it)

### 1.4 Write Launch Post
- [ ] Write "Introducing Urule" blog post (GitHub Discussions > Announcements):
  - What is it (1 paragraph)
  - Why it exists (the fragmentation problem)
  - Architecture overview
  - What makes it different (comparison table)
  - How to get started (3 commands)
  - How to contribute
  - What's next (roadmap highlights)

### Metrics — End of Week 1
| Metric | Target |
|--------|--------|
| GitHub stars | 25+ |
| README views | 500+ |
| Forks | 5+ |
| Discussion posts | 3+ |

---

## Phase 2: Distribute (Weeks 2-4)

### 2.1 Submit to Awesome Lists
Each requires a PR following the list's contribution format.

- [ ] [awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents) — "Frameworks & Platforms" section
- [ ] [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) — for mcp-gateway
- [ ] [awesome-self-hosted](https://github.com/awesome-selfhosted/awesome-selfhosted) — "AI" category
- [ ] [awesome-fastify](https://github.com/fastify/awesome-fastify) — for the Fastify-based services
- [ ] [awesome-typescript](https://github.com/dzharii/awesome-typescript) — "Frameworks" section

### 2.2 Post on Communities
- [ ] **Hacker News**: "Show HN: Urule — A Linux for AI (open-source control plane for AI coworkers)"
  - Post on a weekday morning (Pacific time)
  - Be available to answer comments for 4-6 hours
- [ ] **Reddit**: Post in r/LocalLLaMA, r/MachineLearning, r/SideProject, r/typescript
- [ ] **Dev.to**: Publish a "Getting Started with Urule" tutorial
- [ ] **Discord**: Post in LangChain, Anthropic, and AI developer Discord servers (in their #showcase channels)

### 2.3 Publish npm Packages
- [ ] Register `@urule` npm scope: `npm login --scope=@urule`
- [ ] Publish standalone libraries:
  - `npm publish` in widget-sdk, orchestrator-contract
- [ ] This makes Urule discoverable via `npm search`

### 2.4 Create "Good First Issue" Labels
- [ ] Go through ROADMAP.md and label 10-15 items as "good first issue"
- [ ] Pick items that are:
  - Self-contained (one file or one service)
  - Well-documented (pattern exists to follow)
  - Low-risk (won't break existing features)
- [ ] Examples:
  - "Add JSDoc to registerAgentRoutes() function"
  - "Add bottom navigation bar for mobile"
  - "Add OTEL instrumentation to registry service"
  - "Create Discord channel adapter for channel-router"

### Metrics — End of Month 1
| Metric | Target |
|--------|--------|
| GitHub stars | 100+ |
| Contributors | 3+ (beyond you) |
| Forks | 15+ |
| npm weekly downloads | 50+ |
| Awesome-list inclusions | 2+ |
| Discussion threads | 10+ |

---

## Phase 3: Community (Months 2-3)

### 3.1 Respond Fast
- [ ] **Issue response time**: < 24 hours for all new issues
- [ ] **PR review time**: < 48 hours for all PRs
- [ ] **Discussion response**: < 24 hours
- [ ] This is the #1 factor in community growth — people stay where they feel heard

### 3.2 Celebrate Contributors
- [ ] Thank every contributor publicly (in PR comments and release notes)
- [ ] Add a "Contributors" section to README (use GitHub's auto-generated contributor avatars)
- [ ] Feature community-built adapters/widgets in README

### 3.3 Create Integration Guides
- [ ] "How to use Urule with CrewAI" — blog post + example
- [ ] "How to use Urule with Claude Desktop" — MCP integration guide
- [ ] "How to build a Slack bot with Urule" — channel adapter tutorial
- [ ] Each integration expands the audience to that tool's community

### 3.4 Ship Weekly
- [ ] Aim for at least 1 visible improvement per week
- [ ] Post a weekly "What's New" update in Discussions
- [ ] Tag the update on Twitter/X
- [ ] Consistency > size of changes

### 3.5 Discord Server (When Ready)
- [ ] Create when you have 50+ stars or 5+ active contributors
- [ ] Channels: #general, #support, #show-and-tell, #development, #ideas
- [ ] Don't create too early — empty Discord feels dead

### Metrics — End of Month 3
| Metric | Target |
|--------|--------|
| GitHub stars | 500+ |
| Contributors | 10+ |
| Forks | 50+ |
| npm weekly downloads | 200+ |
| External blog posts about Urule | 2+ |
| Orchestrator adapters (community) | 1+ |
| Channel adapters (community) | 1+ |

---

## Phase 4: Scale (Months 4-6)

### 4.1 Conference Talks
- [ ] Submit to AI/developer conferences (local meetups first, then bigger)
- [ ] Topics: "Building an AI Control Plane with Open Source" or "How We Coordinated 50 AI Agents"
- [ ] Even rejected proposals raise awareness with reviewers

### 4.2 Partner Integrations
- [ ] Reach out to LangGraph team — "we built an adapter for your framework"
- [ ] Reach out to Anthropic — "we use Claude for AI execution"
- [ ] Reach out to MCP ecosystem — "we built a gateway for MCP servers"
- [ ] Reach out to Backstage community — "we built a plugin"
- [ ] Being listed on partner pages drives qualified traffic

### 4.3 Documentation Site
- [ ] Consider a docs site (Docusaurus, Nextra, or Mintlify)
- [ ] Host at docs.urule.dev or similar
- [ ] Auto-generate API docs from OpenAPI specs
- [ ] SEO benefits of a dedicated docs domain

### 4.4 Logo & Brand
- [ ] Commission a logo (or use an AI tool to create one)
- [ ] Create a simple brand guide (colors, fonts, tone)
- [ ] Add logo to README, GitHub org, npm packages, social profiles
- [ ] Visual identity makes the project feel established

### Metrics — End of Month 6
| Metric | Target |
|--------|--------|
| GitHub stars | 2,000+ |
| Contributors | 25+ |
| Forks | 150+ |
| npm weekly downloads | 1,000+ |
| Conference talks | 1+ |
| Partner listings | 1+ |
| Production users | 5+ |

---

## Phase 5: Sustain (Months 6+)

### 5.1 Governance
- [ ] Add CODEOWNERS file for code review routing
- [ ] Promote active contributors to maintainers
- [ ] Create a MAINTAINERS.md with responsibilities
- [ ] Consider a technical steering committee when 5+ maintainers

### 5.2 Sustainability
- [ ] GitHub Sponsors for maintainer compensation
- [ ] Consider an Open Collective for transparent finances
- [ ] Explore commercial support/hosting as a business model
- [ ] "Open core" option: free platform + paid enterprise features (SSO, audit compliance, SLA)

### 5.3 Ecosystem Growth
- [ ] Package marketplace (community-published packages in PackageHub)
- [ ] Widget marketplace
- [ ] Certified adapters program
- [ ] Annual community survey

---

## Content Calendar Template

### Weekly
| Day | Action |
|-----|--------|
| Monday | Check issues/PRs, respond to discussions |
| Wednesday | Ship a feature or fix, post update |
| Friday | Tweet about the week's progress |

### Monthly
| Week | Action |
|------|--------|
| Week 1 | Write a blog post or tutorial |
| Week 2 | Submit to 1 awesome-list or community |
| Week 3 | Record a short demo of a new feature |
| Week 4 | Publish changelog, tag new version |

---

## Key Channels Summary

| Channel | URL | Priority |
|---------|-----|----------|
| GitHub (main) | github.com/urule-os/urule | Primary |
| GitHub Discussions | (enable in repo settings) | Community hub |
| Twitter/X | @urule_os (create) | Announcements |
| npm | @urule/* packages (publish) | Developer reach |
| Hacker News | Show HN post | Launch spike |
| Reddit | r/LocalLLaMA, r/MachineLearning | Community reach |
| Dev.to | Tutorial posts | SEO + reach |
| YouTube | Demo videos | Conversion |
| Discord | (create at 50+ stars) | Real-time community |

---

## What Success Looks Like

**6 months from now**, someone searching for "open source AI agent platform" or "MCP tool registry" or "AI approval workflow" finds Urule in the top results. They:

1. See a professional README with badges, comparison, and quick start
2. Get running in under 5 minutes with `make dev`
3. Deploy their first agent from the template catalog
4. Chat with a real AI that can hire specialists and create tasks
5. Build a widget or adapter by following CLAUDE.md recipes
6. Submit their first PR by picking a "good first issue"
7. Tell their team about it

That's the flywheel.

---

## Funding Explained

### What is GitHub Sponsors?
GitHub Sponsors lets people and companies financially support open-source maintainers. The `FUNDING.yml` file adds a "Sponsor" button to your repo.

### How it works
1. You set up a profile at github.com/sponsors/PanoramicRum
2. Create tiers ($5/mo, $25/mo, $100/mo, etc.)
3. People click "Sponsor" on your repo and pay monthly
4. GitHub takes 0% fees (they subsidize the program)
5. Money goes to your bank account via Stripe

### Why it matters
- Signals the project is actively maintained
- Funds your time to review PRs, triage issues, ship features
- Companies sponsor projects they depend on (it's normal)
- Even $500/mo covers meaningful development time

### When to activate
- Set it up now (it takes a few days for GitHub to approve)
- Don't expect income immediately — it grows with stars and adoption
- The button's presence alone adds credibility

---

*This plan is a living document. Update metrics monthly and adjust tactics based on what's working.*

*Last updated: 2026-03-27*
