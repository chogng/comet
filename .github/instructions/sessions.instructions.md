---
description: Architecture rules for Comet's top-level Sessions application layer.
applyTo: "src/cs/sessions/**"
---

# Sessions application

Read these documents before changing Sessions code:

- `src/cs/sessions/README.md`
- `src/cs/sessions/SESSIONS.md`
- `src/cs/sessions/LAYOUT.md`
- `src/cs/sessions/LAYERS.md`

## Layer boundary

```text
code / server
    → sessions
        → workbench
            → editor → platform → base
```

- Sessions is Comet's top-level Agent application layer and owns the only
  product shell instantiated by Comet.
- Sessions may consume public Workbench core, service, and contribution APIs.
- Workbench and lower layers never import Sessions.
- Code entry points start the Sessions application directly; they do not start
  a second Workbench shell.

## Ownership

- The Sessions shell owns root composition, layout, titlebars, Part visibility,
  sizing, persistence, and lifecycle.
- Sessions services own provider-agnostic session identity, lifecycle, routing,
  workspace/runtime association, changes, recency, persistence, and
  visible-session state.
- Sessions core Parts are passive consumers of Sessions services.
- `ISessionsService` owns visible slots and active-session state;
  `ISessionsPartService` only reconciles mounted slots and realizes focus.
- `ISessionsLayoutService` owns layout state and operations. Exactly one
  target-specific `ISessionsLayoutPolicy` supplies arrangement rules without
  owning duplicate state.
- Sessions feature contributions own optional Chat, Editor, changes, terminal,
  task, list, action, and onboarding integration.
- Provider contributions own backend integration and never depend on UI.
- Provider-internal protocols and services never escape into core, shared
  services, or non-provider contributions.
- Workbench Chat owns one conversation model and reusable Chat widgets.
- Workbench Editor owns inputs, groups, resolvers, panes, and registries.

## Module locations

```text
src/cs/sessions/{common,browser,node,electron-browser}/
src/cs/sessions/services/<service>/{common,browser,node,electron-browser}/
src/cs/sessions/contrib/<feature>/
src/cs/sessions/contrib/providers/<provider>/
src/cs/sessions/sessions.{common,desktop,web}.main.ts
```

## Session model

- Every session has exactly one `mainChat`, and `mainChat` is always in
  `session.chats`.
- Ordinary single-agent sessions expose only `mainChat`.
- Additional chats represent provider-supported peer, fork, or Multi-Agent
  worker flows and retain explicit origin, parent, capability, and
  interactivity state.
- The product-wide new-conversation action creates a new session. Creating a
  peer chat in an existing session is a separate capability-gated operation.
- Unrelated conversations are separate sessions; UI code never groups them by
  provider, workspace, title, or recency.
- `IActiveSession` owns the selected and open chats for one visible session.
  Providers and the management service do not own UI chat selection.
- `visibleSessions` contains ordered `IActiveSession` slots and at most one
  new-session placeholder. `activeSession` is the focused slot, and sticky slots
  are not replaced by ordinary opens.

## Integration boundaries

- Sessions core depends on `IChatViewFactory`; `src/cs/sessions/contrib/chat/`
  implements it using public Workbench Chat APIs.
- Sessions core never imports `ChatWidget` or a contribution implementation.
- `ISessionsPartService` exposes no concrete Session view or DOM. Contributions
  use semantic Sessions services and commands rather than mounted view methods.
- Session content opens through `IEditorService`, never through Editor DOM or a
  concrete Pane.
- The Sessions Editor Part hosts Workbench group presentation without taking
  ownership of group tabs, the group-owned Pane host, or Pane view state.
- Cross-Part operations use typed services. Parts do not import sibling Parts
  or inspect sibling DOM.
- Capabilities replace provider-ID and session-type branching in shared code.
- Commands carry the originating session/chat context and never silently
  target the globally active session.

## DOM and styling

Each owner styles the DOM it creates. Sessions shell CSS owns the root grid and
Part slots; each Part owns its chrome and host DOM; Workbench Chat and Editor
retain their reusable widget CSS.

Use `titlebar` for shell column chrome and `header` for controls inside Part
content. Do not infer state by matching foreign DOM classes or walking across
Part boundaries.
