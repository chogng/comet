---
description: Comet Studio source code organization — layers, target environments, dependency injection, and folder structure conventions. Reference when adding new modules, services, or contributions.
applyTo: src/cs/**
---

# Source Code Organization

## Layers

The `src/cs/` core is partitioned into ordered layers — each may only import from layers below it:

1. **`base`** — General utilities and UI building blocks (no service dependencies)
2. **`platform`** — Service injection support and base services shared across layers
3. **`editor`** — Monaco Editor core (no `node` or `electron-*` dependencies)
4. **`workbench`** — Reusable Workbench services, Parts, views, contributions, and framework
5. **`sessions`** — Comet's Agent application shell, session services, Parts, and contributions
6. **`code`** — Desktop app entry point (Electron main, shared process, CLI)
7. **`server`** — Server app entry point for remote development

`sessions` is the only product shell started by Comet. It sits above Workbench
and may consume public Workbench APIs. Workbench and lower layers never import
Sessions.

## Target Environments

Within each layer, code is organized by runtime environment:

| Folder | APIs Available | May Use |
|--------|---------------|---------|
| `common` | Basic JavaScript only | — |
| `browser` | Web/DOM APIs | `common` |
| `node` | Node.js APIs | `common` |
| `electron-browser` | Browser + limited Electron IPC | `common`, `browser` |
| `electron-utility` | Electron utility process | `common`, `node` |
| `electron-main` | Electron main process | `common`, `node`, `electron-utility` |

## Workbench Organization

- `cs/workbench/{common|browser|electron-browser}` — minimal workbench core
- `cs/workbench/api` — `vscode.d.ts` API provider
- `cs/workbench/services` — core services (not contrib-specific)
- `cs/workbench/contrib` — feature contributions
- `cs/workbench/contrib/chat` — single-conversation models and interaction UI
- `cs/workbench/contrib/files` — Comet-owned File and Directory attachment
  producers and source actions over public Workbench file services

Generic attachment collections, registries, and submission transactions live
with `cs/workbench/contrib/chat`. Article, PDF, File, Directory, Editor, and
Browser producers remain with the contribution that owns the source semantics
and consume Chat's public API. Platform Agent Host owns only normalized content
and resource protocol contracts; it never owns a Workbench Feature producer.

Generic interaction-target state lives with Workbench Chat. Tool descriptors,
targets, and executor implementations live with the contribution that owns the
Feature service. Platform Agent Host owns canonical Tool schema profiles,
descriptors, executor bindings, Tool sets, routing, call state, results,
permissions, the Tool Execution Port, the Host-side `IAgent` port, and the
Agent Runtime Protocol. Agent runtimes own SDK or model-provider projection;
the Comet runtime owns Comet orchestration. Feature contributions never import
Agent SDKs or model-provider formats. The shared client connection publishes
connected executors and carries canonical execution messages. Attachment
content-resource providers remain with their Feature producers and do not enter
the Tool registry merely because a remote Host reads them through the
originating client.

## Agent Host Organization

- `cs/platform/agentHost/common` — environment-neutral Host protocol, Agent
  Runtime Protocol, connection contracts, and Host-side Agent contracts
- `cs/platform/agentHost/browser` — remote-capable connection support
- `cs/platform/agentHost/electron-browser` — desktop local Host connection
- `cs/platform/agentHost/node` — Host runtime and runtime endpoint support
- `cs/platform/agentHost/node/packages` — Agent package discovery, staging,
  verification, installed catalog, operations, storage, and atomic activation
- `cs/platform/agentHost/node/runtime` — generic connected Agent runtime
  negotiation, correlation, and lifecycle
- `cs/platform/agentHost/node/agents/<agent>` — optional embedded Agent runtime
  implementations

Agent Host is a Platform subsystem and never imports Workbench or Sessions.
Comet is the only bundled and default-installed Agent package. Every optional
Agent package is absent until an explicit user install operation commits for
the addressed Host; Session creation and Turn execution never install or
download it. Package ID, Agent ID, runtime registration, authentication, and
materialization remain separate.

`IAgent` is the single Host-facing semantic port. Embedded runtimes implement
it under `cs/platform/agentHost/node/agents/<agent>`. External or cross-language
runtimes implement its language-neutral Agent Runtime Protocol and join through
`IAgentRuntimeConnection`; generic connection code lives under
`cs/platform/agentHost/node/runtime`, not in Agent-specific Sessions or Feature
code. SDK and model-provider Tool formats, aliases, call conversion, result
encoding, and Comet orchestration remain inside their owning runtime. No
parallel Tool conversion or execution layer exists in Feature contributions.
Agent Host contracts, connected-runtime support, and in-repository embedded
runtime code belong in this subsystem rather than a parallel top-level
`cs/agent` layer. A connected runtime package owns its implementation outside
the TypeScript layer and exposes only the Agent Runtime Protocol to Agent Host.
SDKs are private dependencies of installed Agent runtimes, not product
installation identities. Sessions contributions never import the package
manager or an SDK implementation.

## Sessions Organization

- `cs/sessions/{common|browser|electron-browser}` — application core, shell, layout, and Parts
- `cs/sessions/services` — provider-agnostic application and session services
- `cs/sessions/contrib` — Sessions-specific feature integrations
- `cs/sessions/contrib/providers/agentHost` — shared Agent Host Sessions
  provider plus local and remote Host connection registration
- `cs/sessions/sessions.*.main.ts` — Sessions contribution entry points

`agentHost` is the only built-in provider family name. Agent IDs such as
`comet` name behavior, and `local` and `remote` name Host placement. Do not
create a `default`-prefixed provider, Session, Chat, file, directory, or
implementation symbol, and do not introduce `mainChat` as a special Chat role.

### Workbench Contribution Rules

- Within Workbench, non-entrypoint code outside `contrib/` does not import
  Workbench contribution implementations
- Each contribution has a single `.contribution.ts` entry point
- Contributions expose internal API from a single common file
- Cross-contribution dependencies use that common API — never reach into internals

Higher application layers may consume a Workbench contribution's documented
public API. Sessions-specific integration with a Workbench contribution belongs
in `cs/sessions/contrib/<feature>`, not in Sessions core or Workbench.

### Sessions Contribution Rules

- Sessions core and services do not import Sessions contributions.
- Non-provider Sessions contributions do not import provider implementations.
- Providers register through public Sessions service contracts.
- Embedded and connected Agent runtimes register with Platform Agent Host, not
  with Sessions. One shared Agent Host Sessions provider maps each Host
  connection to `ISessionsProvider`.
- Sessions entry points are the only modules that load Sessions contribution
  entry points for side effects.

## Entry Points

Only code referenced from entry point files is loaded:

- `workbench.common.main.ts` — shared Workbench foundation
- `workbench.desktop.main.ts` — desktop Workbench foundation
- `workbench.web.main.ts` — web Workbench foundation
- `sessions.common.main.ts` — shared Sessions application contributions
- `sessions.desktop.main.ts` — desktop Sessions application contributions
- `sessions.web.main.ts` — web Sessions application contributions

Sessions entry points load the corresponding Workbench foundation entry point
before Sessions contributions. Code and server bootstrap the Sessions
application, not the Workbench shell.

## Dependency Injection

Services are consumed via constructor injection with decorator identifiers:

```typescript
class MyComponent {
  constructor(@IMyService private readonly myService: IMyService) { }
}
```

Services are provided via `registerSingleton(IMyService, MyServiceImpl, InstantiationType.Delayed)`.
