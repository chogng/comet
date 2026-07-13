# Sessions application layout

For domain and service ownership, see the
[Sessions architecture](SESSIONS.md).

## Overview

The Sessions application has one product shell with three sibling content
Parts:

```text
┌──────────────┬──────────────────────────┬──────────────────────────┐
│ Sidebar Part │      Sessions Part       │ Sessions Editor Part     │
│              │                          │ Draft / PDF / Browser    │
└──────────────┴──────────────────────────┴──────────────────────────┘
```

The Sessions Part is the primary agent interaction surface. The Sidebar
navigates product content, and the Editor presents typed working artifacts.

## Ownership

| Owner | Layout responsibility |
|---|---|
| Sessions shell | Root grid and Part lifecycle |
| `ISessionsLayoutService` | Authoritative Part visibility, sizing, geometry, persistence, and deterministic reveal |
| `ISessionsLayoutPolicy` | Initial arrangement and target-specific responsive rules |
| `ISessionsPartService` | Visible-session slot reconciliation and focus realization inside the Sessions Part |
| Sidebar Part | Sidebar titlebar, navigation, content, and footer |
| Sessions Part | Session titlebar, session header, chat content, and session-local focus |
| Sessions Editor Part | Editor titlebar, application toolbar/status, Workbench group placement, and editor focus |
| Workbench editor group presentation | Group tabs, Pane hosting, Pane view state, and input presentation |

Parts do not create, mount, resize, or dispose sibling Parts.

## Application composition

The Sessions shell creates each Part through dependency injection and mounts
each Part root into one Sessions-owned grid slot.

After each completed grid layout, the shell publishes one atomic typed geometry
snapshot to `ISessionsLayoutService`. The snapshot combines the content widths
and visibility reported by the layout controller with titlebar and statusbar
heights measured from chrome owned directly by the shell. Consumers do not
inspect Part DOM owned by the shell or another Part.

```text
Sessions shell
├── sidebar slot  → Sidebar Part root
├── sessions slot → Sessions Part root
└── editor slot   → Sessions Editor Part root
```

The Sessions Part does not own the application shell. It may contain
session-local views, but it does not contain sibling Sidebar or Editor roots.
Each product target registers exactly one `ISessionsLayoutPolicy` before shell
creation. Missing or multiple policies are product-composition errors.

## Sessions Part structure

```text
Sessions Part
├── titlebar
└── content
    └── visible session grid
        └── session slot(s)
            ├── session header
            └── chat host
                ├── optional chat tab strip
                └── selected chat widget
```

- `titlebar` is column chrome and participates in window dragging and
  column-level actions.
- `visible session grid` renders the authoritative ordered slots. Each mounted
  slot is bound to at most one stable session identity or to the new-session
  placeholder. The active session is the focused slot, not the only rendered
  slot.
- `session header` contains session-owned identity and conversation controls.
- `chat host` owns chat tabs, contributed-view placement, and view lifecycle.
  The Sessions Chat contribution owns the returned view; Workbench Chat owns
  the reusable chat widget and its internal layout.

Do not call a content-owned control row a titlebar. Do not place session or chat
controls in another Part's titlebar.

## Visibility model

Sessions is a primary Part and remains present while the Sessions application
is active. Sidebar and Editor visibility are independent layout dimensions.

```text
Sidebar visibility ─┐
Sessions content ───┼→ Sessions grid
Editor visibility ──┘
```

Changing one dimension does not implicitly mutate another:

- collapsing Sidebar does not recreate Sessions or Editor;
- collapsing Editor does not close tabs, dispose inputs, change the active
  editor, or replace the active session or selected chat;
- opening an editor does not replace the Sessions Part;
- switching sessions does not infer layout changes from chat status, generated
  changes, or DOM visibility.

Semantic workflows may request a deterministic reveal through the owning
`ISessionsLayoutService`. They must not use a toggle when the required result
is “visible”.

## Session and chat presentation

`ISessionsService.visibleSessions` determines the session views hosted by the
Part. `activeSession` identifies the focused visible session, and each
optional `IActiveSession.activeChat` identifies the Chat rendered in that
Session view. Rendering follows observable identity:

```text
visibleSessions changes
    → ISessionsService calls ISessionsPartService
    → reconcile the authoritative ordered slots
    → release view resources when a slot binding changes
    → bind each occupied slot to its IActiveSession view model
    → restore only the exact persisted Chat when still available
    → otherwise retain an explicit undefined activeChat
    → obtain a concrete Chat view only for an addressed activeChat
    → restore session-owned view state

activeSession changes
    → update focused-slot presentation and command context
    → preserve every other visible session view
```

A Session with one open user Chat renders it without a Chat tab strip. Peer and
fork Chats appear as tabs only when the provider supports them. Agent-owned
Tool-origin worker Chats are hidden from the ordinary tab strip until
explicitly opened and normally use the Chat view in read-only mode. Hidden
Chats never receive a visible Chat host. A Session with no active Chat renders
an explicit no-Chat state instead of selecting the first catalog entry. Draft
and committed Sessions use explicit model state, not title text or DOM class
inference.

The product-wide new-conversation action opens a new session slot. An explicit,
capability-gated in-session action creates a peer chat in the current session;
the UI does not overload one command to guess between those lifecycles.

The Sessions Part does not import `ChatWidget` or a contribution
implementation. The Sessions Chat contribution implements and registers
`IChatViewFactory` using the reusable Workbench Chat contribution; the Part
consumes that service contract and hosts the returned view.

## Part rendering bridge

`ISessionsService` owns visible and active state. `ISessionsPartService`
realizes that state in the mounted Part. The Part does not independently
subscribe to providers or reconstruct the visible collection.

The bridge exposes slot reconciliation, semantic focus, and Part-owned events.
It never returns a concrete session view or DOM node. A contribution that needs
rename, maximize, navigation, or another user operation calls a typed Sessions
service or command carrying the target session context; it does not reach into
the mounted view.

## Focus

- Opening with `preserveFocus` updates presentation without moving DOM focus.
- A semantic focus request flows from `ISessionsService` through
  `ISessionsPartService` to the mounted slot.
- User focus reported by `ISessionsPartService` promotes that slot to the
  canonical `activeSession`.
- Actions carry the originating session and chat context even when that item is
  not globally active.
- Sibling Parts do not detect session activation by walking Session DOM.
- Focus restoration uses widget and Part APIs, not saved DOM nodes owned by
  another component.

## Editor interaction

Session content enters the Editor through typed editor services:

```text
session resource or typed EditorInput
    → IEditorService.openEditor(...)
    → IEditorResolverService resolves the resource when needed
    → IEditorGroupsService opens and activates the typed input
    → Sessions Editor Part hosts the Workbench group presentation
    → the group-owned Pane host selects and renders the matching pane
    → editor-host contract asks ISessionsLayoutService to reveal the Editor slot
```

Editor collapse and editor content remain separate state dimensions. Session
switching must not close or recreate editor inputs. Editor groups and inputs are
application-global Workbench state; the Sessions layout does not apply a
parallel per-session editor working set.

## Layout state and policy

`ISessionsLayoutService` owns layout state and deterministic operations. The
Sessions shell applies that state to the root grid. A target-specific
`ISessionsLayoutPolicy` computes initial and responsive arrangement but does
not own a second copy of visibility, size, active-session, or Editor state.

```text
target / viewport / layout snapshot
    → ISessionsLayoutPolicy decision
    → ISessionsLayoutService commits authoritative state

semantic workflow
    → ISessionsLayoutService deterministic operation
    → Sessions shell applies grid geometry
    → Parts receive layout dimensions
```

`ISessionsLayoutPolicy` is a stateless decision contract: it maps target,
viewport, and authoritative layout snapshots to an arrangement. The layout
service consumes that decision and commits the state. The policy does not
subscribe to commands, mutate services, close sessions, chats, or editor
inputs, or touch provider state. Product targets select one policy during
composition; there is no runtime fallback policy.

## Titlebar coordination

Each column renders its own titlebar region. The Sessions shell coordinates
common height, native window-control insets, and drag regions.

- Put `-webkit-app-region: drag` only on intentional chrome regions.
- Put `no-drag` on interactive descendants.
- Route an action to the titlebar that owns it; do not reparent action DOM
  between Parts as visibility changes.
- Update adjacent titlebar insets and native control coordinates as one layout
  operation.

## Lifecycle

```text
Sessions shell creates Part
    → Part creates owned views and widgets
    → Sessions shell lays out Part root
    → ISessionsPartService reconciles owned session views
    → Sessions shell disposes Part
    → Part disposes all owned resources
```

Register disposables immediately. A Part visibility change does not transfer
ownership or imply disposal. Closing a session follows the session lifecycle.
Closing a Chat tab updates `IActiveSession` view state; deleting a Chat uses the
provider lifecycle. Hiding the Part follows the Sessions layout lifecycle.

## CSS ownership

- Sessions grid and slot CSS lives with the Sessions shell layout.
- Sidebar CSS lives with Sidebar.
- Sessions Part, session header, and chat-host CSS lives with Sessions.
- Transcript, composer, attachment, voice, and Chat widget CSS lives with the
  owner that renders the corresponding Sessions or Workbench Chat DOM.
- Sessions Editor Part chrome CSS lives with Sessions; reusable tabs, panes,
  and editor widget CSS stays with Workbench Editor.
- Shared widget CSS stays with the widget.

CSS selectors do not cross Part boundaries to reconstruct ownership. Prefer
direct-child selectors for stable owned DOM and put state classes on the element
that owns the state.

## Layout invariants

- Exactly one Sessions shell owns the root grid.
- Exactly one root exists for each mounted Part.
- Each visible session identity has at most one mounted session view.
- Changing the active session does not recreate other visible session views.
- The Part does not own a second visible-session collection.
- Exactly one layout policy drives one authoritative layout service.
- Sessions remains independent from Sidebar and Editor visibility.
- Part visibility never disposes domain models or editor inputs.
- A semantic reveal is deterministic.
- Session switching is driven by observables, not command events or DOM state.
- No Part imports or inspects a sibling Part implementation.
- Workbench code does not own or style the Sessions shell grid.
