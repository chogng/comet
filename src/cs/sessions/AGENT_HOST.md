# Agent Host architecture

## Overview

Agent Host is Comet's common execution boundary for every Agent. It separates
Host placement, Agent runtime packaging, Agent execution strategy, product
Session and Chat models, and Workbench Chat presentation.

```text
Sessions application
    → ISessionsManagementService
    → AgentHostSessionsProvider for one Host authority
    → IAgentHostConnection
        ├── local Agent Host connection
        └── remote Agent Host connection
    → Agent Host runtime
    → IAgent Host-facing runtime port
        ├── product-bundled embedded Comet runtime
        └── IAgentRuntimeConnection
            └── connected Agent runtime
```

Local and remote describe Host placement and transport. `comet`, `copilot`,
`claude`, and `codex` identify Agent behavior. Embedded and connected describe
how that behavior is bound to the Host. None of these dimensions is inferred
from another.

Remote Agent Host uses one explicit Comet reachability route: a bidirectional
Agent Host channel on the shared Remote Server management connection, or a
direct Agent Host Protocol endpoint on one selected Remote Tunnel. Its
placement and composition are defined in
[Remote Agent Host architecture](REMOTE_AGENT_HOST.md),
[Remote foundation](../platform/remote/REMOTE.md), and
[Remote Tunnel architecture](../platform/tunnel/REMOTE_TUNNEL.md).

Agent packages add a separate installation dimension. Comet is the only
bundled and default-installed package. Every other Agent is absent until the
user explicitly installs its package for the addressed Host and authenticated
user scope and executes through a connected runtime outside the Host process.
Only product composition may bind the bundled Comet runtime as embedded.
Session creation and Turn execution never install or download an Agent package.
See [Agent package architecture](AGENT_PACKAGES.md).

## Identities

Agent Host keeps the following identities distinct:

| Identity | Meaning | Owner |
|---|---|---|
| Host authority | One stable local or remote Agent Host endpoint | connection registry |
| Client connection ID | One logical client connection across transport reconnections | Host protocol |
| Sessions provider ID | One provider instance backed by one Host authority | Agent Host Sessions contribution |
| Agent package ID | One stable Host installation identity | Agent package catalog |
| Agent package revision | One exact verified package version, target, manifest, and digest | Agent package catalog |
| Agent ID | One stable Agent behavior registered inside a Host | Agent Host runtime |
| Agent runtime connection ID | One logical connected Agent runtime across transport reconnections | Agent Runtime Protocol |
| Agent runtime registration revision | One exact runtime endpoint, descriptor, configuration, capability, resume-schema, and migration-edge registration for an Agent ID | Agent Host runtime |
| Agent configuration schema revision | One exact SDK-neutral Host-default, Session, or model configuration schema | Agent Host runtime and addressed Agent runtime |
| Agent execution profile revision | One immutable Agent-resolved execution choice for an exact runtime registration and submission | addressed Agent runtime |
| Session ID | One stable working context durably attributed to one package and Agent | Agent Host runtime |
| Chat ID | One conversation stream inside one Session | Agent Host runtime |
| Turn ID | One accepted user request and Agent response lifecycle | Agent Host runtime |
| Operation ID | One retry-safe mutating protocol operation | operation owner |

The built-in Comet Agent has Agent ID `comet` and is supplied by the bundled
package whose package ID is also `comet`. The strings occupy separate identity
namespaces. `CometAgent` names its Host-facing Agent integration; it does not
imply that Comet orchestration is implemented in TypeScript or runs in the
Agent Host process. Host placement and runtime packaging are not part of its
Agent identity.

The local Host has one stable provider identity. Each remote Host authority has
its own provider identity derived from its stable authority. Agent IDs remain
the same across local and remote Hosts.

Implementation names follow those boundaries. `agentHost` names the shared
provider family, an Agent ID such as `comet` names Agent behavior, and `local`
or `remote` names Host placement. `default` is not an Agent, provider, Session,
Chat, storage, or routing identity and is not used as an implementation prefix.
There is no `defaultChat` or `mainChat` identity, field, type, or routing rule.
Every Chat is addressed by its own Chat ID.

## Ownership

### Agent Host runtime

The environment-neutral protocol and Node Agent Host runtime own:

- installable and installed Agent package catalogs, verified package
  operations, package-wide quiescing, resume migration, data deletion, retained
  Host-record purge, and activation into the Agent registry;
- Agent registration, discovery, descriptors, models, and capabilities;
- canonical Session, Chat, Turn, and operation identities;
- the Session catalog and each Session's Chat catalog;
- normalized canonical turn state and ordered action history;
- explicit create, materialize, release, and delete lifecycle;
- request routing, queuing, cancellation, steering, and state publication;
- dynamic Agent and Session configuration;
- Agent authentication requests, tool calls, permission requests, terminals,
  resources, and changesets;
- protocol versioning, snapshots, subscriptions, replay, and reconnection;
- connection-independent state and typed error semantics.

The runtime does not import Workbench Chat, Sessions, Parts, widgets, Editor,
Fetch, Browser, PDF, or product layout services.

### Agent Runtime Port

`IAgent` is the single Host-facing semantic port for Agent execution. An Agent
endpoint owns its execution strategy:

- create, materialize, release, and delete Agent backing;
- migrate bounded opaque resume state through exact declared schema edges;
- resolve a normalized execution selection into one bounded immutable execution
  profile before Host request preparation;
- consume normalized Host Turn requests, including the exact Tool-set revision;
- emit ordered canonical Agent Host actions;
- expose models, configuration, authentication requirements, and capabilities;
- persist or reconstruct Agent-specific history and opaque resume data;
- integrate Tool calls, results, permissions, and input requests through Host
  contracts.

The product-bundled Comet endpoint may execute in the Agent Host process. Every
user-installed endpoint connects from another process through
`IAgentRuntimeConnection`. The connected Agent Runtime Protocol is the
language-neutral wire projection of the same `IAgent` semantics, not a second
Agent API. A runtime package that implements that protocol directly needs no
Agent-specific Host bridge.

One Host authority accepts exactly one active registration for an Agent ID.
The registration records the exact endpoint, descriptor and capability
revisions, configuration-schema capabilities and revisions, the resume-schema
IDs it can materialize, and exact declared resume-migration edges. A Session
persists its Agent ID, resume-schema ID, and opaque resume data together with
its owning package ID. A replacement runtime must belong to that same package,
activate the same Agent ID, and explicitly materialize that schema or migrate
it through a declared edge inside the package update transaction. Host code
never hands opaque state to an unqualified package or runtime and never tries
another endpoint after materialization fails.

An Agent runtime that uses an SDK additionally owns its SDK clients, request
and event mapping, Tool projection, aliases, callbacks, caches, and SDK resume
data after its package is installed and activated. Package discovery,
verification, installation, update, and uninstall belong to Agent Host rather
than the runtime. SDK types never escape the runtime. Whether the runtime is
embedded or connected does not change its Agent, Session, Chat, Turn, Tool,
attachment, or permission semantics.

An Agent does not register an `ISessionsProvider`, create a Workbench Chat
model, manipulate Sessions services, access UI, own an Agent Host client
connection, or invoke a Workbench Feature outside the canonical Tool and
content-resource contracts.

### Comet Agent runtime

The bundled `comet` package binds Agent ID `comet` to exactly one Comet runtime.
The runtime may implement `IAgent` in-process or connect as a Rust Comet Code
runtime through the Agent Runtime Protocol. The Host composition chooses one
form before registration and never switches forms after failure.

The Comet runtime owns prompt construction, exact model configuration,
provider projection, execution budgets, the repeated model-and-Tool loop, and
opaque orchestration checkpoints. Agent Host remains the owner of canonical
Session, Chat, Turn, Tool-call, permission, input-request, and operation state.
Comet uses the accepted Tool set and Host Tool Execution Port and never creates
a private Sessions provider or Tool lifecycle.

Registered Agents are peers. Comet does not invoke another Agent implicitly;
its private substeps remain inside the parent Turn, and visible Comet-owned
workers use ordinary Tool-origin Chats. The execution profile, Host Turn
binding, orchestration, attachment, Tool, worker, Rust runtime, and resume
boundaries are defined in [Comet Agent architecture](COMET_AGENT.md).

### Host connections

`IAgentHostConnection` is the single consumer-facing protocol boundary. Local
and remote implementations expose the same commands, subscriptions, snapshots,
ordered actions, resources, and errors.

This connection joins a product client to an Agent Host. It is distinct from
`IAgentRuntimeConnection`, which joins that Host to a connected Agent runtime.
Neither connection substitutes for or tunnels through the other implicitly.

The local connection owns local process lifecycle and IPC. A remote connection
uses either a typed channel from the initialized Remote Server connection or a
direct `agentHost` endpoint stream from the selected Remote Tunnel connection.
Product composition selects the exact discriminated address. The lower
foundation owns authority resolution or tunnel lookup, endpoint
authentication, and transport reconnection; the Agent Host connection owns
Agent Host negotiation, semantic reconnection, and exact client content and
Tool endpoint binding. Connection implementations do not reimplement Agent,
Session, Chat, Turn, or catalog behavior. See
[Remote Agent Host architecture](REMOTE_AGENT_HOST.md).

### Agent Host Sessions provider

One `AgentHostSessionsProvider` connects one `IAgentHostConnection` to the
provider-independent Sessions domain. It:

- implements `ISessionsProvider`;
- maps Host descriptors and capabilities to `ISession` and `IChat`;
- owns draft-to-committed product transitions;
- routes Session and Chat operations to the addressed Host authority;
- owns Workbench Chat model references for the Chats it exposes;
- applies committed Host snapshots and actions to the addressed Chat models;
- publishes authoritative Session collection transitions.

The provider does not import Sessions Parts, `ChatWidget`, concrete Chat views,
or layout services. Local and remote contributions construct the same provider
implementation with different connections; they do not maintain separate
Session or Chat implementations.

### Workbench Chat and attachments

`IChatService` owns one conversation presentation model addressed by
`chatResource`, including transcript rendering, composer draft state,
attachments, and request preparation. It does not choose an Agent, create a
backend Session, or own canonical Host history.

The Sessions Chat contribution binds Chat input to
`ISessionsManagementService`. Requests pass through the owning Sessions
provider and address the exact Session and Chat. Workbench Chat never calls an
Agent SDK or Host connection directly and never builds a second Sessions-owned
request payload.

Pending composer attachments remain Workbench draft state. Only normalized
attachments from an accepted submission enter Host state. Attachment identity,
producer registration, content publication, File and Directory structures,
Feature-specific producer rules, and submission failure semantics are defined
in [Attachment architecture](ATTACHMENTS.md).

Request-scoped interaction targets and Feature-owned operations are separate
from attachments. Canonical Tool descriptors, schema profiles, registrations,
Turn-bound Tool sets, Agent integration, calls, results, permissions, the Tool
Execution Port, and connected client executors are defined in
[Tool architecture](TOOLS.md). Request-scoped resource binding and the lazy
Browser-content flow are defined in
[Interaction target architecture](INTERACTION_TARGETS.md).

Reading or materializing an accepted attachment content reference is not a
Tool call. The Agent runtime performs that translation through the Host
content-resource protocol, so explicit message context never depends on the
model choosing a function. Content references and leases are defined in
[Attachment architecture](ATTACHMENTS.md).

## Agent configuration

Agent configuration is bounded, SDK-neutral protocol state. It is distinct
from package manifests, runtime credentials, opaque resume state, and the
immutable execution profile bound to one Turn. Agent Host owns configuration
schema and value state; the addressed Agent runtime owns interpretation and
conversion into its SDK or model-provider representation.

### Scopes and authority

Configuration has three explicit scopes:

| Scope | Authority | Lifetime |
|---|---|---|
| Host Agent defaults | Agent Host root state for one Host authority, authenticated user scope, and Agent ID | persisted independently from Sessions and used when resolving new Session configuration |
| Session configuration | Agent Host Session state | resolved and committed with the Session, then changed only through an addressed configuration operation |
| Model execution settings | normalized execution selection and the addressed model descriptor | resolved into one immutable Turn binding alongside the Agent execution profile |

Host Agent defaults and Session configuration use the common Agent
configuration schema. A present candidate Session value takes precedence over
the corresponding Host Agent default; the property schema's declared default
applies only when both omit the property. Session resolution materializes the
resulting values into the committed Session configuration state. A later Host
default change affects newly resolved Sessions and does not mutate an existing
Session implicitly.

Model execution settings are not another mutable Session configuration bag.
Each model descriptor publishes the exact configuration schema revision that
its selection accepts. Workbench Chat captures a candidate as part of the
normalized execution selection. Agent Host validates it against that exact
descriptor, materializes every declared default, and passes the complete model
configuration with the committed Session configuration while resolving the
immutable execution profile. The Host binds the complete model configuration
separately from the opaque profile. Both remain unchanged when a Host default,
Session value, model descriptor, or later selection changes.

Host defaults are namespaced by Agent ID. Session property identity includes
its platform or Agent owner and stable property ID. Platform-owned property
IDs are reserved; an Agent may consume a declared platform property but cannot
redefine it. Agent-owned properties cannot collide with another Agent or with
platform configuration. Shared Host code routes configuration by exact owner,
schema revision, Agent ID, and Session ID and never branches on an Agent ID to
interpret a value.

### Schema and resolution

The Agent Host protocol defines one bounded configuration-schema profile over
canonical protocol values. A schema identifies:

- its exact owner and schema revision;
- stable namespaced property IDs, value types, constraints, and declared
  defaults;
- which properties are valid as Host defaults or Session values;
- which Session properties may change after Session creation;
- which properties support bounded dynamic completions;
- exact provider, scope, and reference sets for credential-reference values;
- display metadata and explicit persistence or redaction policy.

An activated Agent registration publishes its Host-default configuration
schema, its initial Session configuration schema revision, and the bounded set
of Session schema revisions it may resolve. The initial revision lets a client
form the first exact candidate without guessing from the supported set.
`IAgent.configuration` resolves the dynamic Session schema and values for an
exact runtime registration, workspace, Host-default revision, and candidate
Session values. The resolved revision may change only to another revision
declared by that registration. Model configuration is resolved separately
against the exact model descriptor selected for a submission. The Session
configuration surface also provides bounded
completions only for properties whose schema declares dynamic completion. A
completion is presentation data, not acceptance authority; the selected value
still passes the exact schema before use.

Agent Host validates schema ownership, revisions, bounds, required properties,
and every value before publishing configuration state or invoking an Agent.
Unknown properties, duplicate ownership, stale schemas, malformed persisted
values, and invalid candidate values fail with a typed configuration error.
The Host never skips an invalid layer, coerces a value, drops an unknown key,
or substitutes another Agent's schema or default.

The Agent runtime receives only validated canonical values. Copilot, Claude,
Codex, Comet, and later runtimes define their own schemas through the same port
and privately map those values to their SDK, CLI, or model-provider settings.
SDK configuration classes, generated native protocol values, Zod objects,
provider option bags, and filesystem layout never cross the Agent Runtime
Port.

### Product SDK configuration projections

The product-owned Copilot, Claude, and Codex packages publish the following
canonical Agent-owned properties. Host-default properties seed new Sessions;
Session properties are persisted in the addressed Session configuration; model
properties are resolved independently for the selected model. The connected
runtime alone maps these values to its private SDK or CLI representation.

| Agent | Property | Scope | Canonical values | Baseline default |
|---|---|---|---|---|
| Copilot | `copilot.mode` | Host default and Session | `interactive`, `plan`, `autopilot` | `interactive` |
| Copilot | `copilot.autoApprove` | Host default and Session | `default`, `autoApprove` | `default` |
| Copilot | `copilot.isolation` | Host default and Session | `folder`, `worktree` | `folder` |
| Claude | `claude.permissionMode` | Host default and Session | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto` | `default` |
| Claude | `claude.thinkingLevel` | Model | Exact model-declared subset of `none`, `adaptive`, `low`, `medium`, `high`, `xhigh`, `max` | None; omission preserves the SDK-native behavior |
| Claude | `claude.model.credential` | Model | `claude.provider-api-key` / `llm` / `anthropic` credential reference | Anthropic API-key reference |
| Codex | `codex.approvalPolicy` | Host default and Session | `never`, `on-request`, `on-failure`, `untrusted` | `on-request` |
| Codex | `codex.sandboxMode` | Host default and Session | `read-only`, `workspace-write`, `danger-full-access` | `workspace-write` |
| Codex | `codex.webSearchMode` | Host default and Session | `disabled`, `cached`, `live` | `disabled` |
| Codex | `codex.personality` | Host default and Session | `none`, `friendly`, `pragmatic` | `none` |
| Codex | `codex.modelReasoningEffort` | Model | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | `medium` |
| Codex | `codex.reasoningSummary` | Model | `none`, `auto`, `concise`, `detailed` | `auto` |

Runtime resolution may narrow an enum or choose a different declared default
when the exact workspace or model descriptor requires it. That result is a new
validated schema revision; the Host does not coerce an existing value, invent
an SDK default, or interpret one Agent's property on behalf of another.

Configuration values contain no raw credential material. A schema may accept
a typed credential reference when the package and Agent declare that reference
kind. Preparation collects the exact references declared by the committed
Session and resolved model configuration. Agent Host binds that set to the
accepted package, Agent, runtime registration, Session, Chat, and Turn and
checks the installed package's secret grants before execution. Only the
addressed active Turn may resolve one of those references. Credentials never
enter configuration snapshots, actions, completion results, execution
profiles, package manifests, logs, or diagnostics.

### Mutation and protocol state

Host-default and Session-configuration changes are separate idempotent
operations. Each request carries an operation ID, payload digest, exact owner,
and expected schema revision. Agent Host constructs and validates the complete
candidate value state before mutation. A rejected property or value commits no
partial patch.

A property that is not declared Session-mutable is fixed after Session
creation. Updating a mutable property addresses the exact Session and Agent
runtime registration. For materialized backing, Agent Host first persists an
operation-owned rollback intent and only then asks the runtime to prepare the
full validated candidate. The runtime retains the prior configuration until
Agent Host records the transaction decision. Agent Host atomically replaces
the intent with the candidate and commit decision, or retains the rollback
decision when candidate persistence fails, before requesting runtime
finalization. Rollback finalization treats an intent whose preparation never
applied as an idempotent no-op. Runtime rejection leaves the prior Host state
authoritative.

A lost commit or rollback response is reconciled from the persisted
decision under the same operation identity; neither side invents a replacement
operation. On cold Host and runtime restoration, the Host first materializes
the backing from its authoritative committed configuration and then completes
the retained decision and outcome without requiring a transaction record from
the previous runtime process. After runtime finalization, Agent Host persists
the completed outcome before sending an exact cleanup acknowledgement to the
runtime. The runtime keeps the terminal transaction pinned until that cleanup
call and treats an already absent terminal record as an idempotent cleanup.
Only after the cleanup response does Agent Host persist the operation as
acknowledged and eligible for eviction.

Pending decisions are never evicted and block package mutation for their exact
Agent registration. Terminal decisions retain their logical connection owner
and are kept in a bounded reconciliation ledger; once an oldest acknowledged
outcome leaves that ledger, a later reconciliation is explicitly unknown.
Released backing requires no runtime preparation and receives the committed
configuration during materialization.

Host root snapshots contain Agent-default schemas, revisions, and values.
Session snapshots contain the exact resolved Session schema revision and
values. Successful changes publish ordered root or Session configuration
actions through the ordinary contiguous channel-revision rules. Clients never
reconstruct configuration from settings files, environment variables,
credentials, package contents, Agent display data, or SDK state.

Connected runtimes implement configuration resolution, completion, and
Session application through the Agent Runtime Protocol. Embedded and connected
forms expose the same state, validation, mutation, ordering, and failure
semantics; no Agent-specific Host bridge or settings adapter exists.

## Agent Runtime Protocol

### Registration and negotiation

The product-bundled embedded Comet endpoint registers `IAgent` directly. A
connected endpoint registers through `IAgentRuntimeConnection` after
negotiating one Agent Runtime Protocol version. Initialization exchanges:

- a stable logical runtime connection ID;
- supported protocol versions and transport limits;
- the exact Agent package ID and revision authorized to activate the runtime;
- the exact Agent IDs and descriptor revisions being registered;
- capability revisions and supported Tool Schema Profiles;
- configuration-schema capabilities and exact Host-default schema revisions;
- one exact initial Session configuration schema revision and its supported
  resolution set;
- supported opaque resume-schema IDs and exact migration edges;
- informational runtime implementation and build identity.

Runtime endpoint authentication establishes which installed package revision,
operation-scoped staged package revision, or bundled Host composition may
negotiate each Agent ID. A staged negotiation is visible only inside its
package transaction and becomes an active registration only at atomic commit.
Runtime authentication is distinct from product-client transport authentication
and from credentials the Agent later uses with an SDK or model provider. A
self-declared Agent ID or discoverable package grants no registration
authority.

The Host selects one offered protocol version and atomically accepts or rejects
each Agent registration. Duplicate Agent IDs, incompatible versions, invalid
capabilities, and conflicting descriptor revisions fail registration. Runtime
implementation names and build versions are diagnostic only; routing uses the
Agent ID and exact accepted registration revision.

### Commands and reverse operations

The protocol serializes the same lifecycle and Turn operations as `IAgent`.
Host-to-runtime commands include Session and Chat creation, materialization,
release, deletion, Session-configuration resolution, completion and
application, execution-profile resolution, operation-scoped resume migration,
accepted Turn execution, steering, cancellation, Tool results, permission
decisions, and user-input responses.

Runtime-to-Host traffic includes ordered Agent actions, model and capability
updates, canonical Tool calls, content-resource reads for accepted
attachments, permission and user-input requests, worker-Chat lifecycle events,
usage, checkpoints, and terminal outcomes. Every message carries its exact
Agent, Session, Chat, Turn, operation, request, or Tool-call identity as
applicable. Messages are bounded, correlated, cancellable, and flow-controlled;
the Host never recovers identity from arrival order or display data.

Runtime-to-Host content reads and worker publication are Host operations, not
hidden SDK callbacks. Content reads use the attachment content-resource
contract. Tool calls use the Host Tool Execution Port. Worker conversations
use the ordinary Chat lifecycle owned by the same Agent. Encoding one of these
as a private SDK callback inside the runtime does not change its canonical Host
lifecycle.

### Runtime loss and resumption

A connected runtime reconnects with the same logical runtime connection ID,
accepted registration revision, and a new contiguous transport generation. A
generation boundary is a semantic recovery barrier: calls admitted to the lost
generation terminate with that exact generation unavailable and are never
silently replayed into the replacement process.

Before admitting new calls, the connected-runtime binding rematerializes every
Host-committed materialized Session, outstanding Session-configuration
transaction, and materialized Chat in dependency order. Session and Chat resume
state comes from the Host-side committed backing ledger, including later
resume-state actions accepted from the runtime. Release or deletion removes the
corresponding recovery ownership.

A runtime declares whether it can resume an accepted Turn and supplies the
matching opaque checkpoint tagged with a supported resume-schema ID. The Host
may resume only through an explicit committed lifecycle operation after it has
reconciled the lost Turn and operation identities; the old generation's active
call itself does not continue in the replacement process.

When the exact runtime registration or resume schema is unavailable, affected
Sessions or Turns enter an explicit unavailable or failed state according to
their committed lifecycle. The Host does not launch another implementation,
change runtime packaging, choose another model provider, or replay an uncertain
effect under a new identity.

## Agent Host connection protocol

### Initialization and versioning

Endpoint authentication establishes which peer may open a transport. The first
application request on a new transport initializes the logical connection. It
contains:

- the stable client connection ID;
- protocol versions the client implements;
- client capabilities and locale;
- informational client implementation identity;
- initial channel subscriptions.

The Host selects one offered protocol version that it implements and returns
the selected version, Host implementation identity, current Host sequence,
Host, package-catalog, and Agent descriptor revisions, and initial subscription
snapshots. If no offered version is compatible, initialization fails. Neither
peer sends normal commands before initialization or retries by parsing another
dialect.

Implementation names and build versions are informational. Feature detection
uses negotiated protocol version and explicit capabilities, never parsed
product names or version strings.

Protocol messages, commands, actions, state, errors, and their introduced
versions come from one protocol schema and registry. A breaking shape change
changes the negotiated protocol version. Unknown required commands, actions,
attachment-envelope versions, and state fields fail validation rather than
being applied partially.

Transport framing is replaceable; protocol semantics are not. IPC, WebSocket,
and stdio connections preserve the same initialization, ordering, limits,
errors, and lifecycle.

### Channels, snapshots, and ordered actions

State is addressed through typed channels:

```text
Host root channel
├── installable and installed Agent package catalogs
├── Agent and model descriptors and activation state
├── Agent-default configuration schemas, revisions, and values
├── Session catalog
└── connection-level capabilities

Package operation channel
├── operation kind, package ID, expected catalog precondition, request digest,
│   and impact
├── install and update target an exact source, revision, and dependency closure
└── bounded progress and one terminal install, update, uninstall,
    Agent-data deletion, or Host-record purge result

Session channel
├── Session metadata and lifecycle
├── resolved configuration schema revision and values
└── Chat catalog

Chat channel
├── normalized turns and active turn state
├── tool, permission, input, and usage state
└── history pagination state
```

Every committed state action carries a monotonic Host sequence and the next
contiguous revision for its addressed state-bearing channel. A snapshot carries
the complete state visible to that subscription together with its Host sequence
and channel revision.

A client applies a snapshot as the baseline, discards exact duplicate actions,
and applies only the next channel revision. It may buffer later actions while a
snapshot is arriving. A revision conflict or gap stops application for that
channel and requires an explicit fresh snapshot. The client never guesses the
missing transition or continues with out-of-order state.

Host state changes are committed before actions are published. Ordinary
observers cannot veto a committed transition, and one failing observer cannot
prevent later observers from receiving it. Workbench draft and presentation
state may be local, but clients do not publish an uncommitted Host catalog or
canonical turn as authoritative state.

### Reconnection and reconciliation

A transport reconnect uses the same logical client connection ID, the last
durably applied Host sequence, and the exact active subscription set. The Host
returns either:

- the complete retained action interval relevant to those subscriptions after
  that sequence; or
- fresh authoritative snapshots when the interval is no longer retained.

Resources that were deleted or are no longer authorized are reported
explicitly. The client drops those subscriptions and does not redirect them to
another Session, Chat, terminal, or resource.

After state recovery, the provider reconciles in-flight mutations by stable
operation ID. Package operations and Turn submissions additionally use their
payload digest. The same ID and digest returns the committed outcome; the same
ID with different content is a conflict. A client never resends an uncertain
mutation under a new ID before reconciliation, so reconnect cannot duplicate a
package activation, Session, Chat, or user turn.

### Authentication, permissions, and errors

Product-client transport authentication, Agent runtime endpoint authentication,
and Agent SDK or model-provider authentication are separate. Client transport
authentication identifies and authorizes the Host peer. Runtime authentication
authorizes exact Agent registrations. An Agent authentication request identifies
an Agent and credential scope and is routed through a typed Host challenge.
Failure in one scope never causes the Host to try another runtime, Agent, or
credential source.

`IAgentDescriptor.requiresAgentAuthentication` reports only whether the Agent
requires that typed Agent authentication challenge. It never reports
model-provider credential presence or availability.

Raw secret resolution is a short-lived Turn operation, not authentication
state. Embedded runtimes call the Host credential resolver directly; connected
runtimes use the corresponding reverse Agent Runtime operation. Both paths
must echo the exact package, Agent, runtime registration, Session, Chat, Turn,
provider, scope, and reference. Turn completion, cancellation, deletion,
release, disconnect, or Host shutdown retires the binding. A cancelled or
unauthorized request reaches no secret source, and source failures produce only
typed redacted errors.

Desktop provider secrets persist only in versioned ciphertext envelopes
protected by an approved operating-system-backed Electron safe-storage backend.
Unavailable or unapproved encryption, malformed envelopes, unknown envelope
versions, or decryption failure stop startup. There is no plaintext, in-memory,
environment, or alternate-store fallback.

Tool permission requests are scoped to the exact Session, Chat, Turn, Tool
call, and request ID. User-input requests address the exact Session, Chat,
Turn, and request ID plus an optional parent Tool call. Each resolves once. An
attachment read lease or interaction target is not mutation permission, and
approving one Tool call does not approve a later call. The complete Tool
permission and execution lifecycle is defined in
[Tool architecture](TOOLS.md).

Protocol failures use typed error codes with bounded diagnostic data. Missing
Hosts, Agents, Sessions, Chats, Turns, capabilities, resources, versions, and
permissions remain distinguishable. Error strings are presentation, not a
routing or retry contract.

## Agent contracts

`IAgent` composes separate Session and Chat operation surfaces:

```ts
interface IAgent {
	readonly id: AgentId;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly onDidEmitAction: Event<IAgentAction>;
	readonly configuration: IAgentConfiguration;
	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly resumeStates: IAgentResumeStates;
}

interface IAgentConfiguration {
	resolveSession(request: IAgentResolveSessionConfigurationRequest): Promise<IAgentResolvedSessionConfiguration>;
	completeSession(request: IAgentSessionConfigurationCompletionRequest): Promise<readonly IAgentConfigurationCompletion[]>;
	prepareSessionUpdate(request: IAgentPrepareSessionConfigurationUpdateRequest): Promise<void>;
	commitSessionUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void>;
	rollbackSessionUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void>;
	acknowledgeSessionUpdate(request: IAgentAcknowledgeSessionConfigurationUpdateRequest): Promise<void>;
}

interface IAgentExecutionProfile {
	readonly revision: AgentExecutionProfileRevision;
	readonly digest: AgentExecutionProfileDigest;
	readonly agentDescriptor: AgentDescriptorRevision;
	readonly modelDescriptor: AgentModelDescriptorRevision;
	readonly data: string;
}

interface IAgentExecutionProfiles {
	resolve(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile>;
}

interface IAgentResumeState {
	readonly schema: AgentResumeSchemaId;
	readonly data: string;
}

interface IAgentResumeMigrationRequest {
	readonly operation: AgentPackageOperationId;
	readonly backing: IAgentBackingIdentity;
	readonly source: IAgentResumeState;
	readonly sourceDigest: AgentResumeStateDigest;
	readonly targetSchema: AgentResumeSchemaId;
}

interface IAgentResumeStates {
	migrate(request: IAgentResumeMigrationRequest): Promise<IAgentResumeState>;
}

interface IAgentSessions {
	create(options: IAgentCreateSessionOptions): Promise<IAgentSessionBacking>;
	materialize(session: AgentSessionId, resume: IAgentResumeState | undefined): Promise<void>;
	release(session: AgentSessionId): Promise<void>;
	delete(session: AgentSessionId): Promise<void>;
}

interface IAgentChats {
	create(session: AgentSessionId, chat: AgentChatId, options: IAgentCreateChatOptions): Promise<IAgentChatBacking>;
	materialize(session: AgentSessionId, chat: AgentChatId, resume: IAgentResumeState | undefined): Promise<void>;
	release(session: AgentSessionId, chat: AgentChatId): Promise<void>;
	fork(session: AgentSessionId, chat: AgentChatId, source: IAgentChatForkSource): Promise<IAgentChatBacking>;
	send(session: AgentSessionId, chat: AgentChatId, request: IAgentChatRequest): Promise<void>;
	steer(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId, request: IAgentSteerRequest): Promise<void>;
	cancel(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): Promise<void>;
	delete(session: AgentSessionId, chat: AgentChatId): Promise<void>;
}
```

These are Host-side contracts, not Workbench services. Concrete contract files
live under `cs/platform/agentHost/common` and use only lower-layer types. The
product-bundled embedded Comet runtime implements them directly. A connected
runtime receives and emits their canonical protocol values through
`IAgentRuntimeConnection`; the generic connection owns framing and correlation
without introducing Agent-specific semantics. Every mutating call carries
Host-issued identity and operation context in its concrete options even where
the summary above omits those fields.

The configuration surface is required even when an Agent publishes no
user-editable properties. Its resolution returns the exact bounded schema and
values for the addressed context; completion is valid only for a property that
declares it; and a Session update prepares one complete validated candidate
before Agent Host records the commit or rollback decision. The finalize calls
are idempotent for the same operation and digest. The cleanup acknowledgement
is also idempotent and applies no configuration state; it releases only the
matching terminal transaction after the Host has persisted its completed
outcome. Callers do not probe for configuration methods or route configuration
through Agent-specific services.

Execution-profile resolution is the common pre-Turn Agent port for Comet,
Copilot, Claude, Codex, and other runtimes. The request carries one normalized
user or product selection, stable submission identity, selection digest, and
exact runtime registration revision. The result names exact Agent and model
descriptor revisions, identifies its complete bytes by digest, and carries
bounded opaque Agent-owned profile data. It contains no secret, Tool set,
executor, runtime endpoint, Host deadline, cancellation identity, resume state,
or SDK-native object.

Resolution is side-effect-free and retry-stable for the same submission,
selection digest, and runtime registration; the same request must return the
same revision, digest, and bytes. Agent Host validates the returned descriptor
revisions, digest, and bounds before using the profile to prepare attachments
and the Tool set. A connected runtime implements the same operation through the
Agent Runtime Protocol. Failure remains a pre-acceptance submission failure and
never selects another profile, model, runtime, or Agent.

Session and Chat backing results carry their current bounded
`IAgentResumeState`, and later resume-state changes are ordered Agent actions.
The Host stores the schema and opaque data together and never rewrites either
field.

Resume migration is a coherent typed surface even when an Agent declares no
supported edge. Agent descriptors publish exact source and target schema
pairs; the Host rejects an undeclared edge before dispatch. Migration runs only
against a staged package revision, is idempotent by operation, backing,
source digest, and target schema, and returns a new opaque value without
mutating authoritative state, external provider state, or Agent backing. The
Host validates the target schema and bounds, computes the returned digest, and
commits all migrated values with the package registrations or discards all of
them. A connected runtime receives the same request through the Agent Runtime
Protocol.

`IAgentBackingIdentity` contains the retained owning package ID, Agent ID,
Session ID, and optional Chat ID. Migration and restoration never recover
package ownership from the currently active Agent registry alone.

`IAgentChatRequest` carries the normalized user message, submitted attachments,
bound interaction targets, and one immutable Host Turn execution binding. That
binding contains the resolved Agent execution profile, complete model
configuration, and exact authorized credential references, and is the sole
authority for the Agent runtime registration, Tool-set revision, deadline,
cancellation identity, output constraints, and optional resume state. An Agent
runtime receives that one common request. It projects the request into its SDK,
model provider, or internal orchestration engine. Neither the embedded Comet
runtime nor a connected runtime queries Workbench state or reconstructs the
profile, model configuration, credentials, or Tool set from Agent identity.

The Host catalog and normalized Turn history are authoritative. Runtime-owned
Session discovery or import, when supported, is an explicit capability and
operation; `materialize` never scans an SDK or runtime and invents product
Sessions.

Operation surfaces remain coherent and typed even when a capability is absent.
The Host validates create-Chat, fork, queue, steer, cancel, delete, tool, and
other capabilities before dispatch. It does not probe for methods, catch an
unsupported result and try another path, or branch on an Agent ID.

## Session lifecycle

### Create and restore

Session creation accepts zero or more ordinary Chat creation specifications
using the same Chat contract that applies to an existing Session. It may also
include normalized initial Turn submissions for those Chats using the ordinary
Turn acceptance contract:

```text
caller supplies Session options and Chat creation specifications
    → Host validates authority, activated Agent registration, workspace,
      config, and capacity
    → Host records one idempotent create operation
    → Host reserves canonical Session, Chat, and optional Turn identities
    → prepared content is bound to the reserved identities
    → addressed Agent creates Session and requested Chat backing
    → Host atomically commits Session, Chat, and initial Turn state
    → provider publishes committed models and consumes accepted composers
    → addressed Agent begins each committed initial Turn
```

An optional Agent must already be installed and activated for the addressed
Host before this operation begins. A missing Agent registration fails Session
creation explicitly. The Host does not install a package, download an SDK, or
reinterpret Agent discovery as activation from this path.

The Agent create calls are idempotent under the Host operation identity. A
backing object created before catalog commit remains part of that recorded
operation. Recovery resumes the same operation; cancellation or terminal
failure releases prepared content, deletes provisional backing, and publishes
no partial catalog. Failure after the atomic commit is a failed or cancelled
Turn and does not remove the committed Session or Chat.

A committed Session owns an ordered collection of zero or more equal-status
Chats. A Chat created with its Session has no permanent first, primary, main,
or default role. An Agent whose SDK creates backing lazily still participates
in explicit Host creation; there is no create-on-send fallback.

Restoration resolves the owning package and Agent from persisted Host identity,
requires an active registration from that package for that Agent, asks it to
materialize the recorded opaque SDK backing, restores normalized Host state,
and then publishes the Session. Consumers never infer ownership from URI shape,
workspace, title, Chat order, or recency. Missing Agent registration or
unavailable backing leaves an explicit unavailable Session state.

### Release and delete

Release unloads materialized runtime resources while preserving the Host
catalog, normalized history, opaque runtime resume data, and ability to materialize the
same identities again. Releasing a Session releases its materialized Chats.
Closing a product view may allow release but is not itself a delete request.

Delete is a durable destructive operation. The Host records deletion intent,
invokes the addressed Agent idempotently, and removes the catalog entry only
after backing deletion completes. A failed deletion leaves the identity and
failed operation explicit for retry. It is never reported as a successful
release and never redirects to another resource.

Deleting a Session deletes every contained Chat through the same recorded
operation. Deleting one Chat never deletes its Session. Deleting the last Chat
leaves an empty Session when the Session itself was not addressed for deletion.

Package-wide Delete Agent data applies this ordinary delete lifecycle while
the exact package runtime remains activated. It gates every affected Agent and
drains non-terminal Turns and lifecycle mutations before dispatching deletion.
Retained Host-record purge is a different Host-only destructive operation that
is valid only after the package's installed record and runtime registrations
are absent: it removes selected catalog, normalized history, and opaque resume
records without invoking an Agent and without reporting Agent or provider
backing as deleted. Uninstall, Agent-backed deletion, and Host-record purge use
distinct operation kinds and terminal outcomes.

## Chat and Turn lifecycle

### Chat creation

Chats created with a Session and Chats created later use the same catalog
rules:

```text
create or fork request
    → Host validates Session ownership and capability
    → addressed Agent creates SDK Chat backing
    → Host commits one Chat catalog transition
    → provider creates the addressed IChatService model
    → provider publishes the ISession.chats update
```

SDK-specific backing IDs and resume data remain opaque. The Session's owning
Agent may use a separate SDK Session to back one of its peer or worker Chats,
but that backing does not become another product Session or change the Chat to
a different registered Agent.

Every Chat may be deleted when its own capability permits it, including the
first or last Chat in catalog order. Host routing never substitutes another
Chat when an addressed Chat is missing or unavailable.

### Turn acceptance and state

Attachment resolution and composer capture are Workbench preparation, not a
Host Turn. Preparation asks the addressed Agent to resolve one immutable
execution profile. Workbench then prepares attachments, and Agent Host resolves
Tool policy and targets into one immutable Tool-set revision; every prepared
value is bound to the submission identity. Host acceptance revalidates those
revisions and atomically commits a user message, normalized attachments, bound
interaction targets, resolved execution profile, exposed Tool-set revision,
Agent runtime registration revision, Turn ID, submission ID, and initial Turn
state. The Agent runtime begins execution only after that commit.

```text
preparing (Workbench only)
    → accepted
        ├── queued
        └── running
              ├── waiting for permission
              ├── waiting for user input
              ├── cancelling
              ├── completed
              ├── cancelled
              └── failed
```

`completed`, `cancelled`, and `failed` are terminal and monotonic. Tool calls,
reasoning, response parts, usage, permissions, and input requests have their own
typed substate within the addressed Turn. A terminal action closes the Turn
stream. Later SDK events for that Turn are rejected and reported; they do not
reopen or mutate it.

Chat descriptors declare whether an active Turn may coexist with queued user
turns and whether steering is supported. Without queue capability, another
submission while a Turn is active is rejected before acceptance. A queued user
message is already a committed Turn and is not composer state.

Cancellation addresses one exact Turn and is idempotent. Cancellation before
Host acceptance remains preparation cancellation and creates no Turn.
Cancellation after acceptance requests the terminal `cancelled` state; runtime
failure or refusal is represented explicitly. Steering addresses one active
Turn and uses its dedicated capability and operation. It is never emulated by
creating a synthetic user message.

Pre-acceptance failure preserves the composer. Agent runtime, execution-engine,
or Tool failure after acceptance preserves the committed user message and ends
the Turn as failed or cancelled. The provider applies Host state to the
addressed Workbench Chat model; it does not keep a second transcript.

## Persistence

Persistence follows ownership:

| State | Owner |
|---|---|
| installable and installed Agent package catalogs | Agent Host package services |
| package operations, staged resume migrations, and activated registration bindings | Agent Host package services |
| Host authority, owning package, and Agent identity | Agent Host catalog |
| Session and Chat membership | Agent Host catalog |
| normalized Session and Chat metadata | Agent Host runtime |
| Host Agent-default schemas, revisions, and values | Agent Host runtime |
| resolved Session configuration schema revisions and values | Agent Host runtime |
| canonical normalized turns, accepted execution-profile envelopes, Turn bindings, and ordered actions | Agent Host runtime |
| SDK-native configuration projection, runtime resume schema, opaque checkpoint, private history, and metadata | addressed Agent runtime |
| pending composer, transcript presentation cache, and Chat UI state | Workbench Chat |
| visible Session and active Chat state | Sessions services |

Agent-private resume data crosses Host persistence only as an opaque bounded
value paired with its declared resume-schema ID. The Host never parses it or
passes it to a runtime that did not advertise that schema. Workbench Chat
persistence does not reconstruct backend ownership or invent a missing Host
Session. On restoration, Host snapshots and history reconcile the presentation
model by stable identities and revisions.

Agent-private execution-profile data likewise crosses the Host only in its
bounded immutable envelope for one exact registration and accepted Turn. The
Host validates common descriptor revisions and never parses the opaque body or
uses it as package, Tool, credential, or routing authority.

## Module layout

```text
src/cs/platform/agentHost/
├── common/
│   ├── Agent, Session, Chat, Turn, capability, and content contracts
│   ├── Agent Host and Agent Runtime connection contracts
│   └── protocol schema, messages, actions, state, versions, and errors
├── browser/
│   └── remote-capable connection and resource support
├── electron-browser/
│   └── desktop local-Host connection
└── node/
    ├── Host runtime, catalog, subscriptions, content, and Tool services
    ├── packages/
    │   └── package discovery, verification, storage, operations, and activation
    ├── runtime/
    │   └── generic connected-runtime negotiation, correlation, and lifecycle
    └── agents/comet/
        └── embedded bundled Comet runtime, when selected by composition

src/cs/platform/remote/              Remote authority, transport, persistent
                                     connection, channel, and URI foundation
src/cs/workbench/services/remote/    selected Remote Server connection and
                                     application resource wiring
src/cs/server/node/agentHost/        remote Host composition and direct Remote
                                     channel binding to AgentHostAuthority

src/cs/sessions/contrib/providers/agentHost/
├── browser/
│   ├── shared provider and Host-backed Session and Chat models
│   ├── connected Tool-executor publication and execution-port integration
│   └── remote Host discovery and provider registration
└── electron-browser/
    └── desktop local-Host registration
```

`cs/platform/agentHost` imports neither Workbench nor Sessions. The shared
Sessions provider consumes public Sessions contracts and public Workbench Chat
model contracts, but no UI implementation. Agent Host protocol,
connected-runtime support, and the embedded Comet runtime do not live in a
parallel top-level `cs/agent` layer. A connected runtime package owns its
implementation outside the TypeScript layer and exposes only the Agent Runtime
Protocol to Agent Host.

## Adding an Agent

1. Use one stable package ID and declare the exact stable Agent IDs it may
   register, as defined in [Agent package architecture](AGENT_PACKAGES.md).
2. Publish one verified package manifest and one connected endpoint. Optional
   Agents remain absent until the user explicitly installs that package.
3. Implement the Agent Runtime Protocol and connect through
   `IAgentRuntimeConnection`. Only the product-bundled Comet composition may
   implement `IAgent` as an embedded runtime.
4. Define truthful descriptors, configuration schemas, model configuration,
   capabilities, Tool Schema Profiles, and resume schemas. Keep Agent-specific
   SDK or model-provider types, clients, native configuration, caches, event
   mapping, authentication, and resume data inside the runtime.
5. Consume the exact Turn-bound Tool set. The runtime owns lossless projection,
   deterministic aliases, call normalization, result encoding, and invocation
   through the Host Tool Execution Port.
6. Activate the package transaction atomically; the Host registry rejects
   duplicate, partial, undeclared, or dual-form Agent registrations.
7. Add package lifecycle and Agent contract tests for install, package-wide
   update, resume migration, uninstall, Agent-data deletion, Host-record purge,
   create, restore, release, delete, send, queue, steering, cancellation,
   history, Tool projection, resume validation, and event order.
8. Do not add a Sessions provider, Chat view, Agent-specific Host request path,
   automatic installation, dual embedded and connected registration, or
   runtime fallback.

## Adding a Host connection

1. Implement `IAgentHostConnection` for the Host placement and lifecycle. A
   remote implementation consumes one exact Remote Server channel or Remote
   Tunnel `agentHost` endpoint transport and follows
   [Remote Agent Host architecture](REMOTE_AGENT_HOST.md).
2. Preserve the same protocol negotiation, identities, operations, ordering,
   limits, errors, snapshots, and replay behavior.
3. Register one `AgentHostSessionsProvider` for each stable Host authority.
4. Keep placement-specific connection ownership explicit. Remote authority
   management or Remote Tunnel discovery, relay, and reconnection remain in
   their lower foundations; Agent Host semantic reconnection and exact
   content/executor binding remain in the remote Host connection.
5. Add tests for incompatible versions, action gaps, replay, snapshot recovery,
   lost acknowledgements, duplicate operation IDs, and missing resources.
6. Do not add Agent-specific routing or duplicate Session and Chat models.

## Invariants

- `CometAgent` is the built-in Agent integration and has stable Agent ID
  `comet`.
- The bundled `comet` package is the only default-installed Agent package.
  Every other Agent requires an explicit user install operation for the
  addressed Host and user scope.
- Installable, installed, activated, authenticated, and materialized are
  distinct states. Session and Turn paths never install or download packages.
- User-installed Agents always use connected runtimes. Embedded execution is
  reserved for a product-bundled Comet composition.
- Local and remote are Host placements, not Agent identities.
- Remote Agent Host selects one shared Remote Server channel or one direct
  Remote Tunnel endpoint; neither route is fallback for the other.
- The selected Remote or Remote Tunnel transport recovery and Agent Host
  semantic recovery are separate and occur in that order.
- Embedded and connected are runtime bindings, not Agent identities.
- One Host authority produces one Sessions provider instance.
- One Host authority has at most one active runtime registration for an Agent
  ID, and every Session resume value carries an explicitly supported schema.
- Package update gates all affected Agent IDs, drains every non-terminal
  accepted Turn and lifecycle mutation, releases materialized backing, and
  atomically commits registrations with every migrated resume value.
- All Agents enter Sessions through Agent Host.
- The Host owns canonical Session, Chat, Turn, and operation identity.
- Every accepted Turn binds one profile resolved through the common Agent port;
  profile bodies remain opaque to Host and SDK formats remain inside runtimes.
- Host Agent defaults, Session configuration, and model execution settings are
  separate scopes with exact schema revisions. Agent Host owns canonical
  schema and value state; each runtime owns only its native projection.
- Invalid, stale, or unauthorized configuration fails explicitly. No layer is
  skipped, coerced, silently dropped, or interpreted through Agent-ID branches.
- Every Session retains its owning package ID and Agent ID; another package
  cannot claim its catalog or opaque resume state by registering the same Agent
  ID.
- A Session owns zero or more equal-status Chats and has no distinguished Chat.
- Session creation may include ordinary Chat creation specifications.
- A draft's initial request commits Session, ordinary Chat, and user Turn in one
  Host operation; pre-commit failure publishes none of them.
- Every request addresses an exact Session and Chat; Turn operations also
  address an exact Turn.
- Negotiated versions and capabilities determine behavior; product names do
  not.
- Snapshots and contiguous channel revisions determine state; clients never
  infer a missing transition.
- Mutations reconcile by stable operation identity and never duplicate on
  reconnect.
- Agent-backed deletion and retained Host-record purge are distinct; a purge
  requires absent package registrations and never claims that Agent, SDK, or
  provider backing was deleted.
- Agent SDKs are package-private runtime dependencies, not product installation
  identities, and SDK or model-provider types never escape their owning
  runtime.
- Every Agent runtime owns its Tool projection. The Comet runtime consumes
  canonical Tools and projects them only at its model-provider boundary.
  Feature and executor implementations never convert Tools into
  model-provider or SDK formats.
- `IAgentHostConnection` and `IAgentRuntimeConnection` are distinct protocol
  boundaries and never substitute for one another.
- Every model-visible Tool is represented in the accepted canonical Tool-set
  revision; an Agent never silently adds or omits a Tool.
- Higher-layer Feature objects cross the Host boundary only as normalized
  bounded context, content-resource operations, or model-facing Tool calls.
- Attachments never register or expose Tools or grant mutation authority.
- Content-resource reads never enter the model Tool-call lifecycle.
- Host protocol code imports neither Workbench nor Sessions.
- Workbench Chat owns presentation and composer state, not backend lifecycle or
  canonical Host history.
- Capabilities gate optional behavior; provider-ID and Agent-ID branching is
  forbidden outside registration and identity routing.
- Missing connections, packages, Agents, Sessions, Chats, Turns, capabilities,
  versions, resume schemas, and resources fail explicitly. No operation falls
  back to another package source or revision, Host, Agent, runtime endpoint,
  packaging form, resource, representation, or code path.
