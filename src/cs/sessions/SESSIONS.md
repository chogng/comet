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
- session and chat membership, including main, peer, fork, and worker chats;
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
├── mainChat: IObservable<IChat>
├── chats: IObservable<readonly IChat[]>
├── capabilities: IObservable<ISessionCapabilities>
└── session-level observables
```

Consumers use the shared contract and never reach into a provider
implementation or backend client.

A session is defined by its shared agent working context, not by the number of
chats it currently contains. Every session has exactly one `mainChat`. A normal
single-agent session exposes only that chat. Additional chats exist only when
the provider reports a supported peer, fork, or Multi-Agent worker flow.

The product-wide new-conversation action creates a new session. Creating a peer
chat inside an existing session is a distinct, capability-gated operation. A
shared provider or workspace alone never turns independent user conversations
into chats of one session.

### `IChat`

An `IChat` is one conversation stream inside a session. The `mainChat` is the
session's canonical user conversation. Additional chats are separate streams
that share the session's workspace and runtime while retaining independent
identity, title, turns, model selection, status, and interactivity.

Every additional chat declares its origin; the main chat may omit origin or use
`User`:

- `User` — a user-created peer chat;
- `Fork` — a branch created from a specific turn of a parent chat;
- `Tool` — a worker chat created by an agent or tool for a subagent.

```text
IChat
├── resource
├── origin?: IChatOrigin
│   ├── kind: User | Fork | Tool
│   └── parentChat?: URI
└── chat-level observables
```

Fork and Tool origins identify their `parentChat`. A Tool-origin chat is the
execution record of a child agent, not another participant mixed into the
parent transcript. Worker chats are normally read-only or hidden and surface
as a separate view only when the user explicitly opens them.

The main chat is always part of `chats`. Additional chats retain provider order
unless a product-level ordering rule explicitly says otherwise. Shared code
must not manufacture additional chats by grouping unrelated conversations.

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
guarantee. `supportsMultipleChats` gates user-created peer chats, and
`supportsFork` gates chat forks. Other capabilities cover rename, changes,
and models. Capabilities are observable when they can change after provider
registration or session hydration. They describe operations available now;
they do not invalidate peer, fork, or worker chats already reported by the
provider.

UI availability is derived from capabilities. UI and shared services do not
branch on a provider ID or session type to choose provider-specific behavior.
The new-peer-chat action requires the multiple-chat capability, and the fork
action requires both the multiple-chat and fork capabilities. Tool-origin
worker chats are authoritative provider state rather than a user-created
operation and are surfaced according to their interactivity and origin.

### Chat interactivity

Chat interactivity is provider-agnostic:

- `Full` — visible and accepts user input;
- `ReadOnly` — visible but does not expose mutating input or actions;
- `Hidden` — retained in the model but not surfaced by the Sessions Part.

The view service filters hidden chats before selection. The chat view enforces
read-only behavior before rendering an input. The provider reports
interactivity and origin but does not manipulate UI.

The main chat is always `Full` or `ReadOnly`; it is never `Hidden`. Otherwise a
session would have no deterministic visible chat when opened.

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

Provider implementations are contributions because they connect optional
compute backends and session types. Only those implementations live under
`src/cs/sessions/contrib/providers/`; the Sessions domain, aggregation,
lifecycle, and view-facing state remain Sessions services.

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
├── activeChat: IObservable<IChat>
├── openChats: IObservable<readonly IChat[]>
├── closedChats: IObservable<readonly IChat[]>
├── visibleChatTabs: IObservable<readonly IChat[]>
└── sticky: IObservable<boolean>
```

`activeChat` is scoped to its owning visible session. It is not a second domain
relationship and is not stored by the provider or management service. The
`mainChat` cannot be closed or deleted independently from its session.

Single-chat sessions keep `activeChat === mainChat` and do not show chat tabs.
Tool-origin worker chats stay out of the normal tab strip until explicitly
opened. Closing a worker tab hides its view; it does not delete the provider's
worker execution record.

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
| session chat membership and main chat | per-session active and open chats |
| draft creation and disposal | open, close, focus, and navigation |
| send and CRUD routing | session-scoped view state |
| provider reconciliation | active-session context keys |
| recency and domain preferences | presentation reaction to explicit replacement |

There is one canonical owner for each state. Do not mirror active session state
inside the management service or provider registry.

## Data flow

### Provider registration

```text
Sessions provider contribution
    → creates provider
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
    → select the restored visible chat or mainChat
    → ISessionsPartService reconciles the mounted slots
    → focus only when the request does not preserve focus
```

An action carries the originating session context. It must not assume that the
globally active session is the action target.

### Rendering the selected chat

```text
IActiveSession.activeChat changes for a visible session
    → that session view selects its chat host
    → IChatViewFactory creates or reuses a contributed ChatView
    → ChatView loads the addressed IChat resource
    → Chat contribution renders the transcript and permitted input
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
    → user sends the first request
    → management service routes the request to the owning provider
    → provider commits or explicitly replaces the draft
    → management and view services reconcile the committed identity atomically
```

A draft-to-committed transition is explicit. Session selection, input history,
view state, and provider ownership move with that transition in one operation.
Do not recover a missing replacement signal by guessing from titles, folders,
or recently created sessions.

### Sending to an existing chat

```text
chat input
    → managementService.sendRequest(session, chat, request)
    → resolve the provider from session ownership
    → provider sends on the addressed chat
    → provider updates chat/session observables
    → services reconcile state
    → ISessionsService and ISessionsPartService reconcile presentation
```

Every request addresses both a session and a chat. Multi-chat providers must
not route a peer-chat request through the main chat as a fallback.

For a single-chat session, callers address `session.mainChat`. A Tool-origin
worker chat accepts a request only when its interactivity and provider contract
allow it; read-only worker transcripts never expose a send operation.

### Provider change propagation

```text
backend change
    → provider updates its session model observables
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
| backend session and chat records | provider |
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
- Session identity is globally unique across providers.
- Every session has one main chat, and `mainChat` is always a member of
  `chats`.
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
- Providers do not import Sessions UI, Parts, or shell layout.
- Provider-internal services, protocol models, caches, and backend clients stay
  inside their provider contribution. Shared services and non-provider
  contributions consume only `ISession`, `IChat`, capabilities, and the
  provider-agnostic management contracts.
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

## Adding a provider

1. Implement the provider contract with a stable provider ID.
2. Implement provider-agnostic `ISession` and `IChat` models backed by
   observables.
3. Provide exactly one main chat and include it in the session's chat
   collection.
4. Add peer, fork, or Tool-origin worker chats only when the backend exposes
   the corresponding behavior, origin, parent relationship, and
   interactivity.
5. Declare truthful capabilities and explicit unsupported operations.
6. Place the implementation under
   `src/cs/sessions/contrib/providers/<provider>/`.
7. Register it through a Sessions contribution and immediately register all
   created disposables.
8. Publish every added, removed, changed, and replaced session transition.
9. Add contract tests for identity, lifecycle, request routing, and disposal.
10. Add integration tests only for behavior that requires the real backend.

## Related documents

- [Sessions application overview](README.md)
- [Sessions application layout](LAYOUT.md)
- [Sessions layer rules](LAYERS.md)
