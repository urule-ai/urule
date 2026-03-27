# Urule User Journeys

A comprehensive map of every user journey in the Urule platform — with manual UX test checklists and future improvement ideas.

---

## 1. Authentication

### 1.1 Login
**Path**: `/login`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to app | Redirected to login page |
| 2 | Enter email + password | Fields validate in real-time |
| 3 | Click "Authenticate" | Loading state, then redirect to `/office` |
| 4 | Enter wrong credentials | Error message: "Invalid credentials" |
| 5 | Leave fields empty | Zod validation errors shown inline |

### 1.2 Register
**Path**: `/register`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Click "Create Account" from login | Navigate to register page |
| 2 | Fill name, org, email, password | Password strength validated (uppercase, lowercase, number, special char) |
| 3 | Confirm password | Must match — error if mismatch |
| 4 | Click "Create Workspace" | Account created, redirect to `/setup` |

### 1.3 Forgot Password
**Path**: `/forgot-password`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Click "Forgot password?" from login | Navigate to forgot-password page |
| 2 | Enter email | Validated as email format |
| 3 | Click "Send Reset Link" | Success message + toast (actual email TBD) |
| 4 | Click "Back to login" | Returns to login page |

### 1.4 Demo Login
| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Click "Demo Login" on login page | Immediate login with mock user, redirect to `/office` |

### UX Tests — Authentication
- [ ] Login with valid credentials → dashboard
- [ ] Login with wrong password → error message, no redirect
- [ ] Login with invalid email format → inline validation error
- [ ] Register with weak password → password requirements shown
- [ ] Register with mismatched confirm → error shown
- [ ] Forgot password with valid email → success state
- [ ] Demo login → immediate dashboard access
- [ ] SSO button → toast "Coming soon"
- [ ] OAuth buttons (Google/Apple) → appropriate feedback
- [ ] Tab through all form fields with keyboard only
- [ ] Screen reader announces form errors

### Future Improvements — Authentication
- [ ] Actual Keycloak-backed password reset flow
- [ ] Google OAuth integration
- [ ] GitHub OAuth integration
- [ ] Apple Sign-In
- [ ] Enterprise SSO (SAML/OIDC)
- [ ] Email verification after registration
- [ ] Logout confirmation dialog
- [ ] Session timeout warning
- [ ] "Remember me" checkbox
- [ ] Login rate limiting feedback (show remaining attempts)

---

## 2. Onboarding

### 2.1 Setup Wizard
**Path**: `/setup`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Complete registration | Redirected to setup wizard |
| 2 | Step 1: Select AI provider | Choose Claude/OpenAI/LM Studio/OpenRouter |
| 3 | Enter API key + model | Validated, saved to workspace |
| 4 | Step 2: Browse agent templates | 50+ agents across 7 categories |
| 5 | Select agent template | Pre-fills name, role, system prompt |
| 6 | Customize if desired | Edit name, prompt, config |
| 7 | Step 3: Confirmation | "You're Ready" screen |
| 8 | Click "Enter Office" | Redirect to `/office` dashboard |

### UX Tests — Onboarding
- [ ] Complete 3-step wizard end-to-end
- [ ] Skip steps → should be prevented (required fields)
- [ ] Go back to previous steps → state preserved
- [ ] Provider test connection (if available)
- [ ] Browse all 7 agent categories
- [ ] Select template → preview shows traits, skills, communication style
- [ ] Final step shows celebration/confetti

### Future Improvements — Onboarding
- [ ] Provider connection test during setup
- [ ] Import existing agents from another workspace
- [ ] Team invite during onboarding
- [ ] Guided tour after first login
- [ ] Onboarding progress persistence (resume if interrupted)
- [ ] Template search/filter in setup

---

## 3. Dashboard

### 3.1 Overview
**Path**: `/office`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Login/navigate to dashboard | Stats cards load (agents online, approvals, API calls, workflows) |
| 2 | View agent activity | Agent cards with name, role, status, activity |
| 3 | Click agent card | Navigate to `/office/agents/{id}` |
| 4 | Click quick action | Navigate to respective section (Chat, Tasks, Logs) |
| 5 | Toggle right panel tab | Switch between Overview and Infrastructure |
| 6 | Infrastructure tab | Shows container statuses (running/stopped/unhealthy) |

### UX Tests — Dashboard
- [ ] Dashboard loads with skeleton loaders → then real data
- [ ] Stats cards show correct counts
- [ ] Agent cards show live status (active/idle/offline)
- [ ] Auto-refresh every 15 seconds (data updates without page reload)
- [ ] Click each quick action card → correct navigation
- [ ] Infrastructure tab shows all Docker containers
- [ ] Container restart/stop/start buttons work
- [ ] Dashboard works on mobile (responsive layout)
- [ ] Light mode renders correctly

### Future Improvements — Dashboard
- [ ] Customizable dashboard layout (drag widgets)
- [ ] Real-time WebSocket updates (not polling)
- [ ] Dashboard widget marketplace
- [ ] Pinned/favorite agents section
- [ ] Recent conversations preview
- [ ] Cost tracking widget (API usage)
- [ ] Uptime/SLA monitoring widget

---

## 4. Agent Management

### 4.1 Browse Agents
**Path**: `/office/agents`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Agents | Agent grid loads with all deployed agents |
| 2 | Search by name | Filtered results in real-time |
| 3 | Filter by category | Only matching category agents shown |
| 4 | Filter by status | Only matching status agents shown |
| 5 | Click agent card | Navigate to agent detail page |

### 4.2 Deploy New Agent
**Path**: `/office/agents/new`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Click "New Agent" | 3-step wizard opens |
| 2 | Step 1: Browse templates | Grid of 50+ templates across categories |
| 3 | Click template | Detail modal with traits, skills, system prompt |
| 4 | Click "Select" | Advance to Step 2 |
| 5 | Step 2: Configure | Name, thinking depth (Precise/Balanced/Exploratory), verbosity, color |
| 6 | Adjust thinking depth | Updates temperature (0.2-0.8) |
| 7 | Step 3: Review | Summary of all settings |
| 8 | Click "Deploy Agent" | Agent created, confetti animation, redirect to live page |

### 4.3 Agent Details
**Path**: `/office/agents/{id}`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Click agent from list | Detail page loads with identity, metrics, health |
| 2 | View tabs | Tasks, Memories, Conversations, Activity Logs |
| 3 | Click "Start Chat" | Creates conversation, opens chat |
| 4 | Click "Assign Task" | Navigate to projects |
| 5 | View execution environment | Sandbox details shown |

### 4.4 Live Deployment
**Path**: `/office/agents/{id}/live`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Agent deployed | Confetti celebration animation |
| 2 | View success page | Agent identity, health indicators |
| 3 | Click "What's Next" actions | Navigate to Chat, Projects, or Logs |

### UX Tests — Agent Management
- [ ] Agent list loads with skeleton → real cards
- [ ] Search filters agents in real-time
- [ ] Category pills filter correctly (single category at a time)
- [ ] Status pills filter correctly
- [ ] New Agent wizard — complete all 3 steps
- [ ] Template detail modal shows full info
- [ ] Thinking depth slider updates temperature label
- [ ] Deploy creates agent → API returns 200/201
- [ ] Confetti animation plays on live page
- [ ] Agent detail page loads all tabs
- [ ] Agent status indicator is accurate (active/idle/offline)
- [ ] Mobile: wizard steps are compact, modal is full-screen
- [ ] Empty state when no agents deployed

### Future Improvements — Agent Management
- [ ] Agent cloning (duplicate existing agent)
- [ ] Agent versioning (rollback to previous config)
- [ ] Bulk agent operations (start/stop multiple)
- [ ] Agent performance benchmarks
- [ ] Agent comparison view (side-by-side)
- [ ] Custom system prompt editor with syntax highlighting
- [ ] Agent scheduling (start/stop at specific times)
- [ ] Agent resource limits configuration
- [ ] Import/export agent configs (JSON/YAML)
- [ ] Agent marketplace (share agents across workspaces)

---

## 5. Chat & Conversations

### 5.1 Conversation List
**Path**: `/office/chat`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Chat | Conversation list loads |
| 2 | Filter by type | All/Direct/Meetings/Groups tabs |
| 3 | Search conversations | Filter by title or agent name |
| 4 | Click "New Chat" | Agent picker prompt, creates conversation |
| 5 | Click conversation | Opens chat detail view |
| 6 | Delete conversation | Confirmation, then removed from list |

### 5.2 Real-time Chat
**Path**: `/office/chat/{conversationId}`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Open conversation | Message history loads |
| 2 | Type message | Input field captures text |
| 3 | Press Enter or click Send | Message appears in thread |
| 4 | Agent responds | Streaming dots → text appears progressively |
| 5 | Agent shows code block | Syntax-highlighted code with copy button |
| 6 | Agent shows action buttons | Clickable buttons for approvals, task acceptance |
| 7 | Click action button | Triggers API call, shows result |

### 5.3 Meetings
**Path**: `/office/meetings`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Meetings | Meeting grid loads |
| 2 | Click "New Meeting" | Modal with title + agent multi-select |
| 3 | Select agents | Agents added to participant list |
| 4 | Click "Start Meeting" | Meeting created, opens in chat view |
| 5 | Chat in meeting | All participants see messages |

### UX Tests — Chat
- [ ] New conversation creates and opens correctly
- [ ] Message sends and appears in thread
- [ ] Agent streaming response shows dots → progressive text
- [ ] Markdown renders correctly (headers, lists, bold, links)
- [ ] Code blocks have syntax highlighting
- [ ] Action buttons trigger correct behavior
- [ ] WebSocket connection established (check console)
- [ ] Conversation persists after page reload
- [ ] Delete conversation with confirmation
- [ ] Empty state when no conversations
- [ ] Mobile: input stays above keyboard
- [ ] Mobile: action pills scroll horizontally
- [ ] Meeting creation with multiple agents
- [ ] Long messages don't break layout

### Future Improvements — Chat
- [ ] Message editing (edit sent messages)
- [ ] Message reactions (emoji reactions)
- [ ] File attachments (upload images, docs)
- [ ] Voice messages (record and send)
- [ ] Chat search (search within conversation)
- [ ] Message threading (reply to specific messages)
- [ ] Typing indicators (agent/user typing)
- [ ] Read receipts
- [ ] Pin important messages
- [ ] Export conversation as Markdown/PDF
- [ ] Multi-agent roundtable discussions
- [ ] Conversation forking (branch from a point)
- [ ] Slash commands in chat (/task, /approve, /search)

---

## 6. Approvals

### 6.1 Approval Queue
**Path**: `/office/approvals`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Approvals | Queue loads with pending items |
| 2 | Filter by status | Pending/Approved/Rejected/Changes Requested |
| 3 | Click approval card | Navigate to detail view |

### 6.2 Approval Review
**Path**: `/office/approvals/{id}`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Open approval | Full details load (reasoning, changes, risk, permissions) |
| 2 | Review reasoning points | Checkboxes for each reasoning point |
| 3 | Review proposed changes | Diff view with +/- highlighting |
| 4 | Review risk assessment | Color-coded risk level |
| 5 | Click "Approve" | Status changes, toast confirmation, return to queue |
| 6 | Click "Reject" | Status changes, toast confirmation |
| 7 | Click "Request Changes" | Comment required, status changes |

### UX Tests — Approvals
- [ ] Approval queue loads with correct counts per status
- [ ] Status filter pills work correctly
- [ ] Approval detail shows all sections (reasoning, changes, risk, permissions)
- [ ] Approve button changes status → confirmed with toast
- [ ] Reject button changes status → confirmed with toast
- [ ] Request changes requires a comment
- [ ] Audit trail shows timeline of decisions
- [ ] Risk level badge is color-coded correctly
- [ ] Empty state when no approvals
- [ ] Skeleton loader during load

### Future Improvements — Approvals
- [ ] Batch approve/reject multiple items
- [ ] Auto-approve rules (low-risk items)
- [ ] Approval delegation (assign to another user)
- [ ] Approval SLA tracking (time-to-decision)
- [ ] Approval analytics dashboard
- [ ] Email/Slack notifications for pending approvals
- [ ] Approval templates (pre-configured review criteria)
- [ ] Diff viewer with syntax highlighting for code changes

---

## 7. Projects & Tasks

### 7.1 Project Management
**Path**: `/office/projects`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Projects | Timeline or Kanban view loads |
| 2 | Toggle views | Switch between Timeline and Kanban |
| 3 | Click "New Project" | Creation modal opens |
| 4 | Fill project details | Name, goal, dates, color |
| 5 | Assign agents with RACI | R (Responsible), A (Accountable), C (Consulted), I (Informed) |
| 6 | Create project | Project appears in timeline/board |
| 7 | Kanban: drag task | Task moves between columns |
| 8 | Click task card | Task details shown |

### UX Tests — Projects
- [ ] Timeline view renders project bars correctly
- [ ] Kanban columns (Backlog, In Progress, Awaiting Approval, Completed)
- [ ] Create project with all fields
- [ ] RACI assignment — only one Accountable per task
- [ ] Priority badges render correctly (Low/Medium/High/Critical)
- [ ] Drag and drop tasks between Kanban columns
- [ ] Agent avatars on assigned tasks
- [ ] Empty state when no projects
- [ ] View toggle preserves state

### Future Improvements — Projects
- [ ] Task dependencies (Gantt chart with arrows)
- [ ] Sprint planning view
- [ ] Burndown/burnup charts
- [ ] Time tracking per task
- [ ] Task comments/discussions
- [ ] Recurring tasks
- [ ] Project templates
- [ ] Resource allocation view (agent capacity)
- [ ] Integration with external project tools (Jira, Linear)
- [ ] AI-suggested task breakdowns

---

## 8. Workspaces

### 8.1 Workspace Management
**Path**: `/office/workspaces`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Workspaces | Workspace grid loads |
| 2 | View featured workspace | Default workspace highlighted |
| 3 | Click "Enter Workspace" | Switch to that workspace's dashboard |
| 4 | Click "Create Workspace" | Modal with name, slug, description |
| 5 | Auto-slug generation | Slug auto-generated from name |
| 6 | Create workspace | New workspace appears in grid |

### UX Tests — Workspaces
- [ ] Workspace list loads with agent counts
- [ ] Featured workspace card is prominent
- [ ] Create workspace with auto-slug
- [ ] Create workspace with manual slug (override auto)
- [ ] Workspace status badges (Active)
- [ ] Enter workspace navigates to dashboard
- [ ] Empty state for new installation

### Future Improvements — Workspaces
- [ ] Workspace switching in sidebar (quick switcher)
- [ ] Workspace archiving/deletion
- [ ] Workspace duplication (clone entire setup)
- [ ] Workspace usage analytics
- [ ] Cross-workspace agent sharing
- [ ] Workspace invitation links
- [ ] Workspace-level billing/quotas

---

## 9. Integrations

### 9.1 Tool Management
**Path**: `/office/integrations`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Integrations | Tool grid loads with categories |
| 2 | Filter by category | All/Communication/Productivity/Development/Custom MCP |
| 3 | View active integrations | Status badges (Active/Needs Attention/Disconnected) |
| 4 | Click "Connect" on tool | Connection flow for that tool |
| 5 | Configure active integration | Settings panel |
| 6 | Add custom MCP server | Name + command + args form |
| 7 | Toggle individual tools | Enable/disable tools per MCP server |

### UX Tests — Integrations
- [ ] Category filter tabs work correctly
- [ ] Active integrations show correct status
- [ ] Connect a new tool (e.g., GitHub)
- [ ] Disconnect a tool
- [ ] Reconnect a failing integration
- [ ] Custom MCP server creation
- [ ] Toggle tools on/off within an MCP server
- [ ] Empty state when no integrations configured

### Future Improvements — Integrations
- [ ] OAuth flow for Slack, GitHub, Jira (actual API integration)
- [ ] Integration health monitoring
- [ ] Integration usage analytics
- [ ] MCP server auto-discovery
- [ ] Integration marketplace
- [ ] Webhook testing UI
- [ ] API key rotation reminders

---

## 10. Settings

### 10.1 Workspace Configuration
**Path**: `/office/settings`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Settings | Settings page loads |
| 2 | Add model provider | Select type, enter API key, save |
| 3 | Test provider | Connection test feedback |
| 4 | Set default provider | Star icon, used for new agents |
| 5 | Delete provider | Confirmation, removed from list |
| 6 | Edit workspace name | Inline edit, saves |
| 7 | Change theme | Dark/Light/System toggle |
| 8 | Toggle guardrails | Human-in-the-loop on/off |

### UX Tests — Settings
- [ ] Add Claude provider with API key
- [ ] Add OpenAI provider with API key
- [ ] Test provider connection → success/failure feedback
- [ ] Set default provider → star indicator
- [ ] Delete provider → confirmation → removed
- [ ] Edit workspace name → saved
- [ ] Theme toggle: Dark → Light → System
- [ ] Theme persists after page reload
- [ ] No flash of wrong theme on load
- [ ] Guardrail toggles save correctly

### Future Improvements — Settings
- [ ] Provider API key masking (show last 4 chars only)
- [ ] Provider usage statistics
- [ ] Model cost calculator
- [ ] Notification preferences (email, Slack, in-app)
- [ ] Language/locale settings
- [ ] Keyboard shortcut customization
- [ ] Data export (full workspace backup)
- [ ] Danger zone (delete workspace, transfer ownership)

---

## 11. Security

### 11.1 Security Dashboard
**Path**: `/office/security`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Security | Compliance badges + policy grid |
| 2 | Toggle security policies | Human Approval, Audit Persistence, etc. |
| 3 | View Audit Log tab | Timeline of security events |
| 4 | Filter audit events | By event type (Success/Critical/Warning) |
| 5 | View Access Control tab | Team members with roles |

### UX Tests — Security
- [ ] Compliance badges display correctly (SOC2, AES-256, TLS 1.3, RBAC)
- [ ] Policy toggles save and persist
- [ ] Audit log timeline renders events
- [ ] Audit event filtering works
- [ ] Access control shows team members with roles
- [ ] Tab switching (Policies/Audit/Access Control)
- [ ] Encryption info section shows correct algorithms

### Future Improvements — Security
- [ ] Real audit log from backend (currently mock data)
- [ ] Role-based access control management (add/remove roles)
- [ ] API key management with rotation
- [ ] IP allowlisting
- [ ] Two-factor authentication (2FA)
- [ ] Security alerts (unusual activity detection)
- [ ] Compliance report generation
- [ ] Data retention policy configuration

---

## 12. Logs & Notifications

### 12.1 Activity Logs
**Path**: `/office/logs`

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to Logs | Timeline + notifications load |
| 2 | Filter by actor type | User/Agent/System |
| 3 | Filter by event type | Success/Modification/Critical/Warning/Info |
| 4 | Search logs | Text search across log entries |
| 5 | View notifications | Notification cards with actions |
| 6 | Mark notification as read | Badge clears |

### UX Tests — Logs
- [ ] Activity timeline renders events with colored dots
- [ ] Actor type filter works (User/Agent/System)
- [ ] Event type filter works
- [ ] Search filters log entries
- [ ] Notifications panel shows items with actions
- [ ] Mark as read updates notification state
- [ ] Empty states for filtered results

### Future Improvements — Logs
- [ ] Real-time log streaming (WebSocket)
- [ ] Log export (CSV/JSON)
- [ ] Log retention settings
- [ ] Log aggregation across workspaces
- [ ] Alert rules (notify on specific patterns)
- [ ] Log visualization (charts, graphs)
- [ ] Integration with external logging (Datadog, Grafana)

---

## Cross-Cutting UX Tests

### Responsive Design
- [ ] All pages render correctly at 375px width (mobile)
- [ ] All pages render correctly at 768px width (tablet)
- [ ] All pages render correctly at 1440px+ width (desktop)
- [ ] Sidebar collapses to hamburger on mobile
- [ ] Hamburger menu opens/closes sidebar
- [ ] Sidebar auto-closes when nav link clicked (mobile)

### Theme
- [ ] Dark mode: all pages readable, no white flashes
- [ ] Light mode: all pages readable, proper contrast
- [ ] System mode: matches OS preference
- [ ] Theme switch is instant (no page reload)
- [ ] Theme persists across sessions

### Loading & Error States
- [ ] Every page shows skeleton loaders during data fetch
- [ ] Failed API calls show toast error (not silent failure)
- [ ] Error boundary catches React crashes with retry button
- [ ] Offline: appropriate feedback shown

### Navigation
- [ ] All sidebar links navigate to correct pages
- [ ] Browser back/forward works correctly
- [ ] Deep links work (share a URL, open it, see correct page)
- [ ] Active nav item highlighted in sidebar

### Accessibility
- [ ] Tab through all interactive elements
- [ ] Screen reader announces page changes
- [ ] Form errors announced by screen reader
- [ ] Modals trap focus
- [ ] Escape key closes modals

---

## Feature Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Google/GitHub OAuth | High | Medium | P1 |
| Real-time WebSocket updates | High | Medium | P1 |
| File attachments in chat | High | Medium | P1 |
| Agent cloning | Medium | Low | P1 |
| Chat search | Medium | Low | P1 |
| Typing indicators | Medium | Low | P2 |
| Task dependencies (Gantt) | Medium | High | P2 |
| Workspace quick-switcher | Medium | Low | P2 |
| Notification center | Medium | Medium | P2 |
| Agent marketplace | High | High | P3 |
| Sprint planning | Medium | High | P3 |
| AI-suggested task breakdowns | High | High | P3 |
| Voice messages | Low | High | P3 |
| Compliance reports | Medium | Medium | P3 |

---

*Last updated: 2026-03-27*
