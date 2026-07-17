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
Agent Runtime Protocol. Agent implementations own SDK or model-provider
projection; the Comet Agent owns Comet orchestration. Feature contributions never import
Agent SDKs or model-provider formats. The shared client connection publishes
connected executors and carries canonical execution messages. Attachment
content-resource providers remain with their Feature producers and do not enter
the Tool registry merely because a remote Host reads them through the
originating client.

## Remote Organization

- `cs/platform/remote/common` — Remote authorities, resolver and connection
  contracts, management protocol, channel context, URI transformation,
  versions, limits, and errors
- `cs/platform/remote/browser` — Browser transport and authority-resolution
  support
- `cs/platform/remote/electron-browser` — Desktop Remote management transport
  support
- `cs/platform/remote/node` — Shared Remote Server transport primitives
- `cs/platform/tunnel/common` — Remote Tunnel providers, descriptors,
  endpoints, hosting, relay connections, port forwarding, proxy values,
  identities, limits, and errors
- `cs/platform/tunnel/browser` — Browser-provided tunnel discovery and relay
  connections
- `cs/platform/tunnel/electron-browser` — Renderer-facing tunnel composition
  and IPC clients
- `cs/platform/tunnel/electron-utility` — Desktop provider SDK and relay
  ownership
- `cs/platform/tunnel/node` — Shared relay, hosting, and port-forwarding
  primitives
- `cs/workbench/services/remote` — Selected Remote Server connection,
  environment, application lifecycle, and remote-resource wiring
- `cs/server/node` — Remote Server bootstrap, handshake, channel registry,
  filesystem, process, storage, and lifecycle composition

Platform Remote and Platform Tunnel never import Workbench, Sessions, Agent
Host, or Code. One application instance consumes one persistent
`IRemoteServerConnection` for its selected Remote authority. Higher Remote
subsystems obtain typed channels from that connection; they never resolve the
authority again, open a private management socket, or own another Remote
Server lifecycle.

The Remote and Remote Tunnel foundations restore only their own transport
continuity. Each stateful subsystem owns semantic recovery after reconnection.
Remote Agent Host follows `src/cs/sessions/REMOTE_AGENT_HOST.md`: it consumes
either the Agent Host channel on one Remote Server connection or one direct
Remote Tunnel `agentHost` endpoint. Those routes are explicit peers and never
replace one another after failure.

## Agent Host Organization

- `cs/platform/agentHost/common` — environment-neutral Host protocol, Agent
  Runtime Protocol, connection contracts, and Host-side Agent contracts
- `cs/platform/agentHost/browser` — common browser connection support and the
  Remote Agent Host protocol over supplied Remote Server channel or Remote
  Tunnel endpoint transports
- `cs/platform/agentHost/electron-browser` — desktop local Host connection
- `cs/platform/agentHost/node` — Host authority, Agent activation, and Node implementation support
- `cs/platform/agentHost/node/packages` — Agent package discovery, staging,
  verification, installed catalog, operations, storage, and atomic activation
- `cs/platform/agentHost/node/runtime` — generic connected Agent runtime
  negotiation, correlation, and lifecycle
- `cs/platform/agentHost/node/agents/comet` — product-bundled Comet `IAgent`
- `cs/platform/agentHost/node/agents/<agent>` — product-maintained SDK-specific
  `IAgent` behavior; Claude and Codex use this owner

Agent Host is a Platform subsystem and never imports Workbench or Sessions.
Comet, Claude, and Codex are product-built-in Agent orchestration layers.
Claude and Codex resolve exact SDK bytes through the Agent SDK download cache
during provider-owned first-draft activation. Genuinely external Agents retain the package
lifecycle. A package manifest declares `execution.kind: 'host'` for a direct
external Host Agent or `execution.kind: 'connected'` for an external
implementation in another process. Package ID, Agent ID, registration,
authentication, SDK cache resolution, and materialization remain separate.
Transient long-operation progress is defined under `cs/platform/progress` and
presented under `cs/workbench/services/progress`. Feature and provider code
reports addressed progress; it does not construct private progress-bar systems.

Remote Server Agent Host composition lives under
`cs/server/node/agentHost`. It constructs the shared Platform Node Host
authority and binds the Remote channel directly. Platform Agent Host never
imports the Workbench Remote service or the Server layer.

Remote Tunnel Agent Host hosting binds an `agentHost` endpoint directly to the
shared Platform Node Host authority. Tunnel provider and relay mechanics remain
in `cs/platform/tunnel`; Sessions owns discovery UX and provider registration.

`IAgent` is the single Host-facing semantic port. Product-bundled Comet and
product-maintained Claude or Codex SDK integrations implement it directly under
`cs/platform/agentHost/node/agents/<agent>`. Genuinely external packages may
implement the language-neutral Agent Runtime Protocol and join through
`IAgentRuntimeConnection`; generic connection code lives under
`cs/platform/agentHost/node/runtime`, not in Agent-specific Sessions or Feature
code. An SDK-backed Agent maps its SDK-owned orchestration and native behavior
into the common Comet behavior substrate; only `CometAgent` owns Comet
orchestration. SDK and model-provider Tool formats, aliases, call conversion,
result encoding, and native event correlation remain inside their owning
Agent. No
parallel Tool conversion or execution layer exists in Feature contributions.
Agent Host contracts, connected-runtime support, and the in-repository
Host Agents belong in this subsystem rather than a parallel
top-level `cs/agent` layer. SDK-specific TypeScript source remains under the
owning `node/agents/<agent>` directory. Exact SDK pins and target tarball
production live under `build/agent-sdk`; downloaded SDK bytes remain private
to the built-in Agent cache. Product-maintained SDKs do not add provider
runtime processes. Sessions contributions never import the package manager,
downloader, or an SDK implementation.

## Sessions Organization

- `cs/sessions/{common|browser|electron-browser}` — application core, shell, layout, and Parts
- `cs/sessions/services` — provider-agnostic application and session services
- `cs/sessions/contrib` — Sessions-specific feature integrations
- `cs/sessions/contrib/providers/agentHost` — shared Agent Host Sessions
  provider plus local, Remote Server, and Remote Tunnel Host connection
  registration; remote contributions obtain exact lower transports from
  `IRemoteServerService` or the Remote Tunnel service
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
- Direct and connected Agents register with Platform Agent Host, not with
  Sessions. One shared Agent Host Sessions provider maps each Host
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

Remote-capable targets initialize Remote transport and `IRemoteServerService`,
negotiate the Remote Server environment, and only then load the Remote Agent
Host provider contribution. The Remote Server advertises the Agent Host
channel only after its owning Host composition is live.

## Dependency Injection

Services are consumed via constructor injection with decorator identifiers:

```typescript
class MyComponent {
  constructor(@IMyService private readonly myService: IMyService) { }
}
```

Services are provided via `registerSingleton(IMyService, MyServiceImpl, InstantiationType.Delayed)`.
