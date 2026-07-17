---
description: Durable rules for product-built-in Agent orchestration, SDK build artifacts, runtime caching, native behavior mapping, and model snapshots.
applyTo: "{build/agent-sdk/**,src/cs/platform/agentHost/common/**,src/cs/platform/agentHost/node/agentSdkDownloader.ts,src/cs/platform/agentHost/node/agents/**,src/cs/code/electron-main/main.ts,src/cs/sessions/contrib/providers/agentHost/**,src/cs/workbench/contrib/preferences/**}"
---

# Agent SDK integrations

Read `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/AGENT_PACKAGES.md`, `src/cs/sessions/TOOLS.md`, and every applicable migration document before changing an Agent SDK integration.

## Built-in orchestration

Comet, Claude, and Codex are product-built-in Agent orchestration layers. Each implements `IAgent` directly in Agent Host Node. Their behavior mapping, canonical protocol mapping, configuration projection, model projection, and generated native protocol types compile with the App.

Claude Agent SDK and Codex app-server remain their orchestration authorities. Comet supplies common behavior, interaction, persistence, connection, Tool, and presentation substrates; it never reconstructs their native model loops, Tool loops, plans, tasks, subagents, background work, compaction, retry, or terminal decisions.

```text
normalized Comet request and addressed user operations
    → App-compiled SDK-native mapping
        → SDK-owned orchestration
            → exhaustive native event and request mapping
                → canonical Comet behavior and interaction state
```

The connected Agent Runtime Protocol is reserved for genuinely external Agents whose implementation belongs outside the product Agent Host process. Claude and Codex never translate through that protocol.

## SDK bytes and product availability

Product-built-in Agent availability is independent from SDK cache presence:

```text
App product configuration
    → built-in Agent availability without network access
        → explicit Agent preparation
            → development SDK root or exact version-and-target cache
                → cold download when the cache is absent
                    → native model discovery
                        → exact active registration and Session type
```

Startup, passive Agent discovery, Settings rendering, restoration scans, and unrelated Agent operations never trigger a cold SDK download. A user action that selects a cold built-in Agent prepares it before draft or Session creation. Turn execution never hides an SDK download.

Deleting cached SDK bytes is not uninstalling an Agent. The product definition remains available and the next explicit preparation downloads the same App-selected version again. Users do not select arbitrary SDK versions, run package managers, or own SDK directories.

Claude and Codex do not appear in installable or installed external Agent package catalogs. Generic package install, update, and uninstall remain only for genuinely external Agents.

## Exact resolution

`AgentSdkDownloader` is provider-neutral. Agent-specific modules declare only:

- stable SDK package ID;
- display metadata;
- explicit development-root environment variable;
- whether Linux publishes a distinct musl target.

The downloader owns:

- supported platform and architecture resolution;
- exact product `{ version, urlTemplate }` lookup;
- cache identity `<package>/<version>/<sdkTarget>`;
- completed-cache recognition through an atomically published sentinel;
- concurrent cold-download deduplication;
- cancellation and bounded progress;
- archive byte and extracted-content limits;
- rejection of links, special files, absolute paths, traversal, and archive-provided completion markers;
- extraction into a unique staging directory;
- atomic publication;
- cleanup after failure or cancellation;
- short negative caching of repeated failures.

Resolution has one authoritative source. An explicitly configured development root replaces product resolution for that process. Otherwise, the exact product URL is used. Failure never selects another URL, SDK version, target, package, executable, or implementation.

The downloader returns an SDK root. Agent-specific code resolves and validates its own module, executable, artifact receipt, and generated protocol receipt under that root.

## Build and version ownership

Exact pins and reproducible dependency graphs live under:

```text
build/agent-sdk/agents/<agent>/
├── package.json
└── package-lock.json
```

`build/agent-sdk` produces target-specific tarballs and a product-stamping receipt. It does not contain Agent behavior. Each tarball contains the complete runtime SDK closure needed by one target:

- Claude: bundled SDK module, matching Claude executable, and artifact receipt;
- Codex: matching app-server executable, generated protocol receipt, and artifact receipt.

The release pipeline publishes these immutable tarballs and stamps the App product configuration with the exact version and `{sdkTarget}` URL template. An App update changes the SDK version selection. Cache filling never changes product configuration.

When production TypeScript imports SDK types, the root development dependency uses the same exact version as the build pin. It is a build and test input, not the runtime SDK installation.

Codex generated protocol files bind to the exact pinned app-server version. Changing the Codex pin requires regenerating and verifying the protocol receipt in the same change.

## Native behavior mapping

An integration exhaustively classifies every native notification, streamed message, callback, server request, and control operation from its pinned SDK version as:

- canonical durable behavior;
- an addressed interactive request that blocks until Comet returns the exact response;
- bounded ephemeral status or diagnostics;
- an explicitly rejected unsupported native event.

Semantic events are never silently ignored, flattened into generic text, or reported complete before the native terminal event. Interactive requests retain native correlation together with exact Session, Chat, Turn, optional parent activity, and cancellation lifetime.

Host, Sessions, Chat, and UI code consume canonical behavior kinds. They never branch on `claude`, `codex`, or another Agent ID.

SDK-native Tools and reserved harness operations remain selected and executed by the SDK. Their lifecycle, permissions, input, output, and effects map into canonical Comet behavior without claiming a Host Tool registration. Comet-contributed Tools retain canonical registrations and execute through the Host Tool Execution Port after the Agent projects them through its supported SDK extension surface.

## Direct Agent boundary

Claude and Codex implement the same `IAgent` surface as Comet:

```typescript
interface IAgent {
	readonly id: AgentId;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;
	readonly configuration: IAgentConfiguration;
	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly resumeStates: IAgentResumeStates;
}
```

The SDK-native object graph, callbacks, app-server protocol values, aliases, and process handles remain private to the owning Agent directory. There is no provider runtime facade, provider-to-`IAgent` adapter, or Comet-owned replacement reasoning loop.

## Model snapshots

Model metadata comes only from the prepared exact SDK:

- Claude consumes `query.supportedModels()`;
- Codex consumes every `model/list` page with `includeHidden: false`.

The integration validates non-empty unique native model IDs and all provider-specific configuration metadata, then derives canonical model, schema, descriptor, and registration revisions from the complete content. Product configuration and UI code never maintain a parallel Claude or Codex model list.

Cold Agent availability is not a model snapshot. The Host publishes model-backed Session types only after preparation succeeds. A failed or cancelled preparation does not publish a partial descriptor, registration, Session type, or completed cache.

## Ownership

| Path | Durable owner |
|---|---|
| `build/agent-sdk/agents/<agent>/` | Exact SDK pin and reproducible dependency graph |
| `build/agent-sdk/` | Target tarball and product-stamping receipt production |
| `src/cs/platform/agentHost/node/agentSdkDownloader.ts` | Provider-neutral exact SDK download cache |
| `src/cs/platform/agentHost/node/agents/agentSdkProducts.ts` | Built-in SDK identities, versions, and product URL templates |
| `src/cs/platform/agentHost/node/agents/<agent>/` | Direct `IAgent`, SDK loading, native behavior mapping, and model discovery |
| `src/cs/platform/agentHost/common/` | SDK-neutral Agent, behavior, interaction, model, configuration, credential, and Tool contracts |
| `src/cs/platform/agentHost/node/packages/` | External Agent package management only |
| `src/cs/code/electron-main/main.ts` | Application composition only |

Do not place SDK resolution, native model discovery, provider behavior, or Agent definitions under `src/cs/code`. Do not place runtime behavior under `build`.

## Invariants

- Comet, Claude, and Codex are product-built-in Agents.
- Built-in Agent behavior mappings compile with the App; only exact SDK bytes are downloaded.
- Built-in availability does not imply a completed SDK cache or active model snapshot.
- Startup and passive reads never perform cold SDK downloads.
- Explicit preparation completes before draft, Session, or Turn creation.
- SDK cache deletion never changes Agent availability or retained Session ownership.
- SDK versions are selected by the App and change only through an App update.
- Product SDK downloads are exact-version and exact-target, safely extracted, cancellable, deduplicated, and atomically published.
- Product-maintained SDKs implement `IAgent` directly.
- External packages retain the generic package lifecycle and never become a built-in SDK cache entry.
- Native SDK orchestration remains authoritative.
- Models come only from the prepared exact SDK.
- No failure path selects another SDK source, version, target, Agent, model list, or execution kind.
