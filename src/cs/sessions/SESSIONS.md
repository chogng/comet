# Sessions architecture

## Overview

The Sessions application coordinates the complete lifecycle of agent working
sessions and owns Comet's product shell. The Sessions Part is one presentation
surface of this application; it is not the Sessions architecture by itself.

```text
Sessions application
├── product shell, layout, and core Parts
├── ISessionsProvidersService ← provider contributions
├── ISessionsManagementService
│   ├── session and chat domain models
│   ├── provider routing and lifecycle
│   └── recency and domain persistence
├── supporting session services
│   └── workspace, runtime, changes, tasks, terminals, groups, references
├── ISessionsService
│   └── visible-session arrangement and navigation
├── ISessionsPartService
│   └── passive Part reconciliation and focus bridge
└── integration boundaries
    ├── Chat
    ├── Editor
    └── Sessions layout

Sessions Chat contribution
    → IChatViewFactory implementation
    → Workbench Chat contribution
    → single-chat view hosted by the Sessions Part
```

The provider registry, management model, view-facing model, and Sessions-owned
Part, Chat, and layout contracts live in the Sessions service layer. Editor
integration consumes public contracts owned by Workbench Editor. Backend
implementations and feature integrations live in Sessions contributions. The
application consumes the lower Workbench foundation, while Workbench never
imports Sessions.

## Subsystem ownership

Sessions owns the cross-cutting agent working context:

- global session identity, provider ownership, session type, and capabilities;
- session and chat membership, including user-created, peer, forked, and
  tool-origin worker Chats without a privileged Chat role;
- draft creation, commit/replacement, archive, delete, rename, and restoration;
- routing requests and mutations to the provider that owns the session;
- workspace and runtime association, changesets, external changes, task and
  terminal association, recency, groups, and session references;
- visible-session arrangement, active-session selection, navigation, focus,
  and per-session presentation persistence;
- typed integration boundaries for Chat, Editor, Sessions layout, and other
  contributions.

Sessions owns the product shell but does not own reusable Workbench editor
models, concrete editor panes, or the implementation of a single conversation
transcript.

### Sessions and Chat

Sessions and Chat have different scopes:

| Sessions subsystem | Chat contribution |
|---|---|
| owns the collection and lifecycle of agent sessions | owns one conversation model and its interaction surface |
| groups chats by shared provider runtime and workspace | renders turns, input, responses, attachments, and per-chat actions |
| routes operations to the owning provider | loads and operates on the addressed chat resource |
| owns active session and per-session active-chat view state | does not own the global session collection or active session |
| aggregates session status, changes, recency, and persistence | exposes chat-level status and events consumed by the session model |

The Workbench Chat contribution remains independently usable by other
Workbench features. `src/cs/sessions/contrib/chat/` integrates it with the
Sessions Part through a typed factory contract rather than absorbing Chat
widgets or transcript state into Sessions core.

### Sessions and Agent Host

Agent Host is Comet's common execution boundary for Agent SDKs. Sessions sees
one `ISessionsProvider` per local or remote Host connection. The provider maps
the Host's canonical Session and Chat catalogs into provider-independent
`ISession` and `IChat` models.

```text
ISessionsManagementService
    → AgentHostSessionsProvider
    → IAgentHostConnection
    → Agent Host runtime
    → CometAgent / CopilotAgent / ClaudeAgent / CodexAgent
```

Local and remote are Host placements, not Agent identities. The built-in
`CometAgent` has stable Agent ID `comet`. Agent implementations own SDK calls,
SDK event conversion, capabilities, and opaque resume data; they never import
Sessions or Workbench Chat. See [Agent Host architecture](AGENT_HOST.md).

## Core contracts

### `ISession`

An `ISession` is a stable, provider-agnostic model for one agent working
context. It has a globally unique identity, identifies its provider and session
type, and owns the chats that execute inside the same workspace and runtime.

```text
ISession
├── sessionId
├── resource
├── providerId
├── sessionType
├── workspace
├── chats: IObservable<readonly IChat[]>
├── capabilities: IObservable<ISessionCapabilities>
└── session-level observables
```

Consumers use the shared contract and never reach into a provider
implementation or backend client.

A session is defined by its shared agent working context, not by the number of
Chats it currently contains. Its ordered `chats` collection may be empty and
contains no distinguished first, primary, main, or default Chat. A Chat created
in the same transaction as a Session becomes an ordinary catalog member after
commit.

The product-wide new-conversation action creates a new session. Creating a peer
chat inside an existing session is a distinct, capability-gated operation. A
shared provider or workspace alone never turns independent user conversations
into chats of one session.

### `IChat`

An `IChat` is one conversation stream inside a session. All Chats share the
session's workspace and runtime while retaining independent identity, title,
turns, model selection, status, capabilities, and interactivity. Routing always
uses the addressed Chat identity; catalog order does not confer a role.

Every Chat declares its origin:

- `User` — a user-facing Chat created by the user or product workflow;
- `Fork` — a branch created from a specific turn of a parent chat;
- `Tool` — a worker chat created by an agent or tool for a subagent.

```text
IChat
├── resource
├── origin: IChatOrigin
│   ├── kind: User | Fork | Tool
│   └── parentChat?: URI
└── chat-level observables
```

Fork and Tool origins identify their `parentChat`. A Tool-origin chat is the
execution record of a child agent, not another participant mixed into the
parent transcript. Worker chats are normally read-only or hidden and surface
as a separate view only when the user explicitly opens them.

Chats retain provider order unless a product-level ordering rule explicitly
says otherwise. Shared code must not manufacture Chats by grouping unrelated
conversations or infer a canonical Chat from catalog position.

### Session and chat state

Session-level state is either intrinsic to the shared working context or
explicitly aggregated from its chats:

- workspace, provider, session type, and capabilities belong to the session;
- conversation title, turns, model, and interactivity belong to a chat;
- session activity time is the latest activity across its chats;
- session read state is read only when all chats are read;
- session status aggregation uses one documented priority order rather than DOM
  state or the currently selected chat.

Session title and chat title are independent concepts. A single-chat provider
may intentionally present the same value for both, but shared UI and services
must not assume they are identical.

### Workspace

A session workspace contains zero or more folders and the repository metadata
needed by the agent runtime. A session without a workspace is a valid
workspace-less session, not an error state.

Workspace absence must be represented explicitly by the session contract. Do
not infer it from a temporarily unresolved folder, editor state, or provider
identity. Workspace state distinguishes `Resolving`, `Workspace`, and
`WorkspaceLess`; new-session creation accepts only either resolved state.
Workspace-less creation support belongs to the provider-owned session type so
the new-session UI can gate the operation before it creates a draft.

### Capabilities

`ISessionCapabilities` describes behavior that the active provider can
guarantee. `supportsCreateChat` gates user-created Chats, and `supportsFork`
gates Chat forks. A Host with a Chat count limit declares that limit explicitly
rather than encoding capacity as a special first Chat. Other capabilities cover
rename, changes, and models. Capabilities are observable when they can change
after provider registration or Session hydration. They describe operations
available now; they do not invalidate User, Fork, or Tool Chats already
reported by the provider.

UI availability is derived from capabilities. UI and shared services do not
branch on a provider ID or session type to choose provider-specific behavior.
The new-Chat action requires the create capability and available capacity, and
the fork action requires the fork capability. Tool-origin worker Chats are
authoritative provider state rather than a user-created operation and are
surfaced according to their interactivity and origin.

### Chat interactivity

Chat interactivity is provider-agnostic:

- `Full` — visible and accepts user input;
- `ReadOnly` — visible but does not expose mutating input or actions;
- `Hidden` — retained in the model but not surfaced by the Sessions Part.

The view service filters hidden chats before selection. The chat view enforces
read-only behavior before rendering an input. The provider reports
interactivity and origin but does not manipulate UI.

A Session may have no visible Chat because its catalog is empty or all of its
Chats are hidden. That state is represented explicitly; selection code does not
substitute the first Chat or manufacture a visible Chat.

## Services

### `ISessionsProvidersService`

The provider service is a pure registry:

- register and unregister providers;
- look up a provider by stable ID;
- coordinate one authoritative management participant for registry mutations;
- expose committed provider registration changes to ordinary observers;
- dispose provider registrations with their owning contribution.

It does not aggregate sessions, select an active session, mutate layout, or
render UI.

Each dynamic registry mutation is prepared by the management participant,
committed to both owners, and then published to ordinary observers. An invalid
provider never enters the registry, and an observer failure cannot interrupt a
committed registry or management transition.

Agent Host provider instances are contributions because they connect local and
remote Host endpoints to Sessions. One shared implementation serves every Host
connection. Agent SDK integrations register inside the Platform Agent Host
runtime and never implement a direct Sessions provider. The Sessions domain,
aggregation, lifecycle, and view-facing state remain Sessions services.

### `ISessionsManagementService`

The management service owns the domain and orchestration model:

- aggregate sessions from registered providers;
- create and discard new-session drafts;
- route create, send, rename, archive, delete, and chat operations;
- maintain recency and provider-agnostic preferences;
- reconcile provider additions, removals, changes, and explicit replacements;
- expose observable session collections and lifecycle state.

It does not own the active visible session, focus, navigation, Part visibility,
or Editor layout.

Provider collection events contain ordered, discriminated transitions. A
draft-to-committed replacement is one atomic transition from one model to the
other, emitted after `getSessions()` reflects the committed state; consumers
do not correlate overlapping added and removed arrays to infer replacement.

### Supporting session services

Sessions is not implemented as one god service. Independent state and
lifecycle use focused services for concerns such as session workspaces,
terminals, task execution, groups, references, list models, and Part bridging.
These services consume `ISession` identities and provider-agnostic contracts;
they do not reach into a provider implementation or concrete UI.

The management service remains the owner of provider aggregation and domain
operations. Supporting services do not mirror its session collection or create
parallel active-session state.

### `IActiveSession`

`IActiveSession` is the view model for one visible `ISession`. It adds only
presentation state:

```text
IActiveSession
├── session model fields from ISession
├── activeChat: IObservable<IChat | undefined>
├── openChats: IObservable<readonly IChat[]>
├── closedChats: IObservable<readonly IChat[]>
├── visibleChatTabs: IObservable<readonly IChat[]>
└── sticky: IObservable<boolean>
```

`activeChat` is scoped to its owning visible session. It is not a second domain
relationship and is not stored by the provider or management service. Closing
a Chat removes only its view. Deleting a Chat is a separate provider operation
gated by that Chat's capability; the first and last Chat receive no exception.

A visible Session with one open user Chat does not show a chat tab strip.
Tool-origin worker Chats stay out of the normal tab strip until explicitly
opened. Closing a worker tab hides its view; it does not delete the provider's
worker execution record. When the active Chat closes or disappears,
`activeChat` becomes `undefined` unless the same authoritative transition
explicitly selects another Chat.

### `ISessionsService`

The view-facing service owns session presentation state:

- `visibleSessions`: ordered slots containing an `IActiveSession` or one
  explicit empty new-session placeholder;
- `activeSession`: the focused visible session, or `undefined` when the empty
  new-session placeholder is active;
- sticky session slots that are preserved when a non-sticky slot is replaced;
- per-visible-session active, open, and closed chat state through
  `IActiveSession`;
- opening and closing sessions and chats;
- focus requests for the Sessions Part;
- session navigation history;
- session-scoped view state that must survive rerender or reload;
- active-session context keys derived from its observables.

It calls the management service for domain operations and the Sessions layout
owner for semantic reveal requests. It does not implement provider behavior or
render Part DOM. It drives the passive Sessions Part through
`ISessionsPartService` and promotes Part focus events back into canonical
`activeSession` state.

### `ISessionsPartService`

`ISessionsPartService` is the browser-only bridge between the view-facing
service and the mounted Sessions Part. Its contract is deliberately narrow:

- reconcile the mounted slots from `visibleSessions` and `activeSession`;
- focus the slot for an `IActiveSession` or the new-session placeholder;
- report which mounted slot received user focus;
- expose only other Part-level operations that cannot be represented as
  session or layout state.

The core Sessions Part implements this service. The interface contains no
concrete `SessionView`, DOM node, Chat widget, or contribution type. Feature
contributions express semantic actions through Sessions services instead of
obtaining a concrete view and invoking its internals.

```text
ISessionsService
    → ISessionsPartService.updateVisibleSessions(...)
    → passive Sessions Part

Sessions Part focus event
    → ISessionsPartService
    → ISessionsService sets activeSession
```

### `IChatViewFactory`

`IChatViewFactory` is the UI integration boundary between Sessions core and the
reusable Workbench Chat contribution. The interface belongs to the Sessions
service layer because the Sessions Part consumes it. The concrete implementation
belongs to `src/cs/sessions/contrib/chat/` and creates a Sessions chat view from
the Workbench Chat model and widget.

```text
Sessions Part
    → IChatViewFactory
    → Sessions ChatView
    → Workbench ChatWidget / single-chat services
```

The factory creates both the new-session composer view and the view for an
existing addressed chat. Both implement a Sessions-owned view contract for
DOM attachment, session/chat input, layout, focus, and disposal. That contract
contains no Chat widget implementation types.

The Part supplies the selected `IChat` and session context to the created view.
The contributed view loads that chat resource, applies its interactivity, and
owns transcript, composer, voice, attachment, and per-turn presentation.
Chat-scoped input and actions reach typed Sessions management operations through
the contributed view with the same explicit session and chat identity; neither
the Workbench Chat widget nor a callback aggregate performs Sessions routing.

The product entry point registers exactly one `IChatViewFactory`
implementation. Missing registration is a product composition error; Sessions
does not instantiate a substitute view or fall back to a second rendering
path.

### Model and view ownership

| Management model | View-facing model |
|---|---|
| providers and session collection | active visible session |
| session chat membership and ordering | per-session active and open chats |
| draft creation and disposal | open, close, focus, and navigation |
| send and CRUD routing | session-scoped view state |
| provider reconciliation | active-session context keys |
| recency and domain preferences | presentation reaction to explicit replacement |

There is one canonical owner for each state. Do not mirror active session state
inside the management service or provider registry.

## Data flow

### Provider registration

```text
local or remote Agent Host contribution
    → establishes one IAgentHostConnection
    → creates one shared AgentHostSessionsProvider
    → ISessionsProvidersService.registerProvider(provider)
    → management service prepares and commits the aggregate transition
    → registry publishes the committed change to ordinary observers
    → provider sessions enter the aggregate model
```

Registration returns a disposable. Disposing the contribution unregisters and
disposes the provider and removes its sessions through the normal observable
flow.

### Opening an existing session

```text
command, list, or resource opener
    → ISessionsService.openSession(sessionId, options)
    → resolve the session through the management service
    → create or restore its IActiveSession view model
    → insert or replace it in the requested visible-session slot
    → set the canonical active visible session
    → restore the exact persisted visible Chat when it is still available
    → otherwise leave activeChat undefined
    → ISessionsPartService reconciles the mounted slots
    → focus only when the request does not preserve focus
```

An action carries the originating session context. It must not assume that the
globally active session is the action target.

### Rendering the selected chat

```text
IActiveSession.activeChat changes for a visible session
    → when defined, that session view selects its chat host
        → IChatViewFactory creates or reuses a contributed ChatView
        → ChatView loads the addressed IChat resource
        → Chat contribution renders the transcript and permitted input
    → when undefined, the session view renders its explicit no-Chat state
```

Sessions owns visible-session placement, selection, and chat-host placement.
Chat owns the concrete conversation view. The Part and session services do not
import `ChatWidget` or inspect its DOM.

### Creating and committing a session

```text
new-session action
    → ISessionsService.openNewSession(options)
    → management service asks the selected provider for a draft
    → view service activates the draft
    → user submits one captured composer revision
    → management service routes the submission to the owning provider
    → provider prepares every attachment under the stable submission ID
    → Host reserves Session, ordinary User Chat, and Turn identities
    → provider binds prepared content to those reserved identities
    → Host atomically commits the Session, Chat, and normalized initial Turn
      through the common Session, Chat, and Turn contracts
    → provider replaces the product draft and consumes its captured composer
      only after Host acceptance
    → management and view services reconcile the committed identity atomically
```

A draft-to-committed transition is explicit. Session selection, input history,
view state, and provider ownership move with that transition in one operation.
Do not recover a missing replacement signal by guessing from titles, folders,
or recently created sessions.

Attachment preparation failure or cancellation occurs before Host Session
creation and leaves the product draft and composer unchanged. Preparation uses
the selected Host connection, Agent descriptor, and submission ID; it does not
require a fabricated or published Host Session or Chat identity. The Host
reserves canonical identities inside the create operation so content can bind
before the Session, Chat, and Turn are committed. Failure in any pre-commit
step publishes no partial or empty Session.

### Sending to an existing chat

```text
send action in the addressed Chat view
    → managementService.sendRequest(session, chat)
    → resolve the provider from session ownership
    → provider begins the addressed Chat submission transaction
    → capture prompt, attachments, interaction targets, and Tool policy
    → prepare attachments
    → Host prepares one exact Tool-set revision for the submission
    → validate and digest the common request snapshot
    → provider routes the prepared addressed request to its Host connection
    → Host accepts and commits the canonical user turn and request snapshot
    → Host routes the committed request to the owning Agent
    → Host publishes committed turn and lifecycle state
    → provider updates the addressed Chat model and Session observables
    → services reconcile state
    → ISessionsService and ISessionsPartService reconcile presentation
```

Every request addresses both a Session and a Chat. A provider must not redirect
a request to the first, most recent, visible, or otherwise inferred Chat.

Sessions management and provider contracts do not carry prompt or attachment
DTOs. The addressed Workbench Chat model is the only composer and request-
scoped interaction-target owner; the owning provider obtains its immutable
submission snapshot through Chat's common API. The Sessions Chat view never
rebuilds attachment or target state at the send boundary.

For a single-Chat Session, callers still address that exact Chat identity. A
Tool-origin worker Chat accepts a request only when its interactivity and
provider contract allow it; read-only worker transcripts never expose a send
operation.

### Provider change propagation

```text
Agent or Host state change
    → Host commits an ordered state transition
    → provider updates its Session and Chat model observables
    → provider publishes added, removed, changed, or replaced identities
    → management service reconciles the aggregate collection
    → view service reconciles active presentation state
    → ISessionsService and ISessionsPartService reconcile presentation
```

Provider notifications are authoritative. Reconciliation preserves stable
model identity when the provider reports an update and performs an explicit
replacement only when the provider reports a replacement.

### Opening session content in the Editor

```text
session action
    → resource or typed EditorInput
    → IEditorService.openEditor(...)
    → IEditorResolverService resolves the resource when needed
    → IEditorGroupsService opens and activates the typed input
    → Sessions Editor Part hosts the Workbench group presentation
    → the group-owned Pane host renders the matching pane
    → editor-host contract asks ISessionsLayoutService to reveal the Editor slot
```

Session features open content through editor services and do not inspect Editor
DOM or instantiate panes. The Sessions shell alone composes the concrete
Sessions Editor Part.

## State and persistence

Persistence follows ownership:

| State | Owner |
|---|---|
| Host, Agent, Session, and Chat identity and catalogs | Agent Host runtime |
| SDK resume data and private event history | addressed Agent |
| loaded conversation model, transcript, and composer state | Workbench Chat contribution |
| Sessions-specific concrete chat view | Sessions Chat contribution |
| provider registry | Sessions provider contributions and provider service |
| aggregate session metadata and recency | management service |
| visible slots, sticky state, active session, and navigation | view-facing service |
| active/open/closed chats for each visible session | `IActiveSession` view model |
| mounted session slots and DOM focus realization | Sessions Part through `ISessionsPartService` |
| session-scoped prompt history | session service keyed by stable session identity |
| Part visibility and column sizes | Sessions layout owner |
| open editor inputs, groups, tabs, and active editor | Editor group services and models |
| editor tabs, Pane hosting, presentation, and view state | Workbench editor groups and panes |
| mounted Editor chrome, group placement, and application layout integration | Sessions Editor Part |

Restoration must hydrate the owning model and let consumers react. It must not
reconstruct state by reading DOM, context keys, or sibling Part internals.

## Part contract

The Sessions Part is a passive session host and interaction surface. It:

- receives authoritative visible and active state through
  `ISessionsPartService`;
- renders session chrome, ordered visible-session placement, and chat-host
  slots;
- obtains concrete chat views through `IChatViewFactory`;
- reports focus through `ISessionsPartService` and user intent through typed
  Sessions services;
- scopes action context to the session or chat that originated the action;
- disposes owned hosts, contributed views, listeners, and scoped context keys
  with the Part.

The Part does not aggregate providers, implement transcript or composer UI, own
the canonical visible-session arrangement, expose concrete session views, own
the application layout, or create sibling Parts. See [LAYOUT.md](LAYOUT.md) for
its visual contract.

## Provider contract rules

- Provider identity is stable and globally unique within the registry.
- One Agent Host connection maps to one provider instance.
- Local and remote identify Host placement; Agent identity remains independent
  of placement.
- `CometAgent` is the built-in Agent and has stable Agent ID `comet`.
- Session identity is globally unique across providers.
- A Session owns zero or more equal-status Chats. `ISession` has no
  distinguished Chat field, and catalog position never controls routing,
  closing, or deletion.
- Unrelated user conversations are separate sessions; providers do not group
  them merely because they share a provider or workspace.
- Core provider operations are required, not optional convenience methods.
- Optional feature families use explicit capabilities and coherent typed
  contracts; call sites do not probe for methods and fall back.
- Unsupported operations fail explicitly and are not offered by the UI.
- Providers update observable session and chat models and publish authoritative
  collection changes for every lifecycle transition.
- Providers dispose backend subscriptions and owned chat/session model resources
  when their registrations or sessions are removed.
- Providers may use public Workbench Chat contracts needed to connect a backend
  chat resource, but never import concrete Chat widgets or UI.
- `IChatService` owns addressed Chat models only. It does not create product
  Sessions, choose an Agent, or own backend lifecycle.
- Agent implementations enter Sessions only through Agent Host and never
  register a direct `ISessionsProvider`.
- Providers do not import Sessions UI, Parts, or shell layout.
- Host protocol models and Agent backend clients stay in Platform Agent Host.
  Provider connection state and Host-to-Sessions mapping stay in the Agent Host
  provider contribution. Shared services and non-provider contributions
  consume only `ISession`, `IChat`, capabilities, and provider-agnostic
  management contracts.
- When a provider needs to react to a shared signal such as visibility, the
  shared service exposes that provider-agnostic signal and the provider
  subscribes internally. Shared code does not import a provider service to
  trigger provider-specific loading or lifecycle.

## Interface design rules

### Shared interfaces are consumer-driven

A member belongs on `ISession`, `IChat`, or `ISessionsProvider` only when a
provider-agnostic service or UI consumer needs it. Provider-internal state stays
on the provider implementation.

### Context keys are outputs

Context keys gate declarative menus, commands, and keybindings. Imperative code
reads the owning service or observable directly and never reads a context key as
runtime state.

### Capabilities replace provider branching

Shared code does not contain provider-ID or session-type conditionals for
provider-specific behavior. A provider exposes a capability or typed
presentation decision through the shared contract.

### Commands carry context

Session and chat actions resolve the invocation's supplied session and, when
applicable, chat. They do not silently redirect to the currently active session
or its active chat, and collection actions support multi-selection where the
surface exposes it.

### State changes are observable

Observable state drives rendering and session switching. Events represent
collection membership or one-time lifecycle notifications; they are not used as
an alternative mutable source of truth.

## Adding Agent execution

Add a new Agent SDK by implementing the Host-side `IAgent` contract under
`src/cs/platform/agentHost/node/agents/<agent>/`. Register it with the Agent
Host runtime, declare truthful capabilities, and keep every SDK type, client,
cache, event conversion, and resume value inside that implementation. Do not
add a Sessions provider or Chat view for an Agent.

Add a new Host placement or transport by implementing `IAgentHostConnection`.
Register one shared `AgentHostSessionsProvider` for each stable connection.
Connection code owns transport, authentication, reconnection, and resource
mapping; it does not duplicate Session or Chat models or branch on Agent IDs.

The complete contracts and verification requirements are defined in
[AGENT_HOST.md](AGENT_HOST.md). Composer and submitted context contracts are
defined in [ATTACHMENTS.md](ATTACHMENTS.md). Client-owned operations and lazy
interaction targets that are exposed to an Agent use model-facing Tools with
explicit executor bindings and are defined in
[CLIENT_TOOLS.md](CLIENT_TOOLS.md).

## Related documents

- [Sessions application overview](README.md)
- [Agent Host architecture](AGENT_HOST.md)
- [Attachment architecture](ATTACHMENTS.md)
- [Tool and Client Tool architecture](CLIENT_TOOLS.md)
- [Sessions application layout](LAYOUT.md)
- [Sessions layer rules](LAYERS.md)
