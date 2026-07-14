---
description: Durable rules and implementation examples for Agent SDK packages, runtimes, model discovery, configuration, credentials, and Settings management.
applyTo: "{src/cs/platform/agentHost/**,src/cs/code/common/agentHost/**,src/cs/code/electron-main/agentHost/**,src/cs/code/electron-utility/agentRuntime/**,src/cs/sessions/contrib/providers/agentHost/**,src/cs/workbench/contrib/preferences/**}"
---

# Agent SDK integrations

Read `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/AGENT_PACKAGES.md`,
and `src/cs/sessions/TOOLS.md` before changing an Agent SDK integration.

## Architecture at a glance

```text
Settings
    → IAgentHostManagementService
        → one IAgentHostManagementTarget per Host authority
            → IAgentHostConnection
                → Agent Host package, Agent, model, and configuration state
                    → connected Agent runtime
                        → private Claude, Codex, Copilot, or other SDK
```

SDK installation and SDK execution are not UI contracts. The user installs an
Agent package through Agent Host. That verified package privately contains its
SDK, executable, runtime entry point, and helper closure.

```text
installable package offering
    → explicit install operation
    → stage and verify the complete dependency closure
    → activate the connected runtime
    → runtime discovers provider-native models
    → runtime publishes canonical Agent descriptors
    → Host commits one revisioned root snapshot
    → Sessions and Settings consume that snapshot
```

There is no direct `Settings → SDK` or `Session → package manager` path.

## Ownership

| Concern | Authority | Example |
|---|---|---|
| Package availability and installation | Agent Host package catalog | `installablePackages`, `installedPackages` |
| Native model availability | Installed SDK runtime | Claude `query.supportedModels()` |
| Product model identity | Canonical Agent descriptor | `AgentModelId`, descriptor revision |
| Host defaults | Agent Host configuration state | permission mode |
| Session and model choices | Canonical configuration candidates | selected model, thinking level |
| Raw credentials | encrypted Secret Storage | Anthropic API key |
| UI presentation | Settings over Host snapshots | package, model, and configuration rows |

An SDK owns native facts. Comet owns product identities, revisions, validation,
persistence, and UI contracts.

## Common boundary

Agent Host contracts are SDK-neutral. A renderer-facing management target has
this shape:

```typescript
interface IAgentHostManagementTargetSnapshot {
	readonly authority: AgentHostAuthorityId;
	readonly label: string;
	readonly packages: IAgentHostPackageCatalogState;
	readonly supportsPackageOperations: boolean;
	readonly agents: readonly IAgentDescriptor[];
	readonly agentDefaults: readonly IAgentConfigurationState[];
	readonly pendingPackages: readonly AgentPackageId[];
	readonly pendingConfigurations: readonly AgentId[];
}
```

A snapshot may contain Claude data, but it never contains `ModelInfo`, a Claude
`Query`, a Codex client, an SDK callback, or a provider credential:

```json
{
  "authority": "local",
  "packages": {
    "installedPackages": [
      { "packageId": "claude", "revision": "claude.agent-sdk.<version>.<target>" }
    ]
  },
  "agents": [
    {
      "id": "claude",
      "packageId": "claude",
      "revision": "claude.agent-sdk.descriptor.<catalog-digest>",
      "models": [
        {
          "id": "claude:claude-sonnet-4-5",
          "revision": "claude.agent-sdk.model.<model-digest>",
          "displayName": "Claude Sonnet 4.5",
          "enabled": true
        }
      ]
    }
  ]
}
```

The example omits unrelated snapshot fields for readability. Wire values still
pass the complete common validators.

An SDK-backed runtime implements the Agent Runtime Protocol directly. Do not
add provider facades, compatibility adapters, re-exports, parallel Agent APIs,
or SDK-shaped fields to common contracts.

## Package lifecycle

The package is the installation unit:

```typescript
await managementService.installPackage(authority, createAgentPackageId('claude'));
await managementService.uninstallPackage(authority, createAgentPackageId('claude'));
```

Do not call `npm install`, download an executable, or resolve a mutable SDK
location from either operation's Settings handler. Product composition
provides one exact verified package offering, and Agent Host performs the
common install or uninstall operation.

| Package state | Host snapshot | Allowed behavior |
|---|---|---|
| Absent | installable offering only | show Install; no Agent or model selection |
| Installing | package ID in `pendingPackages` | disable competing package actions |
| Active | installed record, activation, Agent registration, descriptor | show models and allow Session creation |
| Uninstalled | no installed record or registration | preserve Host Session history; runtime cannot execute |

Installation stages and verifies the complete SDK closure before activation.
Runtime start, authentication, Session creation, and Turn execution never run
a package manager, download a dependency, or mutate the application install.

Package operations retain one operation ID, request digest, and expected
catalog revision until a terminal outcome. For example, an `unknown` response
is reconciled by resending the same request:

```typescript
const request = Object.freeze({ operation, digest, expectedCatalogRevision, payload });
let outcome = await connection.executePackageOperation(request);
if (outcome.kind === 'unknown') {
	outcome = await connection.executePackageOperation(request);
}
```

Code uses the bounded reconciliation loop in the owning Host client rather
than an unbounded retry. It never creates a new operation identity for an
uncertain prior operation.

## Model discovery and snapshots

When an SDK exposes model discovery, the runtime calls that API during explicit
runtime activation or authentication. Claude uses its real SDK surface:

```typescript
const query = claudeQuery({
	prompt,
	options: {
		persistSession: false,
		settingSources: [],
		skills: [],
		tools: [],
	},
});

const sdkModels: ModelInfo[] = await query.supportedModels();
```

The Claude runtime maps each private `ModelInfo` into the canonical model
descriptor inside the runtime boundary:

```typescript
const descriptor = Object.freeze({
	id: createAgentModelId(`claude:${sdkModel.value}`),
	revision: createAgentModelDescriptorRevision(`claude.agent-sdk.model.${modelDigest}`),
	displayName: sdkModel.displayName,
	enabled: true,
	configurationSchema: createClaudeAgentModelConfigurationSchema(schemaRevision, thinkingLevels),
	toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	attachments,
});
```

The descriptor and catalog revisions include every native value that affects
execution or presentation. A Session persists the canonical model ID and exact
descriptor revision; the runtime privately retains the mapping back to the SDK
model value.

The runtime registration revision changes when its descriptor revision
changes. Product composition validates that deterministic relationship:

```typescript
const registrationRevision = createAgentRuntimeRegistrationRevision(
	`claude.agent-sdk-runtime.v2.${descriptor.revision}`,
);
```

Do not publish different registration contents under one fixed revision.

```text
SDK value "claude-sonnet-4-5"
    ↕ private runtime map
AgentModelId "claude:claude-sonnet-4-5"
```

Codex follows the same output contract. Its runtime calls the actual discovery
API supplied by the installed Codex package and maps the result into
`IAgentDescriptor.models`. Do not invent a `listModels()` API, copy Claude
types, or add a Codex branch to Settings.

If an SDK has no discovery API, the verified package revision declares its
exact tested model catalog. Changing that catalog requires a new package,
Agent descriptor, and model descriptor revision.

### Discovery failures

| Native result | Required product result |
|---|---|
| Empty model array | activation fails explicitly |
| Duplicate native model identity | activation fails validation |
| Invalid capability metadata | activation fails validation |
| SDK unavailable | package does not activate |
| Package absent | runtime is not started and no model snapshot exists |

Never substitute a cached guess, generic model name, arbitrary text input, or
handwritten fallback list.

## Configuration

Agents describe configuration through common typed schemas. Settings renders
the schema rather than branching on Agent IDs.

```typescript
const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: CLAUDE_AGENT_ID,
	scope: 'hostDefault',
	revision: createAgentConfigurationSchemaRevision('claude.agent-sdk.host-defaults.v1'),
	properties: [{
		id: CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
		owner: { kind: 'agent', agent: CLAUDE_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'] },
		required: true,
		default: 'default',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('claudeAgent.permissionMode', 'Permission Mode') },
		persistence: 'persisted',
		redaction: 'public',
	}],
});
```

Settings writes one property through the generic service:

```typescript
await managementService.updateAgentDefault(
	authority,
	CLAUDE_AGENT_ID,
	CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
	'plan',
);
```

The target validates the complete candidate against the addressed schema and
expected state revision, then uses the common Host mutation reconciliation
path. It does not edit an SDK settings file.

An optional SDK value has no invented default. Claude thinking configuration,
for example, omits `default` when `ModelInfo` does not identify one:

```typescript
{
	id: CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
	value: { type: 'string', enum: ['none', 'adaptive', 'low', 'medium', 'high'] },
	required: false,
}
```

When the value is absent, the runtime omits the SDK `thinking` option. When the
user selects `high`, the runtime validates that `high` belongs to the selected
model's exact schema before passing it to the SDK.

## Credentials

Configuration stores a reference, never the raw secret:

```json
{
  "provider": "claude.provider-api-key",
  "scope": "llm",
  "reference": "anthropic"
}
```

The Anthropic API key remains in encrypted Secret Storage and resolves only for
the exact accepted Turn authority. Do not put a raw credential in a package
record, configuration value, process environment used for discovery, log,
diagnostic, model descriptor, or execution profile.

## Settings management

Settings consumes `IAgentHostManagementService.getSnapshot()` and delegates
mutations back to that service:

```typescript
const snapshot = managementService.getSnapshot();
for (const target of snapshot.targets) {
	renderPackages(target.packages);
	renderModels(target.agents.flatMap(agent => agent.models));
	renderHostDefaults(target.agentDefaults);
}
```

The renderer may use schema metadata for labels and controls. It never imports
an Agent SDK, reconstructs installation state from files, or stores its own
model catalog.

The following actions remain distinct:

| User intent | Operation |
|---|---|
| Install executable package | package install |
| Remove executable package | package uninstall |
| Reset Host defaults | configuration mutation |
| Delete a credential | Secret Storage mutation |
| Delete Agent/provider backing | activated Agent delete lifecycle |
| Purge retained Host records | absent-package Host purge |

Uninstall preserves Host Session history. It is not an alias for credential
deletion, Agent-backed deletion, or retained-record purge.

## Bad and good patterns

```typescript
// Bad: Settings maintains a provider model list.
const claudeModels = ['sonnet', 'opus'];

// Good: Settings renders every Host-published canonical model uniformly.
const models = snapshot.targets.flatMap(target =>
	target.agents.flatMap(agent => agent.models),
);
```

```typescript
// Bad: a Turn installs a missing SDK on demand.
await installSdkBeforeSend();

// Good: Session creation is available only after package activation.
const activeAgent = root.agents.find(agent => agent.id === selectedAgentId);
if (activeAgent === undefined) {
	throw new Error(`Agent '${selectedAgentId}' is unavailable.`);
}
```

```typescript
// Bad: discovery failure silently keeps an old or generic list.
const models = await discoverModels().catch(() => cachedModels);

// Good: activation exposes the discovery failure.
const models = await discoverModels();
if (models.length === 0) {
	throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'SDK returned no models');
}
```

## Adding an SDK-backed Agent

1. Define one package ID, Agent ID, verified dependency closure, privileges,
   and deterministic runtime-registration revision rule under
   `src/cs/code/common/agentHost/`.
2. Implement the connected runtime under
   `src/cs/code/electron-utility/agentRuntime/` using only the common Agent
   Runtime Protocol at its outer boundary.
3. Call the SDK's real discovery surface and map native models into canonical
   descriptors with content-derived revisions.
4. Define common Host-default, Session, and model configuration schemas. Keep
   SDK-native option mapping inside the runtime.
5. Register one installable product offering in desktop composition. Do not
   install it by default.
6. Reuse `IAgentHostManagementService`; do not add provider-specific Settings
   services, pages, or routing branches.
7. Test the runtime through the Agent Runtime Protocol and test package and
   configuration actions through the generic management target.

## Verification examples

| Contract | Required evidence |
|---|---|
| Package install/uninstall | exact offering, operation ID, digest, revision, terminal outcome |
| Model discovery | valid, empty, duplicate, malformed, and changed catalogs |
| Model execution | canonical ID maps to the exact SDK value |
| Configuration | valid update, invalid value, stale revision, reset, uncertain outcome |
| Credentials | reference persists; raw secret is absent from snapshots and diagnostics |
| Recovery | same package or configuration operation reconciles after disconnect |
| Composition | production build contains no mock package or mock runtime entry point |

Use deterministic contract fakes in test directories. Production composition
contains only real package offerings and the bundled Comet package.
