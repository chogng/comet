---
description: Architecture rules for the Sessions Part inside the Comet Workbench.
applyTo: "{src/cs/workbench/browser/parts/sessions/**,src/cs/workbench/services/sessions/**,src/cs/workbench/contrib/sessionProviders/**}"
---

# Sessions Part

Read these documents before changing session code:

- `src/cs/workbench/browser/parts/sessions/README.md`
- `src/cs/workbench/browser/parts/sessions/SESSIONS.md`
- `src/cs/workbench/browser/parts/sessions/LAYOUT.md`
- `src/cs/workbench/browser/parts/sessions/LAYERS.md`

## Architecture

```text
Comet Workbench shell
├── Sidebar Part
├── Sessions Part → ISessionsService → ISessionsManagementService
└── Editor Part                         ↓
                              ISessionsProvidersService
                                         ↑
                                provider contributions
```

- The Workbench owns shell layout, Part visibility, sizing, and lifecycle.
- The Sessions Part owns the visible session/chat surface and local
  presentation.
- Session services own provider-agnostic state, selection, and routing.
- Providers own backend integration and never depend on UI.
- Editor services and the Editor Part own typed editor inputs and tabs.

## Module locations

```text
src/cs/workbench/browser/parts/sessions/
src/cs/workbench/services/sessions/{common,browser}/
src/cs/workbench/contrib/sessionProviders/<provider>/
```

## Boundaries

- Sidebar, Sessions, and Editor are sibling Parts; none imports another's
  concrete implementation or inspects another's DOM.
- Session content opens through `IEditorService`, never through Editor DOM or a
  concrete Editor Part.
- Layout changes go through the Workbench layout owner. Sessions do not create
  a shell grid, move titlebars, or own sibling column sizing.
- Shared code remains provider-agnostic. Capabilities and typed contracts
  replace provider-ID or session-type branching.
- Use observables for state. Commands express intent, and context keys only gate
  declarative menus, commands, and keybindings.
- Actions carry the originating session/chat context and never silently target
  the globally active session.

## DOM and styling

Each Part renders and styles its own subtree. Session-specific CSS is colocated
with the Sessions Part; Sidebar, Editor, titlebar coordination, and shell CSS
stay with their owners.

Use `titlebar` for Workbench column chrome and `header` for controls inside Part
content. Never mount one Part's header or titlebar into another Part.

Do not infer intent by matching foreign DOM classes with `closest()`,
`matches()`, or parent traversal. Use typed signals, event ownership, focus, or
the owning widget API.

For custom clickable elements on touch devices, use the platform generic
pointer listeners or both click and tap handling with `Gesture.addTarget`, and
set `touch-action: manipulation`. Prefer the shared Button and toolbar widgets.
