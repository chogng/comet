# Sessions architecture

## Overview

The Sessions Part is backed by a provider-agnostic session model. Providers
integrate agent runtimes, model services aggregate and route session operations,
and a view-facing service selects what the Sessions Part presents.

```text
Sessions Part
    ↓
ISessionsService
    ↓
ISessionsManagementService
    ↓
ISessionsProvidersService
    ↑
ISessionsProvider implementations
```

All three services live inside the Comet Workbench service layer; the Sessions
Part consumes their public contracts.

## Core contracts

### `ISession`

An `ISession` is a stable, provider-agnostic facade for one agent working
context. It has a globally unique identity, identifies its provider and session
type, and exposes observable session state.

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

Consumers use the shared facade and never reach into a provider adapter or
backend client.

### `IChat`

An `IChat` is one conversation inside a session. Chats in the same session
share the session's workspace and runtime context while retaining independent
conversation identity, title, turns, model selection, status, and
interactivity.

The main chat is always part of `chats`. Additional chats retain creation order
unless a product-level ordering rule explicitly says otherwise.

### Session and chat state

Session-level state is either intrinsic to the session or explicitly aggregated
from its chats:

- workspace, provider, session type, and capabilities belong to the session;
- conversation title, turns, model, and interactivity belong to a chat;
- session activity time is the latest activity across its chats;
- session read state is read only when all visible chats are read;
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
identity.

### Capabilities

`ISessionCapabilities` describes behavior that the active provider can
guarantee, such as multiple chats, rename, changes, models, or workspace-less
sessions. Capabilities are observable when they can change after provider
registration or session hydration.

UI availability is derived from capabilities. UI and shared services do not
branch on a provider ID or session type to choose provider-specific behavior.

### Chat interactivity

Chat interactivity is provider-agnostic:

- `Full` — visible and accepts user input;
- `ReadOnly` — visible but does not expose mutating input or actions;
- `Hidden` — retained in the model but not surfaced by the Sessions Part.

The view service filters hidden chats before selection. The chat view enforces
read-only behavior before rendering an input. The provider reports
interactivity but does not manipulate UI.

## Services

### `ISessionsProvidersService`

The provider service is a pure registry:

- register and unregister providers;
- look up a provider by stable ID;
- expose provider registration changes;
- dispose provider registrations with their owning contribution.

It does not aggregate sessions, select an active session, mutate layout, or
render UI.

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

### `ISessionsService`

The view-facing service owns session presentation state:

- canonical active session and active chat;
- opening and closing sessions and chats;
- focus requests for the Sessions Part;
- session navigation history;
- session-scoped view state that must survive rerender or reload;
- active-session context keys derived from its observables.

It calls the management service for domain operations and the Workbench layout
owner for semantic reveal requests. It does not implement provider behavior or
render Part DOM.

### Model and view ownership

| Management model | View-facing model |
|---|---|
| providers and session collection | active session and active chat |
| draft creation and disposal | open, close, focus, and navigation |
| send and CRUD routing | session-scoped view state |
| provider reconciliation | active-session context keys |
| recency and domain preferences | presentation reaction to explicit replacement |

There is one canonical owner for each state. Do not mirror active session state
inside the management service or provider registry.

## Data flow

### Provider registration

```text
Workbench contribution
    → creates provider
    → ISessionsProvidersService.registerProvider(provider)
    → management service observes the registry
    → provider sessions enter the aggregate model
```

Registration returns a disposable. Disposing the contribution unregisters and
disposes the provider and removes its sessions through the normal observable
flow.

### Opening an existing session

```text
command, list, or resource opener
    → ISessionsService.openSession(resource, options)
    → resolve the session through the management service
    → set the canonical active session
    → Sessions Part renders the active session
    → focus only when the request does not preserve focus
```

An action carries the originating session context. It must not assume that the
globally active session is the action target.

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
    → Sessions Part rerenders
```

Every request addresses both a session and a chat. Multi-chat providers must
not route a peer-chat request through the main chat as a fallback.

### Provider change propagation

```text
backend change
    → provider updates its session facade observables
    → provider publishes added, removed, changed, or replaced identities
    → management service reconciles the aggregate collection
    → view service reconciles active presentation state
    → Sessions Part reacts through observables
```

Provider notifications are authoritative. Reconciliation preserves a stable
facade identity when the provider reports an update and performs an explicit
replacement only when the provider reports a replacement.

### Opening session content in the Editor

```text
session action
    → typed resource or EditorInput
    → IEditorService.openEditor(...)
    → Editor Part reveals the input
    → Workbench layout owner ensures the Editor Part is visible
```

Session code does not import a concrete Editor Part, inspect Editor DOM, or
instantiate editor panes.

## State and persistence

Persistence follows ownership:

| State | Owner |
|---|---|
| backend session and turns | provider |
| provider registry | Workbench contributions |
| aggregate session metadata and recency | management service |
| active session, active chat, and navigation | view-facing service |
| session-scoped prompt history | session service keyed by stable session identity |
| Part visibility and column sizes | Workbench layout owner |
| open editor inputs and editor view state | Editor services |

Restoration must hydrate the owning model and let consumers react. It must not
reconstruct state by reading DOM, context keys, or sibling Part internals.

## Part contract

The Sessions Part is a renderer and interaction surface. It:

- reads session and view state through typed services and observables;
- renders the active session and active chat;
- reports focus and user intent through typed methods;
- scopes action context to the session or chat that originated the action;
- disposes views, widgets, listeners, and scoped context keys with the Part.

The Part does not aggregate providers, own Workbench layout, or create sibling
Parts. See [LAYOUT.md](LAYOUT.md) for its visual contract.

## Provider contract rules

- Provider identity is stable and globally unique within the registry.
- Session identity is globally unique across providers.
- Core provider operations are required, not optional convenience methods.
- Optional feature families use explicit capabilities and coherent typed
  contracts; call sites do not probe for methods and fall back.
- Unsupported operations fail explicitly and are not offered by the UI.
- Providers update observable facades and publish authoritative collection
  changes for every lifecycle transition.
- Providers dispose backend subscriptions, chat adapters, and session adapters
  when their registrations or sessions are removed.
- Providers do not import UI, Workbench Parts, or Workbench layout.

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

Session actions resolve the session and chat supplied by the invocation. They
do not silently redirect to the currently active session, and collection
actions support multi-selection where the surface exposes it.

### State changes are observable

Observable state drives rendering and session switching. Events represent
collection membership or one-time lifecycle notifications; they are not used as
an alternative mutable source of truth.

## Adding a provider

1. Implement the provider contract with a stable provider ID.
2. Implement provider-agnostic `ISession` and `IChat` facades backed by
   observables.
3. Declare truthful capabilities and explicit unsupported operations.
4. Place the implementation under
   `src/cs/workbench/contrib/sessionProviders/<provider>/`.
5. Register it through a Workbench contribution and immediately register all
   created disposables.
6. Publish every added, removed, changed, and replaced session transition.
7. Add contract tests for identity, lifecycle, request routing, and disposal.
8. Add integration tests only for behavior that requires the real backend.

## Related documents

- [Sessions Part overview](README.md)
- [Sessions layout](LAYOUT.md)
- [Sessions dependency rules](LAYERS.md)
