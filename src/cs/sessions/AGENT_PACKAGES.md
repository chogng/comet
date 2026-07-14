# Agent package architecture

## Boundary

An Agent package is the Host-owned installation and activation unit for one or
more Agents. An Agent SDK is a private dependency inside that package.

```text
Agent package
├── product identity and revision
├── target and content digest
├── declared Agent IDs
├── execution kind: host | connected
├── verified SDK/module/executable dependency closure
└── privilege grant

IAgent
├── descriptor and models
├── execution profiles and configuration
├── Sessions and Chats
├── resume state
└── actions
```

Users install Agent packages. They do not install unqualified SDK directories,
run provider package managers, or select arbitrary provider versions.

Package lifecycle belongs to the addressed Agent Host. Sessions, Workbench
Chat, and Settings consume canonical Host snapshots and never inspect or load
package files directly.

## Distribution and execution

Every supported Host starts with exactly one bundled package:

| Package ID | Agent ID | Distribution | Initial state | Execution |
|---|---|---|---|---|
| `comet` | `comet` | bundled | installed and active | direct Host `IAgent` |

Claude, Codex, Copilot, and other optional packages are absent until the user
installs them for one exact Host authority and user scope. Listing an offering
does not install or activate it.

Execution kind is explicit:

| `manifest.execution.kind` | Meaning |
|---|---|
| `host` | Product-authorized factory constructs an `IAgent` inside Agent Host Node |
| `connected` | A genuinely external process negotiates the Agent Runtime Protocol |

Product-maintained Claude and Codex SDK integrations use `host`. Their Agent
implementations live under `src/cs/platform/agentHost/node/agents/<agent>/`.
They do not add provider runtime processes. The connected form remains for an
implementation whose process boundary is part of its actual design.

Installing Claude on the local Host does not install it on a Remote Server or
Remote Tunnel Host. Each Host owns its own package state.

## Repository and release ownership

| Concern | Owner |
|---|---|
| Exact SDK version and lockfile | `build/agent-sdk/agents/<agent>/` |
| Target SDK artifact production | `build/agent-sdk/` |
| SDK-specific `IAgent` behavior | `src/cs/platform/agentHost/node/agents/<agent>/` |
| Generic catalog, verification, activation, update, uninstall, and cleanup | `src/cs/platform/agentHost/node/packages/` |
| SDK-neutral package and Agent contracts | `src/cs/platform/agentHost/common/` |
| Package, model, and configuration UI | `src/cs/workbench/contrib/preferences/` |
| Process startup | `src/cs/code/electron-main/main.ts` |

Comet chooses, tests, and publishes an exact SDK revision. The build pin and
lockfile produce target artifacts; a common package offering identifies those
immutable bytes. Application startup consumes that product catalog and does not
construct an offering from root `node_modules`.

For example, Claude build ownership is explicit:

```text
build/agent-sdk/agents/claude/
├── entry.ts
├── package.json
└── package-lock.json
```

Updating the SDK is a Comet release change. The user authorizes a common Host
update operation; the user does not maintain the dependency graph.

## Identities and catalogs

| Identity | Meaning |
|---|---|
| Agent package ID | Stable installation identity such as `claude` |
| Agent package revision | Exact SDK version, target, manifest, and content revision |
| Agent ID | Stable behavior identity registered with Host |
| Agent registration revision | Exact descriptor, capabilities, schemas, Tools, and resume support |
| Package operation ID | Retry-safe mutation identity |

Package ID and Agent ID use separate namespaces even when both strings are
`claude`. Historical Session and Chat records retain both owning IDs; another
package that later claims the same Agent ID cannot receive that opaque state.

Agent Host owns three distinct catalogs:

1. `installablePackages` lists authorized offerings the user may install.
2. `installedPackages` records exact verified package receipts.
3. `activations` binds installed package revisions to active Agent
   registrations.

Only the installed catalog proves installation. Only activation proves that an
Agent can execute. An SDK file, credential, environment variable, model name,
or historical Session proves neither.

## Manifest and dependency closure

The common manifest is SDK-neutral:

```typescript
export type AgentPackageExecution =
	| { readonly kind: 'host' }
	| { readonly kind: 'connected'; readonly entryPoint: string };

export interface IAgentPackageDependency {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	readonly digest: AgentPackageContentDigest;
	readonly license: string;
	readonly executable: boolean;
}

export interface IAgentPackageManifest {
	readonly schema: number;
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly publisher: string;
	readonly target: IAgentPackageTarget;
	readonly execution: AgentPackageExecution;
	readonly agentIds: readonly AgentId[];
	readonly dependencies: readonly IAgentPackageDependency[];
	readonly privileges: readonly IAgentPackagePrivilege[];
}
```

A product-maintained SDK package has no Agent Runtime Protocol entry point:

```typescript
execution: Object.freeze({ kind: 'host' }),
dependencies: Object.freeze([
	Object.freeze({
		id: 'claude.agent-sdk-module',
		target: 'vendor/claude-agent-sdk/sdk.js',
		executable: false,
		// source, digest, and license omitted here only for readability
	}),
	Object.freeze({
		id: 'claude.agent-sdk-executable',
		target: 'vendor/claude-agent-sdk/claude',
		executable: true,
		// source, digest, and license omitted here only for readability
	}),
]),
```

A connected package names exactly one entry point, and that entry point must be
one executable dependency in its verified closure:

```typescript
execution: Object.freeze({
	kind: 'connected',
	entryPoint: 'bin/external-agent.js',
})
```

The installed receipt carries the complete closure with a verified digest and
`immutable: true` for every dependency. Missing, duplicate, mutable, digest-
mismatched, or target-mismatched dependencies reject the package.

## Installation and activation

```text
install(packageId)
    → address one exact offering and expected catalog revision
    → stage every dependency under one operation ID
    → verify manifest, target, closure, modes, digests, and privileges
    → prepare one package activation
        host      → product factory loads installed SDK bytes and creates IAgent
        connected → sandbox launches exact connected entry point
    → validate the complete Agent registration set
    → commit installed receipt and activation atomically
    → publish the new Host root snapshot
```

No Agent registration is visible before the package commit. A failed SDK load,
model discovery, external handshake, retained-state validation, or registration
validation leaves no partial installation.

The package operation request is idempotent:

```typescript
const request: IAgentPackageOperationRequest = Object.freeze({
	operation,
	digest,
	expectedCatalogRevision,
	payload: Object.freeze({ kind: 'install', packageId, offering }),
});
```

Repeating the same operation and digest reconciles its recorded outcome.
Repeating the operation with another digest reports a conflict. The caller does
not create a new identity while the earlier outcome is uncertain.

## Models and configuration after activation

Package metadata does not maintain the provider model list. The active Agent
obtains native model facts from its installed SDK and publishes canonical
descriptors through its registration.

```text
installed Claude SDK query.supportedModels()
    → validate non-empty unique native snapshot
    → map native IDs and capabilities
    → content-derived Agent/model descriptor revisions
    → Host snapshot
    → Sessions model picker + Settings model rows
```

Configuration is also active Agent state. The package manifest grants required
resources; the Agent publishes typed Host-default, Session, and model schemas.
Raw SDK types and credentials do not enter package manifests or catalog state.

## Update

An update is one package-wide transaction:

```text
gate every Agent ID in the package
    → stop admitting lifecycle mutations and new Turns
    → drain accepted non-terminal work
    → checkpoint and release materialized backing
    → stage and verify the complete new artifact closure
    → construct the new Agent activation
    → validate every retained resume state
    → migrate only declared schema edges
    → atomically commit package, registrations, and migrated resume state
    → retire the previous activation and artifacts
```

If the new activation cannot restore or migrate every retained record, the
update fails before commit. A committed update does not switch back to the
previous revision after later failure.

## Uninstall and data ownership

Uninstall removes the installed receipt, active registrations, and unreferenced
SDK artifacts. It preserves Host Session history and credentials.

These operations remain separate:

| Operation | Requires active Agent | Deletes Host history | Deletes provider backing |
|---|---:|---:|---:|
| Uninstall package | yes during quiescing | no | no |
| Delete Agent-backed data | yes | commits matching catalog deletion | yes, through Agent contract |
| Purge retained Host records | package and registrations must be absent | yes | no |
| Delete credential | no | no | no; removes Secret Storage value only |

Reinstall validates retained resume state before activation. It does not infer
compatibility from matching Agent IDs.

## Authority and isolation

Every installed dependency is read from one immutable receipt directory. The
Host verifies regular-file type, canonical location, digest, target uniqueness,
and executable mode before use.

Direct Host Agents receive only explicit Host services and installed SDK
bindings:

```typescript
createAgent(installedPackage, {
	toolExecution,
	credentialResolver,
});
```

Connected Agents additionally receive a sandbox authority derived from their
verified manifest. The sandbox starts only the declared entry point and never
gains ambient Host service objects. Process, filesystem, network, secret, and
Tool-executor access cannot exceed the committed grant.

SDK and helper updates always produce a new package revision. A cache fill,
Session start, authentication request, or first Turn never replaces executable
code.

## Module layout

```text
src/cs/platform/agentHost/
├── common/
│   └── package identities, manifests, catalogs, operations, and errors
└── node/
    ├── agents/
    │   ├── comet/
    │   └── claude/
    │       ├── claudeAgent.ts
    │       ├── claudeAgentDefinition.ts
    │       ├── claudeAgentPackage.ts
    │       └── claudeAgentSessionStore.ts
    ├── packages/
    │   ├── agentPackageActivationRegistry.ts
    │   ├── agentPackageLifecycle.ts
    │   ├── localAgentPackageArtifactPort.ts
    │   └── productAgentPackageCatalog.ts
    └── runtime/
        └── generic connected-Agent negotiation only
```

Settings and Sessions provider code consume common snapshots. They do not
import any file under `node/agents` or `node/packages`.

## Adding an optional package

For a product-maintained SDK:

1. Add the exact build pin, lockfile, entry module, and target artifact output
   under `build/agent-sdk/agents/<agent>/`.
2. Implement `<Agent> implements IAgent` under
   `src/cs/platform/agentHost/node/agents/<agent>/`.
3. Publish a `host` package product with the complete SDK artifact closure.
4. Add the offering to `productAgentPackageCatalog.ts`; do not install it by
   default.
5. Test artifact integrity, install, direct activation, SDK model discovery,
   configuration, update, uninstall, and retained-state validation.

For a genuinely external Agent:

1. Publish a `connected` package with one verified executable entry point.
2. Implement the Agent Runtime Protocol without a second semantic Agent API.
3. Test sandbox authority, protocol negotiation, disconnect, reconciliation,
   update, and uninstall.

Neither form adds provider-specific package or Settings services.

## Invariants

- Comet is the only bundled and default-installed package.
- Every optional package requires an explicit install for one addressed Host.
- Product-maintained SDKs implement `IAgent` directly in Platform Agent Host
  Node; connected execution is reserved for genuine external processes.
- Package ID, Agent ID, registration, authentication, and materialization remain
  distinct.
- Build pins and lockfiles select SDK versions; users do not manage provider
  package versions.
- Activation verifies the entire SDK/module/executable closure before publishing
  any registration.
- Session creation, Turn execution, authentication, and Agent discovery never
  install, update, or download package code.
- Models come from the active Agent's installed SDK snapshot, not a UI or
  product-maintained provider list.
- Updates commit package, registrations, and resume migrations atomically.
- Uninstall preserves Session history and never deletes credentials or provider
  backing implicitly.
- Missing packages, corrupt artifacts, unsupported targets, invalid model
  snapshots, incompatible resume state, and denied privileges fail explicitly.
- No failure path selects another source, revision, execution kind, Agent, or
  model list.
