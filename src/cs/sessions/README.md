# Sessions application layer

## Purpose

`cs/sessions` is Comet's top-level Agent application layer. It owns the only
product shell instantiated by Comet and builds that shell on the reusable
Workbench, Editor, Platform, and Base layers.

```text
code / server entry points
          ↓
    Sessions application
          ↓
    Workbench foundation
          ↓
 editor → platform → base
```

The layer is named Sessions because an agent session is the organizing context
for the product. It is not merely the implementation directory of a Sessions
Part.

## Product composition

The Sessions application owns:

- product bootstrap and platform-specific Sessions entry points;
- root shell composition, layout, titlebars, Part visibility, and persistence;
- the Sessions Sidebar, Sessions Part, and Sessions Editor Part;
- session domain models, provider registry, lifecycle, routing, and view state;
- session workspaces, changes, terminals, tasks, groups, references, and lists;
- feature contributions and Agent Host provider contributions;
- Sessions-specific integration of reusable Workbench Chat and Editor
  facilities.

The Workbench layer owns reusable infrastructure such as editor groups,
`EditorInput`, `EditorPane`, commands, menus, storage, generic Parts and widgets,
and the single-conversation Chat contribution. Workbench code never imports
`cs/sessions`.

```text
Sessions application shell
├── Sidebar Part
├── Sessions Part
│   └── contributed single-chat view
└── Sessions Editor Part
    └── Workbench editor groups and panes
```

Comet starts this shell directly. It does not also instantiate a separate
traditional Workbench shell.

## Directory ownership

```text
src/cs/sessions/
├── common/                     application contracts and shared constants
├── browser/                    shell, layout, and core Parts
├── node/                       Sessions-owned Node runtime integration
├── electron-browser/           desktop renderer bootstrap
├── services/                   session and application services
├── contrib/                    Sessions feature integrations
│   ├── chat/                   Workbench Chat integration
│   ├── layout/                 target-specific layout policy
│   └── providers/
│       └── agentHost/         shared provider and Host connections
├── sessions.common.main.ts     shared contribution entry point
├── sessions.desktop.main.ts    desktop contribution entry point
└── sessions.web.main.ts        web contribution entry point
```

Core, services, non-provider contributions, and provider contributions have
different dependency permissions. See [LAYERS.md](LAYERS.md).

Agent SDK contracts and implementations live in the lower
`src/cs/platform/agentHost/` subsystem. Sessions consumes them only through an
Agent Host connection and the shared provider contribution.

## Documentation

| Document | Purpose |
|---|---|
| [SESSIONS.md](SESSIONS.md) | Domain model, services, providers, lifecycle, persistence, and Chat integration |
| [AGENT_HOST.md](AGENT_HOST.md) | Agent runtime, SDK contracts, Host connections, and Sessions integration |
| [ATTACHMENTS.md](ATTACHMENTS.md) | Composer attachments, producers, content references, submission, and source-specific rules |
| [CLIENT_TOOLS.md](CLIENT_TOOLS.md) | Client Tool registration, interaction targets, permissions, routing, and lazy content reads |
| [LAYOUT.md](LAYOUT.md) | Product shell, Parts, visibility, focus, editor presentation, and CSS ownership |
| [LAYERS.md](LAYERS.md) | Import hierarchy, contribution boundaries, and entry points |

## Adding functionality

1. Put application shell, layout, and core Part code in `browser/`.
2. Put provider-agnostic application and session services in `services/`.
3. Put target-specific layout policy in `contrib/layout/`.
4. Put optional changes, terminal, task, list, action, editor, and Chat
   integrations in `contrib/<feature>/`.
5. Put Agent SDK implementations in
   `cs/platform/agentHost/node/agents/<agent>/`.
6. Put shared Host-to-Sessions integration in `contrib/providers/agentHost/`
   together with local and remote connection registration.
7. Keep reusable single-conversation and editor infrastructure in
   `cs/workbench` and integrate it from the higher Sessions layer.
8. Register contributions only from Sessions entry points.
9. Update the owning architecture, layout, and layer documents with every
   durable boundary change.
