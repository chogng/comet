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
        ├── embedded Agent runtime
        └── IAgentRuntimeConnection
            └── connected Agent runtime
```

Local and remote describe Host placement and transport. `comet`, `copilot`,
`claude`, and `codex` identify Agent behavior. Embedded and connected describe
how that behavior is bound to the Host. None of these dimensions is inferred
from another.

## Identities

Agent Host keeps the following identities distinct:

| Identity | Meaning | Owner |
|---|---|---|
| Host authority | One stable local or remote Agent Host endpoint | connection registry |
| Client connection ID | One logical client connection across transport reconnections | Host protocol |
| Sessions provider ID | One provider instance backed by one Host authority | Agent Host Sessions contribution |
| Agent ID | One stable Agent behavior registered inside a Host | Agent Host runtime |
| Agent runtime connection ID | One logical connected Agent runtime across transport reconnections | Agent Runtime Protocol |
| Agent runtime registration revision | One exact runtime endpoint, descriptor, capability, and resume-schema registration for an Agent ID | Agent Host runtime |
| Session ID | One stable working context owned by one Agent | Agent Host runtime |
| Chat ID | One conversation stream inside one Session | Agent Host runtime |
| Turn ID | One accepted user request and Agent response lifecycle | Agent Host runtime |
| Operation ID | One retry-safe mutating protocol operation | operation owner |

The built-in Comet Agent has Agent ID `comet`. `CometAgent` names its
Host-facing Agent integration; it does not imply that Comet orchestration is
implemented in TypeScript or runs in the Agent Host process. Host placement and
runtime packaging are not part of its Agent identity.

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
- consume normalized Host Turn requests, including the exact Tool-set revision;
- emit ordered canonical Agent Host actions;
- expose models, configuration, authentication requirements, and capabilities;
- persist or reconstruct Agent-specific history and opaque resume data;
- integrate Tool calls, results, permissions, and input requests through Host
  contracts.

An endpoint may execute in the Agent Host process or connect to a runtime in
another process or language through `IAgentRuntimeConnection`. The connected
Agent Runtime Protocol is the language-neutral wire projection of the same
`IAgent` semantics, not a second Agent API. A runtime package that can implement
that protocol directly needs no Agent-specific Host bridge.

One Host authority accepts exactly one active registration for an Agent ID.
The registration records the exact endpoint, descriptor and capability
revisions, and the resume-schema IDs it can materialize. A Session persists its
Agent ID, resume-schema ID, and opaque resume data. A replacement runtime must
explicitly support that schema; Host code never hands opaque state to an
unqualified runtime or tries another endpoint after materialization fails.

An Agent runtime that uses an SDK additionally owns its SDK clients, request
and event mapping, Tool projection, aliases, callbacks, caches, and SDK resume
data. Those types never escape the runtime. Whether the runtime is embedded or
connected does not change its Agent, Session, Chat, Turn, Tool, attachment, or
permission semantics.

An Agent does not register an `ISessionsProvider`, create a Workbench Chat
model, manipulate Sessions services, access UI, own an Agent Host client
connection, or invoke a Workbench Feature outside the canonical Tool and
content-resource contracts.

### Comet Agent runtime

The `CometAgent` integration binds Agent ID `comet` to exactly one Comet
runtime. The runtime may be embedded or supplied as a connected Comet Code SDK
runtime. A Rust Comet Code package implements the Agent Runtime Protocol
directly, or exposes the same port through one direct native binding; Comet
does not require a second product request path or a Comet-specific Sessions
provider.

The Comet runtime owns Comet's internal orchestration loop:

- normalized prompt and model-input construction;
- explicit step, token, time, and concurrency budgets;
- exact model-provider selection and provider request conversion;
- model response and Tool-call interpretation;
- repeated model, Tool, and result steps until the Turn reaches a terminal
  outcome;
- Comet-specific orchestration state and opaque resume data.

The Comet runtime consumes the accepted canonical Tool-set revision directly.
Each model-request implementation may encode the descriptors for its provider
API, but Comet invokes every model-selected operation through the Host Tool
Execution Port and feeds the canonical result back into its own loop. It does
not create a parallel Tool lifecycle, hold Feature callbacks, or execute a
hidden Tool registry.

Agent Host remains the owner of Session, Chat, Turn, Tool-call, permission, and
operation state. Comet orchestration decides the next reasoning or execution
step but cannot bypass those state machines. Each Agent Host composition
registers one Comet runtime form explicitly; runtime failure never causes the
Host to switch between embedded, connected, SDK, model-provider, or Agent
runtime endpoints.

The Comet runtime never imports or calls another registered Agent runtime
directly. Registered Agents are peer execution endpoints, and the Agent Runtime
Port does not expose implicit cross-Agent invocation. Internal model and Tool
steps remain orchestration state in the parent Turn. When the owning Comet
runtime creates one of its own worker conversations, it publishes that
Tool-origin Chat through the ordinary Host Chat lifecycle.

### Host connections

`IAgentHostConnection` is the single consumer-facing protocol boundary. Local
and remote implementations expose the same commands, subscriptions, snapshots,
ordered actions, resources, and errors.

This connection joins a product client to an Agent Host. It is distinct from
`IAgentRuntimeConnection`, which joins that Host to a connected Agent runtime.
Neither connection substitutes for or tunnels through the other implicitly.

The local connection owns local process lifecycle and IPC. A remote connection
owns transport establishment, endpoint authentication, protocol negotiation,
reconnection, and remote resource mapping. Connection implementations do not
reimplement Agent, Session, Chat, Turn, or catalog behavior.

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

## Agent Runtime Protocol

### Registration and negotiation

An embedded Agent endpoint registers `IAgent` directly. A connected endpoint
registers through `IAgentRuntimeConnection` after negotiating one Agent Runtime
Protocol version. Initialization exchanges:

- a stable logical runtime connection ID;
- supported protocol versions and transport limits;
- the exact Agent IDs and descriptor revisions being registered;
- capability revisions and supported Tool Schema Profiles;
- supported opaque resume-schema IDs;
- informational runtime implementation and build identity.

Runtime endpoint authentication establishes which package may register each
Agent ID before initialization. It is distinct from product-client transport
authentication and from credentials the Agent later uses with an SDK or model
provider. A self-declared Agent ID grants no registration authority.

The Host selects one offered protocol version and atomically accepts or rejects
each Agent registration. Duplicate Agent IDs, incompatible versions, invalid
capabilities, and conflicting descriptor revisions fail registration. Runtime
implementation names and build versions are diagnostic only; routing uses the
Agent ID and exact accepted registration revision.

### Commands and reverse operations

The protocol serializes the same lifecycle and Turn operations as `IAgent`.
Host-to-runtime commands include Session and Chat creation, materialization,
release, deletion, accepted Turn execution, steering, cancellation, Tool
results, permission decisions, and user-input responses.

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
accepted registration revision, and exact active-operation set. A runtime
declares whether it can resume an accepted Turn and supplies the matching
opaque checkpoint tagged with a supported resume-schema ID. The Host reconciles
the same Turn and operation identities before execution continues.

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
Host and Agent descriptor revisions, and initial subscription snapshots. If no
offered version is compatible, initialization fails. Neither peer sends normal
commands before initialization or retries by parsing another dialect.

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
├── Agent and model descriptors
├── Session catalog
└── connection-level capabilities

Session channel
├── Session metadata and lifecycle
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
operation ID. Turn submissions additionally use their payload digest. The same
ID and digest returns the committed outcome; the same ID with different content
is a conflict. A client never resends an uncertain mutation under a new ID
before reconciliation, so reconnect cannot duplicate a Session, Chat, or user
turn.

### Authentication, permissions, and errors

Product-client transport authentication, Agent runtime endpoint authentication,
and Agent SDK or model-provider authentication are separate. Client transport
authentication identifies and authorizes the Host peer. Runtime authentication
authorizes exact Agent registrations. An Agent authentication request identifies
an Agent and credential scope and is routed through a typed Host challenge.
Failure in one scope never causes the Host to try another runtime, Agent, or
credential source.

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
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
}

interface IAgentResumeState {
	readonly schema: AgentResumeSchemaId;
	readonly data: string;
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
live under `cs/platform/agentHost/common` and use only lower-layer types. An
embedded runtime implements them directly. A connected runtime receives and
emits their canonical protocol values through `IAgentRuntimeConnection`; the
generic connection owns framing and correlation without introducing
Agent-specific semantics. Every mutating call carries Host-issued identity and
operation context in its concrete options even where the summary above omits
those fields.

Session and Chat backing results carry their current bounded
`IAgentResumeState`, and later resume-state changes are ordered Agent actions.
The Host stores the schema and opaque data together and never rewrites either
field.

`IAgentChatRequest` carries the normalized user message, submitted attachments,
bound interaction targets, exact Agent runtime registration and exposed
Tool-set revisions, and other bounded non-Feature request configuration. An
Agent runtime receives that one common request. It projects the request into
its SDK, model provider, or internal orchestration engine. Neither an embedded
nor connected runtime queries Workbench state or reconstructs the Tool set from
Agent identity.

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
    → Host validates authority, Agent, workspace, config, and capacity
    → Host records one idempotent create operation
    → Host reserves canonical Session, Chat, and optional Turn identities
    → prepared content is bound to the reserved identities
    → addressed Agent creates Session and requested Chat backing
    → Host atomically commits Session, Chat, and initial Turn state
    → provider publishes committed models and consumes accepted composers
    → addressed Agent begins each committed initial Turn
```

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

Restoration resolves the owning Agent from persisted Host identity, asks that
Agent to materialize the recorded opaque SDK backing, restores normalized Host
state, and then publishes the Session. Consumers never infer ownership from URI
shape, workspace, title, Chat order, or recency. Missing Agent registration or
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
Host Turn. Preparation asks the Host to resolve the request's Tool policy and
targets into one immutable prepared Tool-set revision bound to the submission
identity. Host acceptance revalidates that revision and atomically commits a
user message, normalized attachments, bound interaction targets, exposed
Tool-set revision, Agent runtime registration revision, Turn ID, submission ID,
and initial Turn state. The Agent runtime begins execution only after that
commit.

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
| Host authority and Agent identity | Agent Host catalog |
| Session and Chat membership | Agent Host catalog |
| normalized Session and Chat metadata | Agent Host runtime |
| canonical normalized turns and ordered actions | Agent Host runtime |
| runtime resume schema, opaque checkpoint, private history, and metadata | addressed Agent runtime |
| pending composer, transcript presentation cache, and Chat UI state | Workbench Chat |
| visible Session and active Chat state | Sessions services |

Agent-private resume data crosses Host persistence only as an opaque bounded
value paired with its declared resume-schema ID. The Host never parses it or
passes it to a runtime that did not advertise that schema. Workbench Chat
persistence does not reconstruct backend ownership or invent a missing Host
Session. On restoration, Host snapshots and history reconcile the presentation
model by stable identities and revisions.

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
    ├── runtime/
    │   └── generic connected-runtime negotiation, correlation, and lifecycle
    └── agents/             optional embedded Agent runtimes
        ├── comet/
        ├── copilot/
        ├── claude/
        └── codex/

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
connected-runtime support, and embedded turn runtimes do not live in a parallel
top-level `cs/agent` layer. A connected runtime package owns its implementation
outside the TypeScript layer and exposes only the Agent Runtime Protocol to
Agent Host.

## Adding an Agent

1. Use one stable Agent ID and define truthful descriptors, capabilities,
   Tool Schema Profiles, and resume schemas.
2. Register exactly one endpoint form for that Agent ID: implement `IAgent`
   under `cs/platform/agentHost/node/agents/<agent>/` for an embedded runtime,
   or implement the Agent Runtime Protocol and connect through
   `IAgentRuntimeConnection` for a connected runtime.
3. Keep Agent-specific runtime, SDK or model-provider types, clients, caches,
   event mapping, authentication, and resume data inside the implementation.
4. Consume the exact Turn-bound Tool set. The runtime owns lossless projection,
   deterministic aliases, call normalization, result encoding, and invocation
   through the Host Tool Execution Port.
5. Register the Agent with the Host registry, which rejects duplicate IDs.
6. Add contract tests for create, restore, release, delete, send, queue,
   steering, cancellation, history, capability enforcement, Tool projection,
   resume-schema validation, and event order. Connected runtimes also test
   negotiation, correlation, disconnect, and exact resumption.
7. Do not add a Sessions provider, Chat view, Agent-specific Host request path,
   dual embedded and connected registration, or runtime fallback.

## Adding a Host connection

1. Implement `IAgentHostConnection` for the transport and lifecycle.
2. Preserve the same protocol negotiation, identities, operations, ordering,
   limits, errors, snapshots, and replay behavior.
3. Register one `AgentHostSessionsProvider` for each stable Host authority.
4. Keep endpoint authentication, reconnection, and resource mapping in the
   connection contribution.
5. Add tests for incompatible versions, action gaps, replay, snapshot recovery,
   lost acknowledgements, duplicate operation IDs, and missing resources.
6. Do not add Agent-specific routing or duplicate Session and Chat models.

## Invariants

- `CometAgent` is the built-in Agent integration and has stable Agent ID
  `comet`.
- Local and remote are Host placements, not Agent identities.
- Embedded and connected are runtime bindings, not Agent identities.
- One Host authority produces one Sessions provider instance.
- One Host authority has at most one active runtime registration for an Agent
  ID, and every Session resume value carries an explicitly supported schema.
- All Agents enter Sessions through Agent Host.
- The Host owns canonical Session, Chat, Turn, and operation identity.
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
- Agent SDK and model-provider types never escape their owning runtime.
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
- Missing connections, Agents, Sessions, Chats, Turns, capabilities, versions,
  resume schemas, and resources fail explicitly. No operation falls back to
  another Host, Agent, runtime endpoint, packaging form, resource,
  representation, or code path.
