# Agent Host architecture

## Overview

Agent Host is Comet's common execution boundary for Agent SDKs. It separates
Host placement, Agent implementation, product Session and Chat models, and
Workbench Chat presentation.

```text
Sessions application
    → ISessionsManagementService
    → AgentHostSessionsProvider for one Host authority
    → IAgentHostConnection
        ├── local Agent Host connection
        └── remote Agent Host connection
    → Agent Host runtime
    → IAgent
        ├── CometAgent
        ├── CopilotAgent
        ├── ClaudeAgent
        └── CodexAgent
```

Local and remote describe Host placement and transport. `comet`, `copilot`,
`claude`, and `codex` identify Agent implementations. Neither dimension is
inferred from the other.

## Identities

Agent Host keeps the following identities distinct:

| Identity | Meaning | Owner |
|---|---|---|
| Host authority | One stable local or remote Agent Host endpoint | connection registry |
| Client connection ID | One logical client connection across transport reconnections | Host protocol |
| Sessions provider ID | One provider instance backed by one Host authority | Agent Host Sessions contribution |
| Agent ID | One Agent implementation registered inside a Host | Agent Host runtime |
| Session ID | One stable working context owned by one Agent | Agent Host runtime |
| Chat ID | One conversation stream inside one Session | Agent Host runtime |
| Turn ID | One accepted user request and Agent response lifecycle | Agent Host runtime |
| Operation ID | One retry-safe mutating protocol operation | operation owner |

The built-in Comet Agent has Agent ID `comet` and is implemented by
`CometAgent`. Host placement is not part of its Agent identity.

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

### Agent implementations

An `IAgent` implementation owns only its SDK-specific behavior:

- create, materialize, release, and delete SDK backing;
- translate normalized Host requests into SDK calls;
- translate SDK events into ordered Agent Host actions;
- map each accepted Turn's canonical Tool-set revision into the SDK's
  function/tool surface and map Tool results back to the matching SDK call;
- expose models, configuration, authentication requirements, and capabilities;
- persist or reconstruct SDK-specific history and opaque resume data;
- implement SDK-specific tool and permission integration behind Host contracts.

An Agent does not register an `ISessionsProvider`, create a Workbench Chat
model, manipulate Sessions services, access UI, or own Host transport. SDK
types, clients, caches, and event objects never escape their Agent.

### Host connections

`IAgentHostConnection` is the single consumer-facing protocol boundary. Local
and remote implementations expose the same commands, subscriptions, snapshots,
ordered actions, resources, and errors.

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
from attachments. A Client Tool is a model-facing Tool whose exact executor is
a connected Comet client contributor; `client`, `host`, `agent`, and `mcp` are
executor bindings over one canonical Tool lifecycle. Registration, Turn
exposure, target binding, permission, and invocation remain separate. Their
complete contract and the lazy Browser-content flow are defined in
[Tool and Client Tool architecture](CLIENT_TOOLS.md).

Reading or materializing an accepted attachment content reference is not a
Tool call. The Agent implementation performs that translation through the Host
content-resource protocol, so explicit message context never depends on the
model choosing a function. Content references and leases are defined in
[Attachment architecture](ATTACHMENTS.md).

## Connection protocol

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

Transport endpoint authentication and Agent SDK authentication are separate.
Transport authentication identifies and authorizes the Host peer. An Agent
authentication request identifies an Agent and credential scope and is routed
through a typed Host challenge. Failure in one scope never causes the Host to
try another Agent or credential source.

Tool permission requests are scoped to the exact Session, Chat, Turn, Tool
call, and request ID. User-input requests address the exact Session, Chat,
Turn, and request ID plus an optional parent Tool call. Each resolves once. An
attachment read lease or interaction target is not mutation permission, and
approving one Tool call does not approve a later call. The complete Client Tool
contract is defined in
[Tool and Client Tool architecture](CLIENT_TOOLS.md).

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

interface IAgentSessions {
	create(options: IAgentCreateSessionOptions): Promise<IAgentSessionBacking>;
	materialize(session: AgentSessionId, resumeData: string | undefined): Promise<void>;
	release(session: AgentSessionId): Promise<void>;
	delete(session: AgentSessionId): Promise<void>;
}

interface IAgentChats {
	create(session: AgentSessionId, chat: AgentChatId, options: IAgentCreateChatOptions): Promise<IAgentChatBacking>;
	materialize(session: AgentSessionId, chat: AgentChatId, resumeData: string | undefined): Promise<void>;
	release(session: AgentSessionId, chat: AgentChatId): Promise<void>;
	fork(session: AgentSessionId, chat: AgentChatId, source: IAgentChatForkSource): Promise<IAgentChatBacking>;
	send(session: AgentSessionId, chat: AgentChatId, request: IAgentChatRequest): Promise<void>;
	steer(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId, request: IAgentSteerRequest): Promise<void>;
	cancel(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): Promise<void>;
	delete(session: AgentSessionId, chat: AgentChatId): Promise<void>;
}
```

These are Host-side contracts, not Workbench services. Concrete contract files
live under `cs/platform/agentHost/common` and use only lower-layer types. Every
mutating call carries Host-issued identity and operation context in its concrete
options even where the summary above omits those fields.

`IAgentChatRequest` carries the normalized user message, submitted attachments,
bound interaction targets, exact exposed Tool-set revision, and other bounded
non-Feature request configuration. An Agent implementation receives that one
common request and translates it into its SDK; it never queries Workbench state
or reconstructs the Tool set from Agent identity.

The Host catalog and normalized Turn history are authoritative. SDK-backed
Session discovery or import, when supported, is an explicit capability and
operation; `materialize` never scans an SDK and invents product Sessions.

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
catalog, normalized history, SDK resume data, and ability to materialize the
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

SDK-specific backing IDs and resume data remain opaque. An Agent may use a
separate SDK Session to back a peer or worker Chat, but that backing does not
become another product Session.

Every Chat may be deleted when its own capability permits it, including the
first or last Chat in catalog order. Host routing never substitutes another
Chat when an addressed Chat is missing or unavailable.

### Turn acceptance and state

Attachment resolution and composer capture are Workbench preparation, not a
Host Turn. Preparation asks the Host to resolve the request's Tool policy and
targets into one immutable prepared Tool-set revision bound to the submission
identity.
Host acceptance revalidates that revision and atomically commits a user
message, normalized attachments, bound interaction targets, exposed Tool-set
revision, Turn ID, submission ID, and initial Turn state. The Agent begins SDK
execution only after that commit.

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
Cancellation after acceptance requests the terminal `cancelled` state; SDK
failure or refusal is represented explicitly. Steering addresses one active
Turn and uses its dedicated capability and operation. It is never emulated by
creating a synthetic user message.

Pre-acceptance failure preserves the composer. Agent, SDK, tool, or runtime
failure after acceptance preserves the committed user message and ends the
Turn as failed or cancelled. The provider applies Host state to the addressed
Workbench Chat model; it does not keep a second transcript.

## Persistence

Persistence follows ownership:

| State | Owner |
|---|---|
| Host authority and Agent identity | Agent Host catalog |
| Session and Chat membership | Agent Host catalog |
| normalized Session and Chat metadata | Agent Host runtime |
| canonical normalized turns and ordered actions | Agent Host runtime |
| SDK resume token, SDK history, and private metadata | addressed Agent |
| pending composer, transcript presentation cache, and Chat UI state | Workbench Chat |
| visible Session and active Chat state | Sessions services |

Agent-private resume data crosses Host persistence only as an opaque bounded
value. The Host never parses it. Workbench Chat persistence does not reconstruct
backend ownership or invent a missing Host Session. On restoration, Host
snapshots and history reconcile the presentation model by stable identities and
revisions.

## Module layout

```text
src/cs/platform/agentHost/
├── common/
│   ├── Agent, Session, Chat, Turn, capability, and content contracts
│   ├── connection and subscription contracts
│   └── protocol schema, messages, actions, state, versions, and errors
├── browser/
│   └── remote-capable connection and resource support
├── electron-browser/
│   └── desktop local-Host connection
└── node/
    ├── Host runtime, catalog, subscriptions, and content service
    └── agents/
        ├── comet/
        ├── copilot/
        ├── claude/
        └── codex/

src/cs/sessions/contrib/providers/agentHost/
├── browser/
│   ├── shared provider and Host-backed Session and Chat models
│   └── remote Host discovery and provider registration
└── electron-browser/
    └── desktop local-Host registration
```

`cs/platform/agentHost` imports neither Workbench nor Sessions. The shared
Sessions provider consumes public Sessions contracts and public Workbench Chat
model contracts, but no UI implementation. Agent protocol and turn runtime do
not live in a parallel top-level `cs/agent` layer.

## Adding an Agent

1. Implement `IAgent` under `cs/platform/agentHost/node/agents/<agent>/`.
2. Use one stable Agent ID and declare truthful descriptors and capabilities.
3. Keep SDK types, clients, caches, event mapping, authentication, and resume
   data inside the Agent implementation.
4. Register the Agent with the Host registry, which rejects duplicate IDs.
5. Add contract tests for create, restore, release, delete, send, queue,
   steering, cancellation, history, capability enforcement, and event order.
6. Do not add a Sessions provider, Chat view, or Host transport for the Agent.

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

- `CometAgent` is the built-in Agent and has stable Agent ID `comet`.
- Local and remote are Host placements, not Agent identities.
- One Host authority produces one Sessions provider instance.
- All Agent SDKs enter Sessions through Agent Host.
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
- Agent SDK types never escape their Agent implementation.
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
  and resources fail explicitly. No operation falls back to another Host,
  Agent, resource, representation, or code path.
