# Agent package architecture

## Boundary

Agent packages are the installation and isolation contract for genuinely external Agents. They are distinct from Comet's product-built-in Agent orchestration layers.

Comet, Claude, and Codex are built into the product:

- their `IAgent` implementations and behavior mappings compile with the App;
- Claude and Codex resolve product-owned SDK bytes through the versioned Agent SDK cache;
- they never appear in installable or installed external package catalogs;
- deleting their cached SDK bytes is not uninstalling an Agent.

External Agents enter one addressed Agent Host only through an explicit package install transaction:

```text
product-authorized external package offering
    → stage complete dependency closure
    → verify identity, target, digests, privileges, and execution kind
    → construct and validate exact Agent registrations
    → atomically commit installed receipt and registrations
```

Session creation, Turn execution, authentication, and passive discovery never install or update an external package.

## Distinct state

These identities and states never substitute for one another:

| Concern | Authoritative state |
|---|---|
| Built-in Agent availability | App product definition |
| Built-in SDK bytes | exact version-and-target cache |
| Built-in active registration | completed Agent preparation and native model snapshot |
| External package availability | installable package catalog |
| External package installation | installed package receipt |
| Agent execution | active runtime registration |
| Agent credentials | typed Secret Storage reference and Turn-scoped grant |
| Session or Chat restoration | owning Agent identity, retained backing, and resume schema |

Matching Agent IDs, files, credentials, product metadata, display names, or cache directories never prove installation or active registration.

## External package contracts

An offering identifies one immutable product-authorized external package revision:

```typescript
interface IAgentPackageOffering {
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly source: string;
	readonly distribution: 'bundled' | 'user';
}
```

A manifest declares exact execution ownership, Agent IDs, target, dependency closure, and privileges:

```typescript
interface IAgentPackageManifest {
	readonly schema: 1;
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly publisher: string;
	readonly target: IAgentPackageTarget;
	readonly execution:
		| { readonly kind: 'host' }
		| { readonly kind: 'connected'; readonly entryPoint: string };
	readonly agentIds: readonly AgentId[];
	readonly dependencies: readonly IAgentPackageDependency[];
	readonly privileges: readonly IAgentPackagePrivilege[];
}
```

Use `host` when an external package is authorized to construct a product-supported direct `IAgent` implementation inside Agent Host. Use `connected` when its implementation genuinely belongs in a separate sandboxed process speaking the Agent Runtime Protocol.

A provider executable spoken to by an App-compiled built-in Agent is not a connected Agent entry point.

## Complete immutable closure

One installed external package revision contains every runtime byte it needs:

- entry module or executable;
- helper executables;
- native protocol receipts;
- native modules and libraries;
- runtime assets.

Every dependency has one normalized target, digest, license, executable bit, and immutable verified source. Activation reads only that verified receipt directory.

The verifier rejects:

- missing, duplicate, or undeclared dependencies;
- target escape, absolute targets, and target collisions;
- links, special files, mutable sources, and digest mismatch;
- target operating-system or architecture mismatch;
- undeclared privilege or entry point;
- incomplete connected runtime closure.

No activation or runtime failure chooses another source, revision, execution kind, or package.

## Installation

Installation is one retry-safe operation:

```text
record operation identity and request digest
    → stage complete external package
    → verify complete closure
    → construct direct or connected Agent endpoint
    → validate exact registrations and retained resume compatibility
    → acquire package-wide Host mutation gate
    → atomically commit installed receipt, registrations, and migrations
    → retire staging state
```

A repeated operation with the same identity and digest returns its recorded outcome. The same identity with a different digest reports a conflict. An uncertain outcome is reconciled under the same identity.

Install failure before commit leaves no installed receipt, active registration, migrated resume state, or published Session type.

## Activation

Activation validates:

- every registration belongs to the installed package and one declared Agent ID;
- Agent IDs are unique in the Host authority;
- descriptor, capability, configuration, Tool-schema, and resume-schema revisions match the active endpoint;
- retained backing is restorable or has an exact declared migration edge;
- connected execution negotiated one supported protocol version and sandbox authority.

Direct Host Agents receive only explicit Host services. Connected Agents receive only the process, filesystem, network, secret, and Tool-executor grants committed by their manifest.

An external package cannot claim retained state owned by another package merely by registering the same Agent ID.

## Update

An update is one package-wide transaction:

```text
gate every affected Agent ID
    → stop new lifecycle mutations and Turns
    → drain accepted non-terminal work
    → checkpoint and release materialized backing
    → stage and verify the new complete closure
    → construct new endpoints
    → validate every retained record
    → run exact declared resume migrations
    → atomically commit package, registrations, and migrated state
    → retire previous endpoints and unreferenced artifacts
```

If any retained record cannot restore or migrate, the update fails before commit. A committed update does not switch back after later failure.

## Uninstall and retained data

Uninstall removes the external installed receipt, registrations, endpoints, and unreferenced artifacts. It preserves Host Session history, provider backing, and credentials.

| Operation | Requires active Agent | Deletes Host history | Deletes provider backing |
|---|---:|---:|---:|
| Uninstall external package | yes during quiescing | no | no |
| Delete Agent-backed data | yes | commits matching catalog deletion | yes, through `IAgent` |
| Purge retained Host records | package and registrations must be absent | yes | no |
| Delete credential | no | no | no |

Reinstall validates retained resume state before activation. It does not infer compatibility from matching Agent IDs.

## Built-in SDK cache

Built-in SDK caching is defined by [Agent Host architecture](AGENT_HOST.md) and implemented by `AgentSdkDownloader`.

```text
App-selected SDK version and target
    → completed cache hit
    or
explicit preparation downloads one immutable tarball
    → bounded safe extraction
    → atomic cache publication
    → built-in Agent resolves its private SDK bindings
```

Cache clearing removes only reproducible SDK bytes. It does not remove Agent availability, normalized history, credentials, or retained backing. Startup and passive catalog reads do not fill a cold cache.

## Ownership

```text
src/cs/platform/agentHost/
├── common/
│   └── package identities, manifests, catalogs, operations, and errors
└── node/
    ├── agentSdkDownloader.ts
    ├── agents/
    │   ├── comet/
    │   ├── claude/
    │   └── codex/
    ├── packages/
    │   ├── agentPackageActivationRegistry.ts
    │   ├── agentPackageLifecycle.ts
    │   └── localAgentPackageArtifactPort.ts
    └── runtime/
        └── connected external Agent negotiation
```

Settings and Sessions consume common Host snapshots. They never import Node package management, the SDK downloader, or Agent implementations.

## Adding an Agent

For a product-built-in SDK Agent:

1. Pin its exact SDK and lockfile under `build/agent-sdk/agents/<agent>/`.
2. Produce target tarballs and product-stamping metadata.
3. Implement the direct `IAgent` and exhaustive native mapping under `node/agents/<agent>/`.
4. Add its product SDK definition and explicit preparation path.
5. Test cold preparation, cache reuse, cache deletion, model discovery, native behavior mapping, cancellation, and version mismatch.

For an external Agent package:

1. Publish a complete immutable package offering.
2. Declare direct Host or connected execution explicitly.
3. Use the generic install, activation, update, uninstall, and retained-state lifecycle.
4. Test artifact integrity, privilege authority, registration validation, protocol negotiation where applicable, recovery, and resume compatibility.

Neither form adds provider-specific package management or Settings services.

## Invariants

- Comet, Claude, and Codex are product-built-in Agents, not external packages.
- Built-in SDK cache state never masquerades as installation state.
- Every external Agent requires an explicit install for one addressed Host.
- External package installation verifies the complete runtime closure before registration.
- Package ID, Agent ID, registration, authentication, SDK cache, preparation, and materialization remain distinct.
- Updates commit package state, registrations, and resume migrations atomically.
- Uninstall preserves retained Session history and credentials.
- Missing packages, corrupt artifacts, unsupported targets, invalid registrations, and incompatible resume state fail explicitly.
- No failure path selects another source, revision, execution kind, Agent, or model list.
