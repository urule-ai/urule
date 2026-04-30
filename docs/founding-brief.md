# Founding brief

> **Historical design artifact — preserved for reference.**
>
> This is the document that kicked off Urule. It is **not** a current spec.
> For the current state see [README.md](../README.md) and [ROADMAP.md](../ROADMAP.md).
>
> **What this is:** the original "Linux for AI" prompt Richy sent to an AI
> assistant in March 2026 (first paragraph below), followed by the first
> architectural response describing layers, modules, package types, and the
> reuse-over-build philosophy that still drives the project.
>
> **How it was used:** this response directly shaped Urule's four-layer
> architecture (portal → control plane → orchestration → execution), the
> choice of open-source dependencies (Backstage, LangGraph, Temporal,
> Keycloak, OpenFGA, OPA, NATS, OpenTelemetry, MCP), and the initial
> package-type catalog (personality / skill / widget / workflow / etc.).
> See [docs/initial-architecture.md](initial-architecture.md) for the more
> detailed follow-on service breakdown that informed the actual repo layout.
>
> **Naming:** the project was originally called **AI Office OS** (also written
> as "OAIOfficeOS" / "AIOfficeOS" in later notes) and renamed to **Urule**
> during repo restructuring. Everywhere the body below says "AI Office OS",
> read "Urule". The design principle — "thin control plane, reuse everything
> else, only build the glue" — has not changed.
>
> **Service-name mapping** (original → current):
>
> | Original brief | Current repo |
> |---|---|
> | Workspace Registry | [urule-registry](../urule-registry/) |
> | Package Manager | [urule-packages](../urule-packages/) |
> | Package Registry Metadata Service | [urule-packagehub](../urule-packagehub/) |
> | Orchestrator Adapter Layer (contract) | [urule-orchestrator-contract](../urule-orchestrator-contract/) |
> | LangGraphAdapter | [urule-langgraph-adapter](../urule-langgraph-adapter/) |
> | Approval Service | [urule-approvals](../urule-approvals/) |
> | Channel Router | [urule-channel-router](../urule-channel-router/) |
> | Office State Service | [urule-state](../urule-state/) |
> | Widget Host / UI SDK | [urule-widget-sdk](../urule-widget-sdk/) + [urule-office-ui](../urule-office-ui/) |
> | Backstage Sync Module | [backstage-urule-plugin](../backstage-urule-plugin/) |
> | Connector / MCP Gateway | [urule-mcp-gateway](../urule-mcp-gateway/) |
> | Runtime Broker | [urule-runtime-broker](../urule-runtime-broker/) |
>
> **Since expanded:** `urule-spec` (manifest SDK), `urule-events` (event
> bus SDK), `urule-authz` (OpenFGA client), `urule-governance` (OPA +
> OpenFGA combined gateway), `urule-auth-middleware` (shared JWT plugin),
> and `urule-goose-adapter` (second orchestrator, see
> [ROADMAP §7](../ROADMAP.md)).

---

I have this idea of creating something like 'Linux for AI' that gets different open source projects and pieces together into one cohesive product that is easy to use. I want to build it in pieces like services that can run and glue it all together, not one single glue codebase. Here is the entire description, tell me which services/projects I can create to be able to build the 'glue' in pieces that can be re-usable by others too: --- 

## AI Office OS — architectural description 

**AI Office OS** should be a **thin control plane for AI coworkers**, not a new agent engine. Its job is to unify identity, packages, approvals, channels, policy, and UI on top of existing open-source runtimes and standards. The core design principle is: **reuse execution, reuse workflow durability, reuse auth, reuse eventing; only build the glue that turns them into one installable product.** ([GitHub][1]) 

It is **not** another orchestrator like LangGraph, ADK, CrewAI, or AutoGen. It is also **not** a full AI-coding product like OpenHands. LangGraph already covers low-level orchestration for long-running, stateful agents, while OpenHands is explicitly positioned as an AI-driven development platform with its own SDK, CLI, GUI, cloud, and enterprise layers. AI Office OS should sit **above** those layers as the operating environment. ([LangChain Docs][2]) 

### The architectural spine 

The system should have four layers. **The first layer is the portal and control plane.** Use **Backstage** as the portal, admin shell, plugin surface, catalog, and templating entry point. Backstage already has a core/app/plugin split, extension points, modules, services, catalog entities, and software templates/scaffolder actions. In this architecture, Backstage is the **operator console**, package browser, workspace catalog, docs surface, and install/configuration UI. It is **not** the immersive office UI itself. ([Backstage][3]) 

**The second layer is orchestration.** Start with **LangGraph** as the first orchestrator, because it is explicitly a low-level orchestration framework and runtime for long-running, stateful agents, with durable execution, memory, and human-in-the-loop support. Add **Google ADK** later as a second adapter, especially for teams that want its deterministic workflow-agent model with sequential, parallel, and loop agents, plus plugins and custom agents. ([LangChain Docs][2]) 

**The third layer is execution.** Reuse **sandboxed.sh** as much as possible for isolated workspaces, mission control, git-backed libraries, MCP management, and multi-runtime execution. Its repo already describes multi-runtime support, isolated Linux workspaces, a git-backed library for skills/tools/rules/agents/MCPs, optional MCP registry usage, and a dashboard/API surface. Borrow **OpenHands' runtime pattern** rather than its whole product: OpenHands documents a clean backend-to-sandbox client/server model where the backend launches a Docker runtime image and talks to the action-execution server over REST. That pattern is ideal for your runtime boundary. ([GitHub][1]) 

**The fourth layer is platform services.** Use **Temporal** for durable workflows and approvals; **Keycloak** for identity, SSO, federation, and admin management; **OpenFGA** for relationship-based authorization; **OPA** for policy-as-code decisions; **NATS** with JetStream for eventing and persistence; **OpenTelemetry** for traces, metrics, and logs; and **MCP** as the southbound tool/resource/prompt protocol. That gives you a reliable stack without inventing your own infrastructure primitives. ([Temporal Docs][4]) 

--- 

## The modules and which open-source projects power them 

### 1. Portal and package shell Use **Backstage**. Backstage should host: * workspace catalog * installed package catalog * docs and setup flows * template installer UI * admin/config pages * plugin mounting points for your own modules Backstage's plugin architecture, services, modules, extension points, and software templates make it a good fit for the operator-facing shell. ([Backstage][3]) 

### 2. Orchestrator runtime layer Use **LangGraph first**, **Google ADK second**. LangGraph should run the first wave of persistent task graphs: approvals, resumable work, multi-step agent jobs, subgraphs, and long-running stateful flows. Later, add a **Google ADK adapter** so teams can run ADK-based agents and workflow agents in the same control plane. ADK's deterministic workflow-agent types and plugin model make it a good second ecosystem to support, but not the first one to center the architecture on. ([LangChain Docs][2]) 

### 3. Execution and sandbox layer Use **sandboxed.sh**, with ideas from **OpenHands**. sandboxed.sh should provide: * isolated workspaces * remote mission lifecycle * git-backed runtime library * runtime selection * MCP server management * secure workspace execution OpenHands should influence: * the runtime API shape * container lifecycle contract * backend-to-runtime communication pattern * local GUI/API ergonomics This keeps AI Office OS from becoming another runtime engine. ([GitHub][1]) 

### 4. Workflow and approvals Use **Temporal**. Temporal should own: * approval pauses * retries * escalations * resumable workflow state * long-running task lifecycles * workflow templates Temporal's value is that workflows resume where they left off after failures or outages, which is exactly what approval gates and multi-step agent work need. ([Temporal Docs][4]) 

### 5. Identity Use **Keycloak**. Keycloak should own: * users * organizations/workspaces * SSO * social login if needed * identity brokering * LDAP/AD federation * service accounts That removes the need to build auth, session management, or SSO yourself. ([Keycloak][5]) 

### 6. Authorization Use **OpenFGA**. OpenFGA should answer questions like: * can this user approve this task? * can this agent belong to this workspace? * can this package be installed in this org? * can this widget appear for this role? Its relationship-based model is a strong fit for workspace membership and package/resource access. ([OpenFGA][6]) 

### 7. Policy engine Use **OPA**. OPA should evaluate policies like: * this action requires approval * this agent cannot send email * this runtime cannot access the public internet * only signed packages may be installed * only some secrets may be injected into this mission OPA is explicitly designed to decouple policy decisions from application code. It does not ship a full control plane, which is fine because AI Office OS becomes that control plane. ([Open Policy Agent][7]) 

### 8. Eventing Use **NATS**. NATS should carry: * task lifecycle events * approval events * package install events * runtime status changes * channel messages * telemetry hooks JetStream gives you persistence, replay, queues, and KV/object primitives without adding another heavy subsystem. ([docs.nats.io][8]) 

### 9. Observability Use **OpenTelemetry**. OpenTelemetry should instrument: * control plane APIs * orchestrator adapters * workflow runs * sandbox missions * approval paths * connector activity * channel delivery That gives you one tracing and metrics language across all services. ([OpenTelemetry][9]) 

### 10. Tool and connector protocol Use **MCP**. MCP should be the standard way AI Office OS exposes and consumes: * tools * resources * prompts * remote servers Anthropic describes MCP as an open protocol that standardizes how applications provide context to LLMs, "like USB-C for AI applications." That is the right southbound contract for your system. ([Claude API Docs][10]) 

--- 

## What you still need to build This is the important part: **the glue is the product**. You need to build a **thin AI Office OS control plane** with these modules: 

**Workspace Registry** The canonical model for organizations, rooms, agents, runtimes, channels, installed packages, workflow bindings, and approvals. 

**Package Manager** Installs packages from GitHub repos or registries, validates manifests, resolves dependencies, checks policy, syncs with Backstage catalog entries, and publishes installation events. 

**Orchestrator Adapter Layer** A stable internal interface like: 
* startRun 
* pauseForApproval 
* resumeRun 
* cancelRun 
* getState 
* emitArtifact 
* handoffAgent 

Then implement: 
* LangGraphAdapter 
* later GoogleADKAdapter 

**Approval Service** Built on Temporal, backed by OpenFGA and OPA, exposed in UI and chat. It should create approval objects, route them to the right approvers, and resume workflows after decisions. 

**Channel Router** Maps Slack, Telegram, email, and office chat onto the same internal agent/message/task model. 

**Office State Service** Tracks room presence, live status, task ownership, agent activity, and widget state for the 2D office. 

**Widget Host and UI SDK** Lets third parties mount panels, dashboards, inspectors, overlays, and action forms into the office UI or admin console. 

**Package Registry Metadata Service** Stores package manifests, versions, dependencies, signing/trust metadata, screenshots, docs, compatibility, and install history. 

**Backstage Sync Module** Turns packages, workspaces, runtimes, and templates into Backstage catalog entities and scaffolder templates so operators can discover and install them through Backstage. Those are the thin modules that make all the reused OSS parts feel like one product. ([Backstage][3]) 

--- 

## What users will be able to install 

The install model should be package-based. Every installable thing should have a manifest, version, compatibility rules, requested permissions, and optional signatures. The main installable package types should be: 

**Personality packs** Agent roles, persona instructions, goals, default tools, memory rules, and operating styles. 

**Skill packs** Reusable capabilities like "summarize support tickets," "draft a PRD," "review a contract," or "triage GitHub issues." 

**MCP connector packs** Wrappers for MCP servers, auth flows, resource mappings, and default tool sets. 

**Workflow packs** Temporal-backed workflows for things like onboarding, lead triage, release prep, support escalation, and recruiting loops. 

**Template packs** Opinionated bundles of agents, skills, connectors, workflows, policies, and widgets for a specific use case like "startup team," "support pod," or "marketing team." 

**Policy packs** OPA/OpenFGA-backed default rules for approval gates, secret scopes, external network access, package trust, and allowed runtime capabilities. 

**Widget packs** Custom UI panels, inspectors, dashboards, approval queues, status overlays, cost views, and analytics widgets. 

**Office packs** Maps, room layouts, visual themes, avatar skins, and interaction zones for the office UI. 

**Channel packs** Slack, Telegram, Discord, email, SMS, or future messaging adapters. **Orchestrator packs** The first one is built-in via LangGraph, but later users can install new runtime adapters like Google ADK support. 

**Runtime packs** Prebuilt workspace images or runtime profiles for coding, browser automation, data analysis, support ops, or private local inference. This package model is also where you should contribute back to 

**sandboxed.sh**: extend its git-backed library concept so personalities, MCP bundles, workflows, and policies become first-class installables rather than creating a parallel ecosystem. ([GitHub][1]) --- ## What to reuse from sandboxed.sh and what to contribute back Reuse as much of **sandboxed.sh** as you can for: 
* isolated workspace lifecycle 
* mission control concepts 
* git-backed library 
* MCP server management 
* runtime switching 
* dashboard/runtime metadata 

The best upstream contributions are: 
* package manifest schema 
* metadata for personalities/templates/widgets 
* approval hooks and mission pause/resume callbacks 
* non-coding agent runtime support 
* channel integration hooks 
* richer library indexing and discovery That keeps your product thin and reduces the chance you become the maintainer of a large fork. ([GitHub][1]) 

--- 

## What to take from OpenHands Use **OpenHands** as a reference for: 
* runtime isolation principles 
* backend-to-sandbox REST contract 
* local GUI + REST API ergonomics 
* SDK/CLI/product packaging ideas 

Do **not** use it as the architectural center. OpenHands is already a broad AI-driven development product, while your goal is a general-purpose operating layer for AI coworkers. ([OpenHands Docs][11]) 

--- 

## The simplest correct description 

**AI Office OS is a thin control plane on top of Backstage, LangGraph, sandboxed.sh, Temporal, Keycloak, OpenFGA, OPA, NATS, OpenTelemetry, and MCP.** It does not replace those projects. It binds them into one installable system where teams can deploy AI coworkers, govern them, talk to them, approve risky actions, and install new personalities, skills, workflows, connectors, and widgets. ([Backstage][3]) The cleanest build strategy is: **reuse runtimes, reuse orchestration, reuse platform services, build only the control plane, package model, and user experience.**

[1]: https://github.com/Th0rgal/sandboxed.sh "GitHub - Th0rgal/sandboxed.sh: Self-hosted orchestrator for AI autonomous agents."
[2]: https://docs.langchain.com/oss/python/langgraph/overview "LangGraph overview - Docs by LangChain"
[3]: https://backstage.io/docs/overview/architecture-overview/ "Architecture overview | Backstage"
[4]: https://docs.temporal.io/ "Temporal Docs"
[5]: https://www.keycloak.org/ "Keycloak"
[6]: https://openfga.dev/ "Fine-Grained Authorization | OpenFGA"
[7]: https://www.openpolicyagent.org/docs/latest "Open Policy Agent (OPA)"
[8]: https://docs.nats.io/ "NATS Docs"
[9]: https://opentelemetry.io/docs/ "OpenTelemetry Documentation"
[10]: https://docs.anthropic.com/en/docs/mcp "Model Context Protocol (MCP) - Anthropic"
[11]: https://docs.openhands.dev/usage/architecture/runtime "Runtime Architecture - OpenHands Docs"
