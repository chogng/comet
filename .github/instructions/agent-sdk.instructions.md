---
description: Durable rules and concrete examples for product-maintained Agent SDK build artifacts, Host Agents, model snapshots, configuration, packages, and Settings.
applyTo: "{build/agent-sdk/**,src/cs/platform/agentHost/common/**,src/cs/platform/agentHost/node/agents/**,src/cs/platform/agentHost/node/packages/**,src/cs/code/electron-main/main.ts,src/cs/sessions/contrib/providers/agentHost/**,src/cs/workbench/contrib/preferences/**}"
---

# Agent SDK integrations

Read `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/AGENT_PACKAGES.md`,
and `src/cs/sessions/TOOLS.md` before changing an Agent SDK integration.

## Target architecture

Product-maintained SDKs are installed Agent package artifacts and execute through
an `IAgent` implementation owned by Agent Host Node. Claude, Codex, and future
product-maintained SDKs do not add a provider runtime process or translate
through the Agent Runtime Protocol.

The installed SDK is the orchestration authority for an SDK-backed Agent.
Comet supplies the common behavior, state, interaction, persistence,
connection, and presentation substrate; it does not rebuild the SDK's model
loop or native orchestration. The direct `IAgent` implementation is the
bidirectional semantic mapping boundary:

```text
normalized Comet request and addressed user operations
    → SDK-native session, turn, control, permission, and input operations
        → SDK-owned model loop, native Tools, plans, tasks, subagents,
          background work, compaction, retries, and provider state
            → exhaustive native event and request mapping
                → canonical Comet Session, Chat, Turn, response, Tool
                  activity, plan, task, child-Chat, permission, input, usage,
                  context, status, change, and terminal behavior
```

`CometAgent` is a peer implementation on the same substrate. It owns an
orchestration loop only because it is Comet's native Agent. Its implementation
is not a template for reconstructing Claude, Codex, or another SDK harness.

```text
build/agent-sdk/agents/<agent>/{package.json,package-lock.json}
    → target SDK module and/or executable artifacts
        + generated native protocol receipt when applicable
        → verified package offering
            → generic install/update/uninstall
                → Agent Host Node resolves the installed SDK bindings
                    → App-compiled SDK behavior mapping
                    → <Agent> implements IAgent directly
                        → canonical descriptor, models, config, Sessions, Chats
                            → Host snapshot
                                → Sessions + Settings
```

The external connected-Agent protocol remains available for packages whose
implementation genuinely belongs in another process. It is not the integration
mechanism for product-maintained Claude or Codex SDKs.

## Native behavior mapping

An SDK integration maintains an explicit, exhaustive mapping over the exact
pinned SDK version. Each native notification, streamed message, callback,
server request, and control operation is classified as one of:

- canonical durable behavior that changes Session, Chat, Turn, response,
  Tool activity, plan, task, child-Chat, usage, context, change, or terminal
  state;
- an addressed interactive request that blocks the SDK until Comet returns an
  exact permission, confirmation, or user-input response;
- bounded ephemeral status or diagnostics that are intentionally not durable;
- a versioned native event that the integration explicitly rejects as
  unsupported.

Semantic native events are never silently ignored or flattened into generic
text. Interactive requests retain their native correlation together with the
canonical Host request identity, exact Session, Chat, Turn, optional parent
Tool activity, and cancellation lifetime. Reconnection and restoration never
answer a different native request or invent a replacement operation.

The common behavior model is the product union of supported Agent behaviors,
not the least common denominator of current integrations. Capabilities state
which operations one Agent supports. Host and UI code consume canonical
behavior kinds and never branch on `claude`, `codex`, or another Agent ID.

SDK-native Tools and reserved harness operations remain owned, selected, and
executed by the SDK. Their lifecycle and user interaction map into canonical
Comet Tool activity and side-effect state, but they are not claimed by the
Host Tool Execution Port. Comet-contributed Tools are separate: the exact
accepted Host Tool-set is added through the SDK's supported MCP, dynamic Tool,
or equivalent extension surface, and those calls execute through the Host Tool
Execution Port. Native and contributed Tools coexist in one Turn without one
replacing the other.

## Final repository ownership

| Path | Durable owner |
|---|---|
| `build/agent-sdk/agents/<agent>/package.json` | One exact SDK version pin |
| `build/agent-sdk/agents/<agent>/package-lock.json` | Complete reproducible dependency graph |
| `build/agent-sdk/` | Target artifact production only |
| `src/cs/platform/agentHost/node/agents/<agent>/` | Direct `IAgent` implementation and SDK-native mapping |
| `src/cs/platform/agentHost/node/packages/` | Provider-neutral package catalog, artifact verification, activation, update, and uninstall |
| `src/cs/platform/agentHost/common/` | SDK-neutral Agent, package, model, configuration, credential, and Tool contracts |
| `src/cs/workbench/contrib/preferences/` | Generic rendering of Host package, model, and configuration snapshots |
| `src/cs/code/electron-main/main.ts` | Application startup and service composition only |

The Claude and Codex placements demonstrate the boundary:

```text
build/agent-sdk/agents/claude/
├── entry.ts
├── package.json
└── package-lock.json

src/cs/platform/agentHost/node/agents/claude/
├── claudeAgent.ts
├── claudeAgentDefinition.ts
├── claudeAgentPackage.ts
└── claudeAgentSessionStore.ts

build/agent-sdk/agents/codex/
├── package.json
└── package-lock.json

src/cs/platform/agentHost/node/agents/codex/
├── codexAgent.ts
├── codexAgentDefinition.ts
├── codexAgentPackage.ts
└── codexAppServer.ts
```

Do not place package definitions, SDK resolution, model discovery, provider
configuration, or provider behavior under `src/cs/code`. Do not place Agent
behavior under `build`; build code only produces immutable inputs.

## Version and update ownership

Comet owns SDK versions. Users authorize a common package install or update;
they do not run `npm`, select arbitrary provider versions, or maintain SDK
directories.

One SDK update changes the exact build pin and lockfile together:

```json
{
  "name": "comet-agent-sdk-claude",
  "private": true,
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.208"
  }
}
```

Codex independently pins the native app-server distribution used by its
direct Agent:

```json
{
  "name": "comet-agent-sdk-codex",
  "private": true,
  "dependencies": {
    "@openai/codex": "0.142.0"
  }
}
```

When production TypeScript imports SDK types, the root development dependency
may carry the same exact version for types and tests. It is not the installed
production SDK. Artifact production must fail when the build pin, lockfile, and
any applicable root type pin disagree.

The target artifact contains every execution-time SDK byte needed by the
installed Agent package. For Claude this includes both the bundled SDK module
and its target executable:

```json
{
  "name": "@anthropic-ai/claude-agent-sdk",
  "version": "0.3.208",
  "target": "darwin-arm64",
  "executableSha256": "<sha256>",
  "moduleSha256": "<sha256>"
}
```

Codex binds its native executable to the exact generated app-server protocol
receipt used by the App-compiled behavior mapping:

```json
{
  "name": "@openai/codex",
  "version": "0.142.0",
  "target": "darwin-arm64",
  "executableSha256": "<sha256>",
  "protocolManifestSha256": "<sha256>"
}
```

Application startup consumes the product artifact catalog. It never constructs
an installable offering from root `node_modules`.

## Package shape

An SDK package declares how its Agent executes. Product-maintained SDK Agents
use Host execution:

```typescript
const manifest: IAgentPackageManifest = Object.freeze({
	schema: 1,
	packageId: CODEX_AGENT_PACKAGE_ID,
	revision,
	contentDigest,
	publisher: 'Comet',
	target: Object.freeze({ operatingSystem: 'darwin', architecture: 'arm64' }),
	execution: Object.freeze({ kind: 'host' }),
	agentIds: Object.freeze([CODEX_AGENT_ID]),
	dependencies: Object.freeze([
		Object.freeze({
			id: 'codex-sdk-executable',
			source: 'file:///verified/codex',
			target: 'vendor/codex-sdk/codex',
			digest: executableDigest,
			license: 'Apache-2.0',
			executable: true,
		}),
		// The exact generated protocol receipt is also required.
	]),
	privileges,
});
```

A genuinely external implementation uses an explicit connected entry point:

```typescript
execution: Object.freeze({
	kind: 'connected',
	entryPoint: 'bin/external-agent.js',
})
```

Do not represent a provider SDK executable as a connected Agent entry point.
The provider executable is a private SDK dependency invoked by the
App-compiled direct Agent; it is not a Comet Agent Runtime Protocol endpoint.

## Install, activate, and uninstall

Settings uses only the common management service:

```typescript
await managementService.installPackage(authority, createAgentPackageId('claude'));
await managementService.uninstallPackage(authority, createAgentPackageId('claude'));
```

The Host lifecycle is:

```text
Install
  1. resolve exact offering
  2. stage every declared artifact
  3. verify target, digest, executable mode, privilege grant, and closure
  4. publish one immutable installed receipt
  5. resolve the installed SDK bindings
  6. construct the product Agent as IAgent
  7. discover and validate models
  8. commit activation and the new Host snapshot

Uninstall
  1. gate the affected Agent
  2. drain accepted non-terminal work
  3. release the direct IAgent instance
  4. commit removal of registrations and installed receipt
  5. remove unreferenced SDK dependency artifacts
```

Session history, credentials, Agent-backed deletion, and retained Host-record
purge are separate operations. Uninstall does not silently perform them.

Package operation identity survives uncertain transport outcomes:

```typescript
const request = Object.freeze({ operation, digest, expectedCatalogRevision, payload });
let outcome = await connection.executePackageOperation(request);
if (outcome.kind === 'unknown') {
	outcome = await connection.executePackageOperation(request);
}
```

The bounded owner resends the same operation and digest. It never invents a new
identity for an uncertain operation.

## Direct Agent implementation

An SDK-backed Agent implements `IAgent` in Platform Agent Host Node:

```typescript
export class ClaudeAgent extends Disposable implements IAgent {
	readonly id = CLAUDE_AGENT_ID;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;
	readonly onDidEmitAction: Event<IAgentAction>;
	readonly configuration: IAgentConfiguration;
	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly resumeStates: IAgentResumeStates;
}
```

Codex has the same public shape. Its private implementation speaks the exact
NDJSON app-server protocol generated by the pinned executable; that protocol is
not the Comet Agent Runtime Protocol:

```typescript
export class CodexAgent extends Disposable implements IAgent {
	readonly id = CODEX_AGENT_ID;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;
	readonly configuration: IAgentConfiguration;
	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly resumeStates: IAgentResumeStates;
}
```

Claude package activation loads only the module from the verified installed
receipt and passes its exact bindings to the Agent:

```typescript
const loadedSdk = await import(installedSdkModule.source);
const agent = await ClaudeAgent.create({
	sdk: {
		query: loadedSdk.query,
		deleteSession: loadedSdk.deleteSession,
		createSdkMcpServer: loadedSdk.createSdkMcpServer,
		tool: loadedSdk.tool,
	},
	claudeCodeExecutable: fileURLToPath(installedExecutable.source),
	toolExecution,
	credentialResolver,
	stateDirectory,
	cacheDirectory,
	packageRevision,
	...retentionLimits,
});
```

Codex activation resolves only the verified executable and gives it to the
Agent-owned app-server process factory:

```typescript
const executable = installedPackage.dependencyClosure.find(
	dependency => dependency.target === 'vendor/codex-sdk/codex',
);

const agent = await CodexAgent.create({
	packageRevision: installedPackage.revision,
	stateDirectory,
	appServerFactory: new CodexAppServerProcessFactory({
		executable: fileURLToPath(executable.source),
		stateDirectory: join(stateDirectory, 'sdk-state'),
	}),
	toolExecution,
	credentialResolver,
});
```

The product package also declares any generic credential binding consumed by
Host composition; `src/cs/code` does not import provider constants:

```typescript
credentialBindings: Object.freeze([Object.freeze({
	provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	scope: 'llm',
	reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	privilege: 'configured.model.api-key',
})]),
```

There is no `ClaudeAgentRuntime`, provider utility-process entry, connection
generation, runtime call envelope, or provider-to-`IAgent` adapter.

There is also no Comet-owned Claude or Codex reasoning loop. The direct Agent
may own mapping state needed to correlate native identities with canonical
identities, but it never schedules provider model calls, interprets native
Tool results to decide the next model step, recreates native planning or task
semantics, or substitutes a Host terminal decision for an SDK terminal event.

## Model snapshots

Model availability comes from the installed SDK. Comet does not maintain a
parallel Claude or Codex model list.

Claude obtains one native snapshot during activation:

```typescript
const query = sdk.query({
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

Codex obtains every page from the pinned app-server and publishes only the
non-hidden SDK entries:

```typescript
const page = await appServer.request('model/list', {
	cursor,
	limit: 100,
	includeHidden: false,
});

cursor = page.nextCursor;
models.push(...page.data);
```

The app-server entry supplies its model ID, display name, description, default
reasoning effort, and supported reasoning efforts. Comet derives descriptor and
schema revisions from that content. Empty pages, duplicate IDs, malformed
effort metadata, or a default effort absent from the supported set reject
activation.

Each native model maps to one canonical descriptor:

```typescript
const model = Object.freeze({
	id: createAgentModelId(`claude:${sdkModel.value}`),
	revision: createAgentModelDescriptorRevision(`claude.agent-sdk.model.${modelDigest}`),
	displayName: sdkModel.displayName,
	enabled: true,
	configurationSchema: createClaudeAgentModelConfigurationSchema(schemaRevision, thinkingLevels),
	toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	attachments,
});
```

The Agent retains the private mapping from canonical model ID to native SDK
value. Settings and Sessions see only canonical descriptors.

For example, one Codex snapshot entry becomes this common model shape:

```typescript
Object.freeze({
	id: createAgentModelId(`codex:${sdkModel.id}`),
	displayName: sdkModel.displayName,
	configurationSchema: createCodexAgentModelConfigurationSchema(
		schemaRevision,
		[sdkModel.defaultReasoningEffort, ...remainingEfforts],
	),
	toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
});
```

| Native discovery result | Required result |
|---|---|
| Valid non-empty unique snapshot | publish content-derived descriptor revisions |
| Empty array | activation fails |
| Duplicate identity | activation fails |
| Invalid capability or effort metadata | activation fails |
| Missing or corrupt installed SDK dependency | activation fails |
| Package absent | no Agent and no model snapshot |

Never substitute a handwritten model list, a generic model, arbitrary text
input, or an older snapshot after discovery failure.

## Configuration and credentials

Agents publish typed common schemas; Settings renders those schemas without an
Agent-ID branch:

```typescript
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
}]
```

An optional native value has no invented default. If model discovery does not
declare a thinking default, the property remains optional and the Agent omits
the SDK option until the user selects a valid value.

Configuration stores a credential reference:

```json
{
  "provider": "claude.provider-api-key",
  "scope": "llm",
  "reference": "anthropic"
}
```

Codex publishes the same common shapes while keeping app-server field names
private. One resolved profile projects directly into native thread and Turn
requests:

```typescript
await appServer.request('thread/start', {
	model: profile.model,
	approvalPolicy: profile.approvalPolicy,
	sandbox: profile.sandboxMode,
	personality: profile.personality,
	config: { web_search: profile.webSearchMode },
	dynamicTools,
});

await appServer.request('turn/start', {
	threadId,
	input: [{ type: 'text', text: request.message, text_elements: [] }],
	effort: profile.reasoningEffort,
	summary: profile.reasoningSummary,
});
```

Codex accepts dynamic Tool schemas only when a thread starts. The Chat resume
state therefore retains a digest of the exact SDK-facing Tool name,
description, and JSON Schema list. Later Turns may carry new retry-stable Host
Tool-set revisions, but their SDK-facing schema digest must match the thread.
The Agent executes every contributed Tool call through that Turn's current
canonical Tool set. A changed SDK-facing contributed schema rejects the Turn
instead of running a stale contributed Tool or starting a replacement
conversation. Codex-native Tools remain owned by the app-server and are not
part of this digest.

The corresponding common properties are `codex.approvalPolicy`,
`codex.sandboxMode`, `codex.webSearchMode`, `codex.personality`,
`codex.modelReasoningEffort`, `codex.reasoningSummary`, and the
`codex.model.credential` reference. Settings learns all labels, values, scopes,
and defaults from those schemas.

The raw key remains in encrypted Secret Storage and resolves only for the exact
accepted Turn. It must not enter package records, model snapshots, configuration
values, execution profiles, logs, diagnostics, or model-discovery environments.

## Settings

The Agents navigation reads one generic Host management snapshot:

```typescript
const snapshot = managementService.getSnapshot();
for (const target of snapshot.targets) {
	renderPackages(target.packages);
	renderModels(target.agents.flatMap(agent => agent.models));
	renderConfiguration(target.agentDefaults);
}
```

| Snapshot state | UI behavior |
|---|---|
| Installable, absent | show Install; show no models or config for that Agent |
| Package operation pending | disable competing package actions |
| Installed and activating | show installed status; do not invent model rows |
| Active | show Uninstall, SDK model snapshot, and schema-driven config |
| Uninstalled | remove Agent/model/config rows; preserve Session history |

Settings never imports an SDK, scans SDK files, resolves package-manager state,
or contains a Claude/Codex model table.

## Prohibited and required examples

```typescript
// Prohibited: provider model maintenance in UI or product code.
const claudeModels = ['sonnet', 'opus'];

// Required: render the Host-published snapshot.
const models = target.agents.flatMap(agent => agent.models);
```

```typescript
// Prohibited: first Turn installs a missing SDK.
await installSdkBeforeSend();

// Required: package activation determines Agent availability.
const agent = root.agents.find(candidate => candidate.id === requestedAgent);
if (agent === undefined) {
	throw new AgentHostError(AgentHostErrorCode.ResourceMissing, 'Agent is unavailable');
}
```

```typescript
// Prohibited: product SDK translated through a provider runtime connection.
const runtime = await connectAgentRuntime(new ClaudeAgentRuntime());

// Required: verified package activation constructs the direct Agent.
const agent = await ClaudeAgent.create(options);
```

## Adding another product-maintained SDK

1. Add `build/agent-sdk/agents/<agent>/package.json` with one exact dependency
   and commit its `package-lock.json`.
2. Produce a target artifact containing every SDK byte needed after install;
   record and verify content digests.
3. Add `src/cs/platform/agentHost/node/agents/<agent>/<agent>Agent.ts` that
   implements `IAgent` directly as the SDK's bidirectional behavior mapping
   boundary, not as a replacement orchestration loop.
4. Add the package product under the same Agent-owned Platform directory and
   publish it through `productAgentPackageCatalog.ts`.
5. Use the SDK's real discovery API and publish canonical model descriptors.
6. Exhaustively map the pinned SDK's streamed events, interactive requests,
   native Tool activity, plans, tasks, child Agents, usage, context, terminal
   states, and supported control operations into the common behavior substrate.
7. Publish Host-default, Session, and model configuration schemas through the
   common contracts.
8. Reuse the generic package and Settings services. Do not add provider-specific
   install, model, configuration, or navigation services.
9. Test build-pin agreement, artifact integrity, package lifecycle, model
   discovery failures, native event exhaustiveness, interactive correlation,
   native and contributed Tool coexistence, control operations, configuration,
   credential isolation, and uninstall cleanup.

## Verification matrix

| Invariant | Evidence |
|---|---|
| Exact SDK ownership | build pin, lockfile, applicable root type pin, and artifact metadata agree |
| Complete install unit | every module and executable needed by that SDK is in the verified dependency closure |
| No provider runtime | no Agent Runtime endpoint, provider utility-process entry, or provider-to-`IAgent` adapter |
| Direct Host Agent | `<Agent>` implements `IAgent` under `platform/agentHost/node/agents` |
| Native orchestration authority | no Comet-owned model, planning, task, subagent, retry, compaction, or native Tool loop for an SDK-backed Agent |
| Behavior coverage | every native semantic event and request is mapped, explicitly diagnostic, or explicitly unsupported; none is silently discarded |
| Bidirectional interaction | permission and input requests retain exact native and Host correlation through response, cancellation, and recovery |
| Tool coexistence | SDK-native Tools remain enabled and SDK-owned while Comet-contributed Tools use the supported extension surface and Host executor |
| Native controls | supported resume, fork, steer, interrupt, and configuration changes call the SDK operation directly |
| Model source | valid, empty, duplicate, malformed, and changed SDK snapshots are tested |
| Generic Settings | install/uninstall, model rows, and config controls use Host snapshots |
| Credentials | raw secret is absent from persisted and published protocol state |
| Recovery | the same package/config operation identity reconciles after uncertainty |
| Production composition | `code/electron-main/main.ts` names no provider package or SDK |

Production code contains real product offerings only. Mocks and deterministic
SDK bindings remain under test directories.
