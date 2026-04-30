# Initial architecture — service split

> **Historical design artifact — preserved for reference.**
>
> This is the more detailed service-breakdown that followed the
> [founding brief](founding-brief.md). It is **not** a current spec —
> see [README.md](../README.md) for the current architecture and
> [ROADMAP.md](../ROADMAP.md) for in-flight work.
>
> **What this is:** a second design response (March 2026) that took the
> founding brief's broad vision and split it into 16 concrete
> services/libraries with suggested boundaries, responsibilities, and
> naming. It proposes a minimum-viable set, a library-vs-service split,
> and a four-phase build order.
>
> **How it was used:** this directly informed the repo split you see
> today. Nearly every urule-* repo maps back to an item in this
> document's "The services/projects I would create" list, and the
> "Phase 1 → Phase 4" build order below is reflected in Phase 1-5 of
> the implementation history in [README.md](../README.md).
>
> **Naming:** the doc uses "AI Office OS" / "OfficeAIOS" and prefixes
> like `office-*` or `aios-*`. The project was renamed to **Urule**
> during restructuring and all prefixes became `urule-*`.
>
> **Service-name mapping** (original → current):
>
> | Original name(s) | Current repo | Notes |
> |---|---|---|
> | `office-spec` / `aios-spec` / `office-manifests` | [urule-spec](../urule-spec/) | |
> | `office-events` / `aios-event-sdk` | [urule-events](../urule-events/) | |
> | `office-registry` / `aios-registry` | [urule-registry](../urule-registry/) | |
> | `office-pkg` / `aios-packages` / `officepm` | [urule-packages](../urule-packages/) | |
> | `office-registry-index` / `aios-packagehub` | [urule-packagehub](../urule-packagehub/) | |
> | `orchestrator-contract` | [urule-orchestrator-contract](../urule-orchestrator-contract/) | |
> | `langgraph-adapter` | [urule-langgraph-adapter](../urule-langgraph-adapter/) | |
> | `adk-adapter` (planned) | — | see [ROADMAP §6.2](../ROADMAP.md) |
> | `office-approvals` / `aios-approvald` | [urule-approvals](../urule-approvals/) | |
> | `office-policy` + `office-authz` / `aios-policy-gateway` + `aios-fga` | [urule-governance](../urule-governance/) + [urule-authz](../urule-authz/) | The doc suggested combining policy + authz as one governance module; that suggestion was taken — `urule-governance` wraps both OPA and OpenFGA behind a single gateway, with `urule-authz` as the shared client library |
> | `office-runtime-broker` / `aios-runtime` | [urule-runtime-broker](../urule-runtime-broker/) | |
> | `channel-router` | [urule-channel-router](../urule-channel-router/) | |
> | `office-state` / `presence-service` | [urule-state](../urule-state/) | |
> | `widget-sdk` / `widget-host` / `widget-manifest-spec` | [urule-widget-sdk](../urule-widget-sdk/) + [urule-office-ui](../urule-office-ui/) | `widget-host` folded into the Office UI; widget-manifest-spec folded into `urule-spec` |
> | `backstage-office-plugin` / `backstage-sync` | [backstage-urule-plugin](../backstage-urule-plugin/) | |
> | `mcp-gateway` / `connector-hub` | [urule-mcp-gateway](../urule-mcp-gateway/) | |
> | `run-records` / `artifact-store` (planned) | — | not yet extracted; currently lives inside the orchestrator contract's `ArtifactRef` type |
>
> **Since expanded:**
> - [urule-auth-middleware](../urule-auth-middleware/) — shared Fastify JWT
>   plugin that didn't exist in the original design; added to avoid
>   duplicating auth in every service (ROADMAP §1.1)
> - [urule-goose-adapter](../urule-goose-adapter/) — second orchestrator
>   adapter (alongside `urule-langgraph-adapter`) for Goose, an AAIF /
>   Linux Foundation agent runtime. See [ROADMAP §7](../ROADMAP.md).
> - [urule-infra](../urule-infra/) — Docker Compose definitions, seed
>   SQL, E2E test harness. Not a service, but a repo all services
>   depend on during development.

---

The key is to treat OfficeAIOS **"Linux for AI" as a composable control plane**, not a monolith.

From your description, the best way to build the glue in reusable pieces is to create a small set of **product-defining services** with **clear contracts**. Everything else should plug into those contracts.

## **The right split**

You do **not** need one giant "AI Office OS backend."  
You want a handful of projects that each own one boundary:

1. **workspace/system model**  
2. **package/install model**  
3. **orchestrator abstraction**  
4. **approval/governance**  
5. **channel abstraction**  
6. **runtime abstraction**  
7. **UI/widget mounting**  
8. **event and state propagation**

That gives you a platform others can reuse, extend, or replace piece by piece.

---

# **The services/projects I would create**

## **1\. Workspace Registry**

This is the **source of truth** for the whole system.

It should own:

* orgs  
* workspaces  
* rooms  
* agents  
* runtimes  
* installed packages  
* channel bindings  
* workflow bindings  
* approval objects  
* widgets mounted in each workspace

Think of it as the **Kubernetes API server equivalent** for AI Office OS, except much thinner.

It should expose:

* CRUD APIs for core entities  
* query APIs for UI/control plane  
* change events when entities are created/updated  
* references to authz/policy results, not authz logic itself

Why it matters:

* every other service needs a canonical model  
* reusable by others even if they do not use your UI  
* makes the rest of the platform stateless and pluggable

Good project name:

* `office-registry`  
* `aios-registry`

---

## **2\. Package Manager**

This is one of the most important reusable projects.

It should own:

* package manifest format  
* dependency resolution  
* compatibility checks  
* signature/trust verification  
* permission declaration parsing  
* install/upgrade/remove lifecycle  
* install plans and rollbacks  
* package source adapters (GitHub, git repo, registry)

Supported package kinds:

* personality packs  
* skill packs  
* MCP connector packs  
* workflow packs  
* template packs  
* policy packs  
* widget packs  
* office packs  
* channel packs  
* orchestrator packs  
* runtime packs

This is likely the **single most reusable piece** for others.

Make it independent of your UI:

* CLI-friendly  
* API-friendly  
* can run standalone  
* emits install events over NATS

Good project name:

* `office-pkg`  
* `aios-packages`  
* `officepm`

---

## **3\. Package Registry Metadata Service**

Separate this from install execution.

It should own:

* package metadata  
* versions  
* dependencies  
* screenshots  
* docs links  
* trust/signing metadata  
* compatibility matrix  
* install history  
* search/indexing  
* package quality signals

Why split it from Package Manager:

* Package Manager executes installs  
* Metadata Service indexes/discovers packages

That keeps the install path simpler and lets others reuse your package ecosystem without your installer.

Good project name:

* `office-registry-index`  
* `aios-packagehub`

---

## **4\. Manifest SDK / Package Spec**

This should be its **own project**, not hidden in a service.

It should define:

* manifest schema  
* dependency format  
* permission model  
* package type definitions  
* lifecycle hooks  
* compatibility rules  
* signature fields

Also ship:

* validator  
* JSON Schema  
* TypeScript and Go SDKs  
* examples  
* linter

This is how you create an ecosystem instead of a product silo.

Good project name:

* `office-spec`  
* `aios-spec`  
* `office-manifests`

---

## **5\. Orchestrator Adapter Interface**

This is another core reusable project.

Define a stable internal contract like:

* `startRun`  
* `pauseForApproval`  
* `resumeRun`  
* `cancelRun`  
* `getState`  
* `emitArtifact`  
* `handoffAgent`

Then implement adapters:

* `langgraph-adapter`  
* later `google-adk-adapter`

This should be a **small abstraction layer**, not a giant framework.

Important rule:

* adapters normalize lifecycle and artifacts  
* they do **not** hide all orchestrator-specific features  
* expose a common core, plus optional capability flags

Example capabilities:

* durable checkpoints  
* HITL  
* subgraphs/subflows  
* streaming  
* artifact emission  
* cancellation  
* resumability

Good project split:

* `orchestrator-contract`  
* `langgraph-adapter`  
* `adk-adapter`

---

## **6\. Approval Service**

This is where your product becomes operationally serious.

It should own:

* approval request objects  
* routing to approvers  
* due dates / escalation  
* approve/reject/cancel flows  
* workflow resume hooks  
* approval audit trail  
* channel/UI rendering of approvals

Built on:

* Temporal for durable waiting/resume  
* OpenFGA for "who can approve"  
* OPA for "what requires approval"

This is highly reusable beyond your office UI.

Good project name:

* `office-approvals`  
* `aios-approvald`

---

## **7\. Policy Decision Gateway**

Do not spread OPA calls everywhere.

Create one thin policy service that:

* evaluates policies for actions  
* translates product context into OPA input  
* returns typed decisions  
* can explain why something was denied  
* centralizes policy bundles and versions

Examples:

* can this package be installed?  
* does this action require approval?  
* may this runtime access internet?  
* may this connector inject this secret?

Why this matters:

* keeps application code clean  
* gives users one place to understand governance  
* reusable by any future service or extension

Good project name:

* `office-policy`  
* `aios-policy-gateway`

---

## **8\. Authorization Gateway**

Similarly, do not let every service speak OpenFGA differently.

Create one small service/library for:

* relationship writes  
* permission checks  
* model migrations  
* subject/resource translation  
* batched authz lookups

Examples:

* user X can approve task Y  
* agent A belongs to workspace B  
* package P installable in org O  
* widget W visible to role R

Best split:

* shared authz SDK  
* optional authz service facade

Good project name:

* `office-authz`  
* `aios-fga`

---

## **9\. Runtime Broker**

This is the glue above sandboxed.sh/OpenHands-style runtime patterns.

It should own:

* runtime session allocation  
* workspace-to-runtime binding  
* runtime capability discovery  
* runtime health/status  
* mission/session lifecycle mapping  
* artifact and log streaming  
* sandbox identity/secrets attachment  
* runtime profile selection

It should **not** execute code itself.  
It should broker execution into:

* sandboxed.sh  
* future alternative runtimes  
* local/private inference runtimes  
* browser automation runtimes

This becomes your reusable **execution abstraction**.

Good project name:

* `office-runtime-broker`  
* `aios-runtime`

---

## **10\. Channel Router**

This is a major reusable integration point.

It should map:

* Slack  
* Telegram  
* email  
* Discord  
* internal office chat

into a common model:

* messages  
* threads  
* tasks  
* approvals  
* agent responses  
* notifications  
* attachments  
* reactions/status

It should own:

* channel adapter interface  
* inbound normalization  
* outbound rendering  
* delivery retries  
* identity mapping between channel users and workspace identities

Split it into:

* core router  
* per-channel adapters

Good project names:

* `channel-router`  
* `slack-channel-pack`  
* `email-channel-pack`

---

## **11\. Office State Service**

This is specific to your immersive office UI, but still a good separate project.

It should own:

* room presence  
* who is active where  
* task ownership  
* live agent state  
* widget placement/state  
* occupancy/activity stream  
* per-room shared context

This lets your 2D office be a client of system state, not the owner of it.

Why separate:

* keeps immersive UI optional  
* other UIs can reuse the same live state  
* helps you support admin console \+ office UI \+ mobile UI later

Good project name:

* `office-state`  
* `presence-service`

---

## **12\. Widget Host / UI Extension Runtime**

This is the piece that turns the system into a platform.

It should define:

* widget manifest  
* widget capability model  
* widget mounting points  
* event bridge to backend  
* permissions for widget actions  
* theming/layout integration  
* sandboxing/isolation for third-party widgets

Mounting targets:

* office UI  
* Backstage admin console  
* approval inbox  
* package detail pages  
* runtime inspector  
* agent detail panels

This is how others build on your system without touching core.

Good project split:

* `widget-sdk`  
* `widget-host`  
* `widget-manifest-spec`

---

## **13\. Backstage Sync Module**

This should be its own adapter project, not hand-written into core services.

It should:

* sync workspaces into catalog entities  
* sync packages into discoverable entities  
* generate or update scaffolder templates  
* register docs/config/install surfaces  
* surface runtime/package status in Backstage

Keep it one-way where possible:

* your registry remains source of truth  
* Backstage is a portal/index/operator shell

Good project name:

* `backstage-office-plugin`  
* `backstage-sync`

---

## **14\. Event Schema / Event Bus SDK**

Because you are using NATS, define your own product event contracts.

Events like:

* package installed  
* package upgrade failed  
* runtime attached  
* approval requested  
* approval decided  
* agent run started  
* agent run paused  
* channel message received  
* widget state changed  
* room presence changed

Do this as a separate project:

* schemas  
* topic conventions  
* SDK for publishing/subscribing  
* versioning rules

This makes all services loosely coupled and reusable.

Good project name:

* `office-events`  
* `aios-event-sdk`

---

## **15\. Connector/MCP Gateway**

Since MCP is your southbound protocol, create one service that makes MCP practical.

It should own:

* MCP server registration  
* auth/session handling  
* tool/resource cataloging  
* connector health  
* workspace-scoped connector bindings  
* permission checks before tool use  
* connector capability discovery

It should bridge:

* package model  
* runtime model  
* workspace model  
* policy/approval model

This is how "install connector pack" becomes real.

Good project name:

* `mcp-gateway`  
* `connector-hub`

---

## **16\. Artifact / Run Record Service**

Useful if you want long-running reuse and interoperability.

It should own:

* outputs from runs  
* logs  
* transcripts  
* artifacts  
* execution summaries  
* provenance  
* retention metadata

Why separate:

* orchestrators produce runs  
* UI and approvals consume artifacts  
* channels may need to render summaries  
* auditing needs stable records

Good project name:

* `run-records`  
* `artifact-store`

---

# **The minimum viable set**

If you want the smallest useful first version, build these first:

1. **Workspace Registry**  
2. **Manifest SDK / Package Spec**  
3. **Package Manager**  
4. **Orchestrator Adapter Interface \+ LangGraph Adapter**  
5. **Runtime Broker**  
6. **Approval Service**  
7. **Channel Router**  
8. **Backstage Sync Module**

That is enough to make the platform feel real.

---

# **What should be a service vs a library**

Not everything should be a network service on day one.

## **Start as libraries/modules**

* manifest spec  
* event schemas  
* orchestrator contract  
* authz SDK  
* policy input/output model  
* widget SDK

## **Start as services**

* workspace registry  
* package manager  
* package metadata service  
* approval service  
* runtime broker  
* channel router  
* office state service  
* MCP gateway

That keeps complexity under control.

---

# **The reusable open-source projects you can create**

If your goal is "reusable by others," these are the most valuable standalone OSS projects:

## **Highest-value reusable OSS**

* **Package Spec / Manifest SDK**  
* **Package Manager**  
* **Orchestrator Adapter Contract**  
* **LangGraph Adapter**  
* **Approval Service**  
* **Channel Router**  
* **Widget SDK**  
* **Backstage Plugin/Sync**  
* **Event Schema SDK**  
* **MCP Gateway**

These are useful even for teams that never adopt your full office UI.

---

# **The internal contracts you must define early**

Before writing too much code, lock down these contracts:

## **1\. Core entity model**

* org  
* workspace  
* room  
* agent  
* runtime  
* package  
* installation  
* approval  
* channel binding  
* widget instance  
* run  
* artifact

## **2\. Package manifest contract**

* metadata  
* type  
* version  
* dependencies  
* permissions  
* compatibility  
* signatures  
* install hooks

## **3\. Orchestrator contract**

* lifecycle  
* artifacts  
* state model  
* pause/resume semantics  
* human input injection

## **4\. Runtime contract**

* start session  
* execute task  
* stream logs  
* attach MCP  
* inject secrets  
* terminate  
* report capabilities

## **5\. Channel contract**

* inbound message  
* task  
* approval card  
* outbound render  
* identity mapping

## **6\. Event contract**

* topic naming  
* payload schemas  
* versioning  
* idempotency

If these are good, the system stays modular.

---

# **What I would not split too early**

To avoid accidental complexity, I would **not** make these standalone services on day one:

* separate "user service" beyond Keycloak  
* separate "notification service" unless delivery rules get complex  
* separate "search service" until package metadata grows  
* separate "analytics service" until you have real telemetry consumers  
* separate "secrets service" if you can reuse existing secret backends

Also, I would combine these initially:

* **policy gateway \+ authz gateway** can begin as one governance module  
* **artifact store \+ run records** can start together  
* **office state \+ presence** can be one service

---

# **The best repo layout**

A clean layout would be:

* `office-spec`  
* `office-events`  
* `office-registry`  
* `office-packages`  
* `office-packagehub`  
* `office-orchestrator-contract`  
* `office-langgraph-adapter`  
* `office-runtime-broker`  
* `office-approvals`  
* `office-governance`  
* `office-channel-router`  
* `office-mcp-gateway`  
* `office-widget-sdk`  
* `office-widget-host`  
* `office-state`  
* `backstage-office-plugin`

That is modular without becoming chaotic.

---

# **Build order I'd recommend**

## **Phase 1: platform skeleton**

* manifest spec  
* workspace registry  
* event schema SDK  
* runtime broker  
* LangGraph adapter

## **Phase 2: installability**

* package manager  
* package metadata service  
* Backstage sync/plugin  
* MCP gateway

## **Phase 3: governance**

* approval service  
* policy/authz gateway  
* audit/run record service

## **Phase 4: usability**

* channel router  
* widget host  
* office state service  
* immersive office UI

That sequence keeps you from building UI before you have installable primitives.

---

# **The simplest framing**

The reusable product is really made of **six platform primitives**:

* **Registry** — what exists  
* **Packages** — what can be installed  
* **Adapters** — how agent engines plug in  
* **Broker** — how runtimes execute safely  
* **Governance** — how risky actions are controlled  
* **Channels/UI** — how humans interact with it

Everything else is an extension of those.

---

# **My strongest recommendation**

If you only pick three things to make truly excellent and reusable, pick:

1. **Package model \+ Package Manager**  
2. **Orchestrator Adapter Contract**  
3. **Approval/Governance Service**

Those are the pieces most likely to become the "Linux distro layer" for AI systems rather than just another app.

I can also turn this into a **repo-by-repo blueprint with APIs, responsibilities, and event names**.
