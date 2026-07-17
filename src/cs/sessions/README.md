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

Built-in Agent registrations, external Agent package lifecycle, Agent
contracts, runtime connections, and the embedded Comet implementation live in
the lower `src/cs/platform/agentHost/` subsystem. Sessions consumes them only
through an Agent Host connection and the shared provider contribution.

Remote product composition uses the lower
`src/cs/platform/remote/` foundation and `cs/workbench/services/remote` to
reach one Comet Remote Server. Remote Tunnel composition uses
`src/cs/platform/tunnel/` to publish, discover, and connect typed relay
endpoints. Remote Agent Host consumes either the shared Remote Server channel
or one exact Remote Tunnel `agentHost` endpoint; neither route replaces the
other after failure.

## Documentation

| Document | Purpose |
|---|---|
| [SESSIONS.md](SESSIONS.md) | Domain model, services, providers, lifecycle, persistence, and Chat integration |
| [AGENT_HOST.md](AGENT_HOST.md) | Agent Runtime Port, Agent configuration, common execution profiles, embedded and connected runtimes, Host connections, and Sessions integration |
| [REMOTE_AGENT_HOST.md](REMOTE_AGENT_HOST.md) | Remote Agent Host placement over Remote Server and Remote Tunnel routes, connection recovery, resources, and Sessions registration |
| [Remote foundation](../platform/remote/REMOTE.md) | Remote authorities, persistent management connections, channels, Remote Server ownership, and remote resources |
| [Remote Tunnel](../platform/tunnel/REMOTE_TUNNEL.md) | Tunnel identity, endpoint publication, discovery, hosting, relay connections, authentication, and recovery |
| [AGENT_PACKAGES.md](AGENT_PACKAGES.md) | External Agent package catalogs, verification, activation, update, deletion, retained data, and the distinct built-in SDK cache |
| [COMET_AGENT.md](COMET_AGENT.md) | Comet execution profiles, Host Turn binding, model-and-Tool orchestration, Rust runtime slot, workers, and resumption |
| [ATTACHMENTS.md](ATTACHMENTS.md) | Composer attachments, producers, content-resource transport, submission, and source-specific rules |
| [TOOLS.md](TOOLS.md) | Canonical Tools, schema profiles, Turn-bound Tool sets, Agent projection, calls, results, and executor routing |
| [INTERACTION_TARGETS.md](INTERACTION_TARGETS.md) | Request-scoped resource targets, explicit Chat binding, and lazy Tool operations |
| [LAYOUT.md](LAYOUT.md) | Product shell, Parts, visibility, focus, editor presentation, and CSS ownership |
| [LAYERS.md](LAYERS.md) | Import hierarchy, contribution boundaries, and entry points |

## Adding functionality

1. Put application shell, layout, and core Part code in `browser/`.
2. Put provider-agnostic application and session services in `services/`.
3. Put target-specific layout policy in `contrib/layout/`.
4. Put optional changes, terminal, task, list, action, editor, and Chat
   integrations in `contrib/<feature>/`.
5. Put genuinely external Agent package lifecycle in
   `cs/platform/agentHost/node/packages/`. External packages require an
   explicit per-Host user install operation.
6. Keep product-maintained Agent implementations in
   `cs/platform/agentHost/node/agents/<agent>/`. Product-built-in
   orchestrators implement `IAgent` directly and resolve SDK bytes only
   through their exact product cache. Put genuinely external Agent processes
   behind the common Agent Runtime Protocol and `IAgentRuntimeConnection`.
7. Put Remote authority, persistent connection, channel, and Remote Server
   infrastructure in the owners defined by the
   [Remote foundation](../platform/remote/REMOTE.md). Put tunnel discovery,
   hosting, relay, forwarding, and proxy infrastructure in
   [Remote Tunnel](../platform/tunnel/REMOTE_TUNNEL.md).
8. Put shared Host-to-Sessions integration in `contrib/providers/agentHost/`.
   Remote Server and Remote Tunnel contributions use their exact lower
   transports as defined by
   [Remote Agent Host architecture](REMOTE_AGENT_HOST.md); neither route
   replaces the other or defines another Agent Host Protocol.
9. Keep reusable single-conversation and editor infrastructure in
   `cs/workbench` and integrate it from the higher Sessions layer.
10. Register contributions only from Sessions entry points.
11. Update the owning architecture, layout, and layer documents with every
   durable boundary change.
