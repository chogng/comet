# Sessions application migration

## Purpose

This document tracks the one-time migration from the current inverted
Workbench/Sessions dependency to Comet's top-level Sessions application layer.
It is temporary and must be deleted when every completion criterion is met.

## Scope

This migration applies to:

```text
src/cs/sessions/**
src/cs/code/{browser,electron-browser}/workbench.ts
src/cs/workbench/browser/workbench.ts
src/cs/workbench/browser/layout.ts
src/cs/workbench/browser/{contextkeys.ts,actions/layoutActions.ts}
src/cs/workbench/services/layout/**
src/cs/workbench/contrib/workbench/**
src/cs/workbench/workbench.*.main.ts
src/cs/workbench/contrib/chat/**
src/cs/workbench/browser/parts/editor/**
src/cs/workbench/services/editor/**
```

It also applies to affected entry points, import-pattern rules, styles, tests,
and direct call sites changed to establish the final dependency direction.

The durable target is defined by:

- [README.md](README.md)
- [SESSIONS.md](SESSIONS.md)
- [LAYOUT.md](LAYOUT.md)
- [LAYERS.md](LAYERS.md)
- [Editor architecture](../../../.github/instructions/editor.instructions.md)

The detailed Editor contract migration remains tracked by
`src/cs/workbench/browser/parts/editor/editor.migration.md`.

## Current boundary being removed

The repository currently starts the product through Workbench and then reaches
up into Sessions UI:

```text
code entry point
    → cs/workbench/browser/workbench.ts
        → cs/sessions/browser/workbenchContentPartViews.ts
            → Sessions Sidebar / Sessions Part / Session Editor wrapper
            → Workbench Editor and services
```

At the same time, Sessions-specific grid types and layout controllers live in
`cs/workbench/browser/layout.ts`. This creates a bidirectional conceptual
boundary:

```text
Workbench product host → Sessions UI → Workbench Parts and services
```

Additional ownership is mixed into that host:

- `WorkbenchHost` coordinates Agent product state, Chat conversations, article
  context, session navigation, shell Parts, titlebars, status, and Editor
  behavior;
- `IChatService` owns both a single conversation implementation and the global
  conversation collection with `activeConversationId`;
- `SessionEditorPartView` forwards most Editor behavior to Workbench group
  presentation without being the final application Part owner;
- Workbench entry points are also treated as product entry points, leaving no
  explicit Sessions contribution boundary.

Do not preserve this shape through forwarding bootstraps, re-exported shells,
layout facades, compatibility services, or aliases.

## Final target

```text
code / server
    → Sessions application bootstrap
        ├── Sessions shell and layout
        ├── Sessions services
        ├── Sessions feature contributions
        ├── Sessions providers
        └── Workbench foundation
            ├── Editor framework
            └── single-conversation Chat
```

The import invariant is:

```text
sessions → workbench
workbench ──✕──→ sessions
```

Comet instantiates one Sessions shell. It does not instantiate a traditional
Workbench shell in parallel.

## Destination map

| Current source or responsibility | Final owner |
|---|---|
| Agent product bootstrap in `cs/workbench/browser/workbench.ts` | `cs/sessions/browser/` application bootstrap |
| Sessions-specific grid and layout in `cs/workbench/browser/layout.ts` | `cs/sessions/browser/` layout owner |
| broad `IWorkbenchLayoutService` state and concrete implementation | focused `ISessionsLayoutService` in Sessions; narrow reusable host contracts remain in Workbench |
| Sessions layout actions and context keys in Workbench | Sessions shell or Sessions layout contribution |
| `cs/sessions/browser/workbenchContentPartViews.ts` | Sessions shell/Part composition, reduced to final typed ownership |
| shell-driven Session props, callbacks, and view lookup | `ISessionsService` state plus a narrow `ISessionsPartService` implemented by the core Part |
| mounted titlebar, status, settings overlay, and shell action routing in `WorkbenchHost` | Sessions shell; reusable widgets remain in Workbench |
| `cs/sessions/browser/parts/sidebar/**` | Sessions Sidebar Part |
| `cs/sessions/browser/parts/sessions/**` | Sessions Part and host presentation |
| `cs/sessions/browser/parts/editor/**` | Sessions Editor Part with real outer chrome, group placement, and layout ownership |
| generic Editor groups, inputs, panes, and registries | remain in `cs/workbench` |
| generic single-conversation Chat model and widgets | remain in `cs/workbench/contrib/chat` |
| Agent/LLM session creation, send routing, model/runtime backend operations in the current Chat service | default Sessions provider contribution |
| Sessions-specific Chat view/factory implementation | `cs/sessions/contrib/chat` |
| session model, provider registry, routing, and view state | `cs/sessions/services/sessions` |
| changes, terminal, tasks, lists, actions, and onboarding | `cs/sessions/contrib/<feature>` or a focused Sessions service |
| backend integrations | `cs/sessions/contrib/providers/<provider>` |
| Sessions contribution loading | `cs/sessions/sessions.*.main.ts` |
| browser and desktop code bootstrap | import and start Sessions directly |

Move mixed files by responsibility. Do not mechanically retain a file in its
old layer when all of its remaining behavior belongs elsewhere.

## Conversation migration invariant

Each existing `ChatConversation` becomes one `ISession` whose canonical
conversation is `mainChat`:

```text
ChatConversation
    → ISession
        └── mainChat: IChat
```

| Current state or operation | Final owner |
|---|---|
| `ChatServiceSnapshot.conversations` | `ISessionsManagementService` session collection |
| `activeConversationId` | `ISessionsService.activeSession` identity |
| `ChatConversation.id` | provider-local identity used to construct the session resource |
| `ChatConversation.title` | initial session and main-chat titles |
| question, messages, result, request state, and errors | Workbench Chat model addressed by `mainChat.resource` |
| chat-scoped article context and selections | Workbench Chat state for the addressed conversation |
| create, activate, and close conversation | create, open, and close session operations |

For the migrated provider, construct `session.resource` deterministically from
the legacy conversation ID, derive `sessionId` through one shared provider-aware
ID factory, and use `session.resource` as the initial `mainChat.resource`.

Do not combine legacy conversations by provider, workspace, title, recency, or
UI placement. Additional peer, fork, and Multi-Agent worker chats enter only
through authoritative provider state with explicit origin, parent, capability,
and interactivity.

## Required behavior baseline

Protect these behaviors before moving ownership:

- browser and desktop entry points render one product shell;
- entry points contain no obsolete native-overlay bootstrap branch after the
  native overlay backends and their callers have been deleted;
- the shell renders one Sidebar, one Sessions Part, and one Sessions Editor
  Part;
- Sidebar and Editor visibility and saved sizes survive rerender and reload;
- collapsing the Editor preserves inputs, active tab, Pane, and view state;
- opening Draft, PDF, or Browser content uses `IEditorService` and reveals the
  Editor deterministically;
- reopening a Browser resource preserves its `BrowserEditorInput`, BrowserView,
  URL, cookies, and page state;
- chat input, send, model selection, conversation/session actions, attachments,
  and article context continue to work;
- titlebar, status, settings, overlays, and focus remain owned by the component
  that renders them;
- startup, disposal, and reload do not create a second shell or duplicate
  service subscriptions.

## Reference boundary

Use these upstream areas as implementation evidence:

```text
../vscode/src/vs/sessions/{common,browser,electron-browser}/**
../vscode/src/vs/sessions/services/**
../vscode/src/vs/sessions/contrib/**
../vscode/src/vs/sessions/sessions.*.main.ts
../vscode/src/vs/sessions/services/sessions/browser/sessionsPartService.ts
../vscode/src/vs/sessions/browser/parts/sessionsParts.ts
../vscode/src/vs/sessions/browser/parts/editorParts.ts
../vscode/src/vs/sessions/services/chatView/browser/chatViewFactory.ts
../vscode/src/vs/workbench/contrib/chat/**
../vscode/src/vs/workbench/browser/parts/editor/**
```

Adopt the one-way application-layer boundary and service/contribution
responsibilities. Preserve Comet's product layout and feature set rather than
copying unrelated product behavior.

The upstream comparison leads to these explicit migration decisions:

- adopt the separate management, visible-session, passive Part, Chat factory,
  and concrete EditorParts construction boundaries;
- keep the Part bridge narrower than the upstream shape: it never returns a
  concrete `SessionView` or DOM to services and contributions;
- move Agent product layout state into `ISessionsLayoutService` instead of
  refining a broad Workbench layout implementation with Sessions state;
- keep Comet Editor groups application-global across session switches rather
  than importing per-session editor working-set behavior without a product
  requirement;
- keep provider contributions isolated from sibling providers and
  non-provider contributions, even where the upstream import graph is more
  permissive.

These are final Comet ownership decisions, not compatibility exceptions.

## Migration sequence

### 1. Protect startup and ownership behavior

- Add entry-point tests that count shell creation and service subscription.
- Add focused layout, Part lifecycle, Chat, and Editor preservation tests.
- Add visible-slot reconciliation and focus round-trip tests at the
  `ISessionsService`/`ISessionsPartService` boundary.
- Add composition tests that require exactly one layout policy and one
  editor-group service for each product target.
- Record the final entry modules and DI registrations for browser and desktop.

### 2. Establish Sessions services and split Chat ownership

- Define session, chat, origin, capability, provider, and management contracts
  under `cs/sessions/services/sessions/common/`.
- Implement provider registry, aggregation, routing, lifecycle, recency, and
  visible-session state under `cs/sessions/services/sessions/browser/`.
- Put focused workspace, terminal, group, reference, title, and configuration
  services under `cs/sessions/services/<service>/`.
- Put optional product integrations under `cs/sessions/contrib/<feature>/`.
- Put backend implementations under
  `cs/sessions/contrib/providers/<provider>/`.
- Move the global conversation collection, active selection, and session
  lifecycle operations out of `IChatService` and into Sessions services.
- Move backend session creation, request routing, model/runtime operations, and
  provider-owned lifecycle from the current Chat service into the default
  Sessions provider.
- Delete the mutable `ChatServiceContext` product context bag. Inject runtime,
  LLM/RAG, localization, Fetch, and Editor dependencies into their real owners;
  do not replace the bag with another callback object.
- Keep single-conversation model loading, transcript, composer, attachments,
  voice, and per-turn behavior in Workbench Chat.
- Define `IChatViewFactory` and its view contract in the Sessions service layer.
- Define a narrow browser `ISessionsPartService` for slot reconciliation and
  focus realization. It must not expose concrete Session views or DOM.
- Make the current core Sessions Part implement `ISessionsPartService`. Drive
  it from `ISessionsService`, promote Part focus events back into
  `activeSession`, and delete equivalent shell Props and callbacks.
- Implement the concrete factory in `cs/sessions/contrib/chat/` using public
  Workbench Chat APIs.
- Make the Sessions Part depend only on `IChatViewFactory`.
- Migrate `WorkbenchHost` call sites directly to the new Sessions services so
  the later shell move does not merely relocate its domain state.

Core and services must not import contribution or provider implementations.
Delete the old Chat collection methods after all call sites migrate; do not
keep a Chat-to-Sessions forwarding facade.

### 3. Establish Sessions bootstrap and product host atomically

- Add `sessions.common.main.ts`, `sessions.desktop.main.ts`, and
  `sessions.web.main.ts`.
- Load the matching Workbench foundation entry point before Sessions services,
  feature contributions, and providers.
- Load Sessions contribution entry points only from these Sessions main files.
- Start the shared contribution registry exactly once after both Workbench and
  Sessions registrations are loaded.
- Move the remaining shell composition from `WorkbenchHost` into a
  Sessions-owned application host. Domain state already moved in step 2; do not
  recreate it on the new host.
- Compose the existing Sessions Sidebar, Sessions Part, and Sessions Editor
  Part from that host.
- Make Parts and contributed views inject their owning services directly. The
  shell passes layout slots and irreducible composition context, not domain
  snapshots or a callback/Props bus.
- Change browser and desktop code bootstraps to import and start the Sessions
  application directly.
- Remove direct product startup through `cs/workbench/browser/workbench.ts` in
  the same change.

Do not retain `renderWorkbench()` as a forwarding alias to Sessions.

### 4. Complete Sessions layout ownership and purify Workbench

- Move Sessions-specific grid views, layout controller, visibility, sizes,
  persistence, titlebar coordination, and related CSS out of Workbench.
- Move the broad layout state and concrete `IWorkbenchLayoutService`
  implementation to a focused `ISessionsLayoutService` in Sessions.
- Keep only genuinely reusable Part DOM registration and narrow host contracts
  in Workbench. Workbench layout actions and context keys must consume those
  contracts or move to Sessions when their state is Sessions-specific.
- Register the Sessions layout implementation from Sessions entry points;
  Workbench foundation entry points must not register a default product layout
  implementation.
- Separate authoritative state and mechanism in `ISessionsLayoutService` from
  the `ISessionsLayoutPolicy` contract. Register exactly one target-specific
  policy per product target and keep policy implementations out of core
  imports.
- Delete the old Workbench product host when no reusable responsibility remains.

At the end of this step, `rg "cs/sessions" src/cs/workbench` returns no source
imports.

### 5. Complete the Editor boundary

- Keep `EditorInput`, groups, resolvers, Pane registry, Pane host, and generic
  presentation primitives in Workbench.
- Replace the thin Session Editor forwarding wrapper with the final Sessions
  Editor Part that owns outer chrome, Workbench group placement, and Sessions
  layout integration.
- Expose the real Workbench EditorParts/MainEditorPart construction point and
  register one concrete EditorParts implementation that creates the Sessions
  MainEditorPart subclass directly.
- Route all opens through `IEditorService` and deterministic reveal through the
  narrow editor-host contract implemented by the Sessions Editor Part.
- Complete the direct contract migration in `editor.migration.md`.

Workbench Editor must not import Sessions.

### 6. Enforce the dependency graph

- Add `sessions` above `workbench` to source-layer import rules.
- Ban every Workbench or lower-layer import of `cs/sessions`.
- Ban Sessions core/services imports of Sessions contributions and providers.
- Ban non-provider contributions from provider implementations.
- Verify browser, desktop, and web entry-point loading order.

### 7. Remove transitional structures

- Delete superseded Workbench product-shell code and Sessions-specific layout
  code from Workbench.
- Delete thin Part wrappers, prop forwarding, compatibility imports, aliases,
  re-exports, and duplicate CSS owners.
- Delete old Chat collection APIs after every call site uses Sessions.
- Delete this migration document after all completion criteria pass.

Keep `src/cs/sessions/`, its durable documentation, application code, services,
and contributions.

## Change requirements

Every migration change must:

- preserve unrelated user changes;
- move ownership and update affected call sites in the same change;
- delete superseded code instead of forwarding to the new owner;
- avoid fallback startup, layout, Chat, Editor, or provider paths;
- update import-pattern enforcement with each completed layer move;
- add or update focused tests for the responsibility being moved;
- pass TypeScript, ESLint, relevant browser tests, entry-point tests, and the
  Comet UI smoke test.

## Completion criteria

The migration is complete only when:

- `cs/sessions` is an enforced source layer above `cs/workbench`;
- browser, desktop, and web bootstrap Comet through Sessions entry points;
- exactly one Sessions product shell is instantiated;
- browser and desktop entry points each instantiate exactly one Sessions shell
  and contain no obsolete native-overlay startup branch;
- Workbench and all lower layers contain no imports of `cs/sessions`;
- the Sessions shell owns root layout, Parts, visibility, sizing, titlebars,
  persistence, and lifecycle;
- no Sessions-specific grid or layout controller remains in Workbench;
- Workbench does not register a concrete product layout service; Sessions owns
  and registers `ISessionsLayoutService`;
- Sessions-specific layout actions, context keys, and contribution loading no
  longer live in Workbench foundation entry points;
- Workbench Editor depends only on a narrow editor-host contract for reveal;
- Sessions services own session collection, active-session state, provider
  aggregation, routing, lifecycle, recency, and persistence;
- `ISessionsService` owns ordered visible-session slots and one focused active
  session without duplicating provider or management state;
- the core Sessions Part implements a narrow `ISessionsPartService`; no service
  or contribution obtains concrete Session views or DOM;
- existing conversations migrate one-to-one to Sessions with a `mainChat`;
- Workbench Chat owns only reusable single-conversation behavior;
- the default Sessions provider owns the migrated Agent/LLM backend routing and
  provider lifecycle formerly mixed into ChatService;
- no mutable Chat product-context bag or replacement callback aggregate
  remains;
- `cs/sessions/contrib/chat` is the concrete Sessions/Chat integration owner;
- Workbench Editor owns reusable models, groups, inputs, panes, and registries;
- the Sessions Editor Part owns mounted presentation and application layout
  integration without parallel editor state;
- exactly one editor-group service is registered and it creates the Sessions
  Editor Part through the Workbench construction extension;
- Sessions core/services do not import contribution or provider
  implementations;
- non-provider contributions do not import provider implementations;
- no duplicate shell, Part, service state, CSS owner, compatibility module,
  wrapper, facade, adapter, alias, re-export, or fallback path remains;
- shell-to-Part Props do not mirror service-owned session, Chat, Editor, Fetch,
  or layout state;
- all required tests and static checks pass;
- this migration document is deleted while `src/cs/sessions/` and its durable
  documentation remain.
