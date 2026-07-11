# Sessions layout

## Overview

The Comet Workbench has one shell with three sibling content Parts:

```text
┌──────────────┬──────────────────────────┬──────────────────────────┐
│ Sidebar Part │      Sessions Part       │       Editor Part        │
│              │                          │ Draft / PDF / Browser    │
└──────────────┴──────────────────────────┴──────────────────────────┘
```

The Sessions Part is the primary agent interaction surface. The Sidebar
navigates product content, and the Editor presents typed working artifacts.

## Ownership

| Owner | Layout responsibility |
|---|---|
| Workbench shell | Root grid, Part order, visibility, sizing, persistence, and window resize |
| Sidebar Part | Sidebar titlebar, navigation, content, and footer |
| Sessions Part | Session titlebar, session header, chat content, and session-local focus |
| Editor Part | Editor titlebar, tabs, toolbar, panes, status, and editor focus |

Parts do not create, mount, resize, or dispose sibling Parts.

## Workbench composition

The Workbench creates each Part through dependency injection and mounts each
Part root into one Workbench-owned grid slot.

```text
Workbench shell
├── sidebar slot  → Sidebar Part root
├── sessions slot → Sessions Part root
└── editor slot   → Editor Part root
```

The Sessions Part does not own a nested Workbench shell. It may contain
session-local views, but it does not contain Workbench Sidebar or Editor roots.

## Sessions Part structure

```text
Sessions Part
├── titlebar
└── content
    ├── session header
    └── chat host
        └── active chat widget
```

- `titlebar` is column chrome and participates in window dragging and
  column-level actions.
- `session header` contains session-owned identity and conversation controls.
- `chat host` owns the active chat widget and its layout.

Do not call a content-owned control row a titlebar. Do not place session or chat
controls in another Part's titlebar.

## Visibility model

Sessions is a primary Part and remains present while the Workbench content page
is active. Sidebar and Editor visibility are independent layout dimensions.

```text
Sidebar visibility ─┐
Sessions content ───┼→ Workbench grid
Editor visibility ──┘
```

Changing one dimension does not implicitly mutate another:

- collapsing Sidebar does not recreate Sessions or Editor;
- collapsing Editor does not close tabs, dispose inputs, change the active
  editor, or replace the active chat;
- opening an editor does not replace the Sessions Part;
- switching sessions does not infer layout changes from chat status, generated
  changes, or DOM visibility.

Semantic workflows may request a deterministic reveal through the owning
service. They must not use a toggle when the required result is “visible”.

## Session and chat presentation

`ISessionsService.activeSession` and the active session's `activeChat` determine
what the Part renders. Rendering follows observable identity:

```text
active session changes
    → release the previous session view resources
    → bind the new session view
    → select its active visible chat
    → restore session-owned view state
```

Hidden chats never receive a visible chat host. Read-only chats use the normal
chat view without mutating input controls. Draft and committed sessions use
explicit model state, not title text or DOM class inference.

## Focus

- Opening with `preserveFocus` updates presentation without moving DOM focus.
- A direct user activation focuses the Sessions Part through its public focus
  method.
- Actions carry the originating session/chat context even when that item is not
  globally active.
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
    → Editor Part observes the active group and renders the matching pane
    → IEditorService requests deterministic reveal from the Workbench layout owner
```

Editor collapse and editor content remain separate state dimensions. Session
switching must not close or recreate editor inputs. If session-scoped editor
working sets are introduced, their save/apply lifecycle belongs to an explicit
service and is serialized independently from Part rendering.

## Titlebar coordination

Each column renders its own titlebar region. The Workbench coordinates common
height, native window-control insets, and drag regions.

- Put `-webkit-app-region: drag` only on intentional chrome regions.
- Put `no-drag` on interactive descendants.
- Route an action to the titlebar that owns it; do not reparent action DOM
  between Parts as visibility changes.
- Update adjacent titlebar insets and native control coordinates as one layout
  operation.

## Lifecycle

```text
Workbench creates Part
    → Part creates owned views and widgets
    → Workbench lays out Part root
    → observables update owned views
    → Workbench disposes Part
    → Part disposes all owned resources
```

Register disposables immediately. A Part visibility change does not transfer
ownership or imply disposal. Closing a session or chat follows the session
service lifecycle; hiding the Part follows Workbench layout lifecycle.

## CSS ownership

- Workbench grid and slot CSS lives with the Workbench layout.
- Sidebar CSS lives with Sidebar.
- Sessions Part, session header, and chat-host CSS lives with Sessions.
- Editor tabs, toolbar, panes, and status CSS lives with Editor.
- Shared widget CSS stays with the widget.

CSS selectors do not cross Part boundaries to reconstruct ownership. Prefer
direct-child selectors for stable owned DOM and put state classes on the element
that owns the state.

## Layout invariants

- Exactly one Workbench shell owns the root grid.
- Exactly one root exists for each mounted Part.
- Sessions remains independent from Sidebar and Editor visibility.
- Part visibility never disposes domain models or editor inputs.
- A semantic reveal is deterministic.
- Session switching is driven by observables, not command events or DOM state.
- No Part imports or inspects a sibling Part implementation.
- No session-specific stylesheet owns Workbench, Sidebar, or Editor layout.
