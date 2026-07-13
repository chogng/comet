# Agent Host architecture

## Overview

Agent Host is Comet's common execution boundary for Agent SDKs. It separates
where an Agent runs from which Agent implementation handles a Session and from
the Sessions and Chat models presented by the product.

```text
Sessions application
    → ISessionsManagementService
    → AgentHostSessionsProvider for one Host connection
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
| Host connection ID | One local or remote Agent Host endpoint | connection registry |
| Sessions provider ID | One provider instance backed by one Host connection | Agent Host Sessions contribution |
| Agent ID | One Agent implementation available inside a Host | Agent Host runtime |
| Session ID | One stable working context owned by one Agent | Agent Host runtime |
| Chat ID | One conversation stream inside one Session | Agent Host runtime |

The built-in Comet Agent has Agent ID `comet` and is implemented by
`CometAgent`. Host placement is not part of its Agent identity.

The local Host has one stable provider identity. Each remote Host connection
has its own provider identity derived from its stable connection authority.
Agent IDs remain the same across local and remote Hosts.

Implementation and identity names follow those boundaries. `agentHost` names
the shared provider family, an Agent ID such as `comet` names Agent behavior,
and `local` or `remote` names Host placement. `default` is not an Agent,
provider, Session, Chat, storage, or routing identity and is not used as an
implementation prefix. There is no `defaultChat` or `mainChat` identity, field,
type, or routing rule. Every Chat is addressed by its own Chat ID.

## Ownership

### Agent Host runtime

The environment-neutral Agent Host protocol and the Node Agent Host runtime
own:

- Agent registration, discovery, descriptors, models, and capabilities;
- canonical Session and Chat identities and their ownership mapping;
- the Session catalog and each Session's Chat catalog;
- explicit create, restore, release, and delete lifecycle;
- request routing, cancellation, steering, and ordered state publication;
- dynamic Agent and Session configuration;
- authentication, permission requests, tools, terminals, and changesets;
- normalized durable Session and Chat metadata;
- protocol versioning and connection-independent state semantics.

The runtime does not import Workbench Chat, Sessions, Parts, widgets, or product
layout services.

### Agent implementations

An `IAgent` implementation owns only its SDK-specific behavior:

- create, materialize, release, and delete SDK Session backing;
- translate normalized requests into SDK calls;
- translate SDK events into Agent Host actions and turn state;
- expose models, configuration, authentication requirements, and capabilities;
- persist or reconstruct SDK-specific history and opaque resume data;
- implement SDK-specific tool and permission integration behind Host contracts.

An Agent does not register an `ISessionsProvider`, create a Workbench Chat
model, manipulate Sessions services, access UI, or own Host transport.

### Host connections

`IAgentHostConnection` is the single consumer-facing protocol boundary. Local
and remote implementations provide the same operations and ordered state.

The local connection owns local process lifecycle and IPC. A remote connection
owns transport establishment, authentication exchange, protocol negotiation,
reconnection, and remote resource mapping. Connection implementations do not
reimplement Agent, Session, Chat, or catalog behavior.

### Agent Host Sessions provider

One `AgentHostSessionsProvider` instance connects one `IAgentHostConnection` to
the provider-independent Sessions domain. It:

- implements `ISessionsProvider`;
- maps Host descriptors to `ISession`, `IChat`, and capabilities;
- owns draft-to-committed product transitions;
- routes Session and Chat operations to the addressed Host connection;
- owns Workbench Chat model references for the Chats it exposes;
- maps committed Host turn state into the addressed `IChatService` model;
- publishes authoritative Session collection transitions.

The provider does not import Sessions Parts, `ChatWidget`, concrete Chat views,
or layout services. Local and remote contributions construct the same provider
implementation with different connections; they do not maintain separate
Session or Chat implementations.

### Workbench Chat

`IChatService` owns one conversation model addressed by `chatResource`,
including transcript presentation state, composer state, attachments, and
request transactions. It does not create product `ISession` objects, choose an
Agent, own backend Session lifecycle, or serve as the durable Agent history
authority.

Pending composer attachments and submitted message attachments are distinct
states. Adding selected transcript text, an Article, an Editor selection, a
Browser page, text, or an image updates the addressed composer. Sending captures
an immutable attachment snapshot and associates it with the submitted user
turn. A feature action never manufactures a submitted Chat message merely to
make context visible to a later Agent request.

Pending composer attachments are Workbench draft state and never cross the Host
boundary. The Host receives only normalized attachments from an accepted
submission. This avoids converting Feature-owned draft state into Host state
and back merely to persist or restore a composer.

Text selected from the Chat transcript is captured by the Chat renderer as
ordered fragments with source message identity and role. Chat stores the
captured text as a composer attachment. The Host receives only bounded text
context when the request is submitted; DOM ranges and renderer objects remain
inside Workbench Chat.

All attachment producers use the same addressed Chat attachment API. Browser,
Article, PDF, File, Editor, Chat-selection, text, and image features do not add
provider-specific request paths. Only an explicit Feature attachment action
adds an object to the composer. Feature selection, active Editor state,
downloads, exports, and other operations remain independent and are never
projected into pending attachments by general Chat submission.

The Sessions Chat contribution binds Chat input to
`ISessionsManagementService`. Requests continue through the owning Sessions
provider; Workbench Chat never calls an Agent SDK or Host connection directly.
The Chat view sends only the addressed Session and Chat identities. It does not
copy prompt or attachment state into a Sessions-owned request DTO. The shared
provider begins a submission transaction on the addressed `IChatService` model
and receives the immutable composer revision through Chat's common API.

### Attachment pipeline

Attachments cross three explicit representations:

```text
feature-owned source
    → registered attachment object in the addressed composer
    → producer-resolved Agent Host message attachment
    → addressed Agent's SDK input
```

The Chat attachment model knows only the common envelope: stable attachment ID,
stable attachment type ID, producer-state schema version, label, and bounded
serializable producer state. It owns collection ordering, removal, atomic batch
addition, submission snapshots, and submission transactions. It enforces only
exact attachment-ID uniqueness; the producer owns semantic identity and stable
IDs for Articles, Browser pages, Files, ranges, and other sources. It does not
contain an Article, Browser, PDF, File, or Editor union and does not inspect
producer state.

Each attachment type is contributed through a registry. Its owner provides the
state validator and codec, composer and transcript presentation factories,
send-time resolver, and restoration behavior. A resolver can capture an
in-memory Editor document, publish a PDF or File resource, preserve a PDF or
Editor selection, issue an Article or Browser content reference, or embed a
small immutable image. The Sessions provider dispatches by the registered type
without importing or branching on Feature identities.

Common state and resolver registration is independent of browser presentation
registration so environment-neutral Chat and Host contracts never depend on
DOM or widget types. Runtime registrations accept only the current producer
state schema. Persisted schema changes use one explicit versioned storage
migration, not multi-shape codecs or runtime compatibility branches. Missing
type registration restores a removable unavailable attachment that blocks
submission; it is never reinterpreted as a generic type.

The Agent Host message protocol carries one generic attachment envelope with a
producer-supplied model representation, one optional discriminated content
carrier containing either bounded inline content or a content reference, MIME
information, immutable content version, and bounded round-trip metadata. These
are transport forms, not a list of Comet Feature kinds. Each submitted
attachment is stored with its message. Common validation covers identity,
carrier shape, size, content leases, content version, and duplicate attachments
before the Host commits the turn.

Agent descriptors advertise supported attachment transport and media
capabilities, not Article, Browser, PDF, Workbench Feature, or Agent-ID cases.
Model descriptors refine those capabilities with explicit carrier, MIME,
count, per-item, and total-byte limits; Chat never infers support from a model
family or display name. The addressed Agent translates the common envelope
into its SDK request. An unsupported carrier or media type fails before
submission; Agent implementations never silently drop an attachment, stringify
an unreadable resource, or retry it as another kind.

Attachments carry context and may include an exact read reference or target
token. Agent and model selection, tool registration, skills, MCP servers,
commands, mutation permissions, and confirmation policy are separate typed
request fields. An already registered client tool may consume an attachment's
target, but registering or adding an attachment never registers or enables that
tool. Mutation still follows the tool's independent permission and confirmation
contract.

### Request submission

Request submission is a two-boundary transaction with one stable submission
ID:

```text
capture one addressed composer revision
    → resolve every registered attachment and bind its content version
    → validate total limits and addressed Agent and model capabilities
    → submit normalized message, submission ID, and payload digest to Host
    → Host atomically commits the canonical turn
    → Workbench Chat consumes the captured composer revision
```

`ISessionsManagementService` and `ISessionsProvider` route submission by the
addressed Session and Chat; they do not define another attachment union or
accept Feature payloads. The shared Agent Host provider obtains the captured
prompt and generic composer envelopes from `IChatService`, invokes registered
resolvers, and passes only normalized Host attachments to the connection.

The captured composer revision is read-only except for cancellation while it is
being prepared. Any resolver failure, cancellation, capability mismatch, or
Host rejection before acceptance releases every prepared lease, preserves the
composer, and creates no transcript turn. Once the Host accepts and commits the
turn, SDK or Agent failure is a terminal state of that turn; it never deletes
the user message or restores the submitted composer.

For the first submission from a product Session draft, preparation uses the
selected Host connection, Agent descriptor, and submission ID before a Host
Session exists. Only successful preparation proceeds to explicit Host Session
and ordinary Chat creation in one catalog transaction. Prepared references are
then bound to the committed Session, Chat, turn, and attachment identities.
Preparation failure leaves the product draft intact and does not create an
empty Host Session.

Submission IDs make acknowledgement loss and reconnect recovery deterministic.
The Host returns the existing committed turn for the same ID and payload digest
and rejects reuse of the ID with different content. Workbench applies Host
state and consumes the matching composer revision idempotently, so a process
boundary is not described as an impossible distributed atomic write.

The digest covers canonical prompt, Agent and model selection, non-executable
request configuration, attachment identity, producer type, carrier, MIME, and
immutable content version or hash. It excludes ephemeral lease tokens and
connection-local handles. Submission also carries the descriptor revision used
during preparation; the Host revalidates the current Agent and model descriptor
and rejects a stale revision before committing the turn.

Retry and replay use the normalized attachment envelope stored on the Host
message. They do not invoke the producer resolver against current Feature
state. A producer may rematerialize a content handle only for the stored source
version; an unavailable or changed version fails explicitly and requires a new
attachment.

### Feature context and client tools

Editor documents, Article records, Browser state, and other higher-layer
objects never enter Platform Agent Host directly. Their owning Workbench or
Sessions contribution resolves them into bounded Agent Host DTOs before a
request crosses `IAgentHostConnection`.

An Article attachment contains stable Article identity, normalized metadata,
and a stable content reference. `ArticleDetail` does not represent the complete
article body. Complete text comes from a feature-owned content extraction
capability that can return bounded chunks. The extraction capability is
independent of Agent identity and SDK choice.

Persistent normalized turns store the content reference and metadata, not a
live capability handle. The feature owner materializes a read handle under the
submission staging identity and binds it to the addressed Session, Chat, and
lease lifetime after Host acceptance. An Agent can invoke the typed read-content
client tool with that handle; the connection routes the request to the feature
owner that issued it. Agent Host does not scrape pages, and an Agent does not
import Fetch or Browser types. Unknown, expired, denied, or unsupported
references and handles fail explicitly without trying another extractor.

A content reference declares whether immutable bytes are Host-owned or whether
reads require the originating client connection. Host-owned content remains
available across client disconnects. Client-owned content uses an opaque handle
scoped first to the connection and submission staging ID, then to the exact
Session, Chat, turn, attachment, source version, and lease after Host
acceptance. Explicit attachment never grants a Host general access to a local
path or its descendants. A directory attachment requires its own explicit,
bounded directory capability.

Remote Hosts never receive a client-local `file` URI as if it were a readable
remote path. They receive an opaque content reference and use bounded offset and
length reads. If an SDK requires a local path, its Agent asks the Host content
service to materialize the referenced version on the Host. The Feature resolver
does not fabricate a remote path. A request containing client-owned content
cannot be advertised as independent background execution after that client
disconnects.

Agent Host defines typed context and client-tool envelopes in its common
protocol. Feature owners register the corresponding client-side
implementations through a Host connection integration point. Local and remote
Hosts invoke the same protocol operation and receive the same typed result.

```text
Agent requests a client capability
    → Agent Host emits a typed client-tool request
    → addressed connection routes it to the registered feature owner
    → feature owner performs the operation through its public service
    → typed bounded result returns to the Agent
```

An Agent never imports Editor, Fetch, BrowserView, Workbench Chat, or Sessions
types to implement a tool. Missing client capability registration and rejected
tool execution are explicit protocol errors; the Host does not execute a
second local implementation.

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
	list(): Promise<readonly IAgentSessionDescriptor[]>;
	create(options: IAgentCreateSessionOptions): Promise<IAgentSessionBacking>;
	materialize(session: AgentSessionId, resumeData: string | undefined): Promise<void>;
	release(session: AgentSessionId): Promise<void>;
	delete(session: AgentSessionId): Promise<void>;
}

interface IAgentChats {
	create(session: AgentSessionId, chat: AgentChatId, options: IAgentCreateChatOptions): Promise<IAgentChatBacking>;
	materialize(session: AgentSessionId, chat: AgentChatId, resumeData: string | undefined): Promise<void>;
	fork(session: AgentSessionId, chat: AgentChatId, source: IAgentChatForkSource): Promise<IAgentChatBacking>;
	send(session: AgentSessionId, chat: AgentChatId, request: IAgentChatRequest): Promise<void>;
	cancel(session: AgentSessionId, chat: AgentChatId): Promise<void>;
	delete(session: AgentSessionId, chat: AgentChatId): Promise<void>;
	getHistory(session: AgentSessionId, chat: AgentChatId): Promise<readonly IAgentTurn[]>;
}
```

These are Host-side contracts, not Workbench services. Concrete contract files
live under `cs/platform/agentHost/common` and use only lower-layer types.

Core operations are explicit. Optional feature families such as peer Chats and
forking are advertised through capabilities and retain coherent typed
operations. The Host validates capabilities before dispatch. It does not probe
for methods, catch an unsupported operation and try another path, or branch on
an Agent ID.

## Session lifecycle

Creating a Session follows one deterministic path. The request may contain zero
or more ordinary Chat creation specifications using the same Chat creation
contract that applies to an existing Session:

```text
caller supplies Session options and zero or more Chat creation specifications
    → AgentHostSessionsProvider resolves Host, Agent, workspace, and config
    → IAgentHostConnection.createSession(...)
    → Agent Host allocates canonical Session and requested Chat identities
    → addressed IAgent creates the Session and requested Chat backing
    → Host atomically commits the Session and requested Chat catalog entries
    → provider publishes the committed ISession and IChat models
```

A committed Session owns an ordered collection of zero or more Chats. A Chat
created in the same transaction as its Session has no permanent first, primary,
main, or default role after commit. An Agent whose SDK cannot materialize
backing until the first prompt may keep provisional backing internally, but the
Host still performs explicit create operations before send. There is no
create-on-send fallback or catch-and-retry path.

If any staged Agent backing creation fails before catalog commit, the Host
releases every backing object created by that transaction and publishes no
Session or Chat entry. It never commits a partial catalog and repairs it by
guessing a replacement Chat.

Restoration resolves the owning Agent from persisted Host identity, asks the
Agent to materialize opaque SDK backing, reconstructs normalized history, and
then publishes the Session. Consumers never infer ownership from URI shape,
workspace, title, or recency.

## Chat lifecycle

The Host owns the authoritative Chat catalog. Chats created with a Session and
Chats created later enter through the same Chat contract and catalog commit
rules:

```text
create or fork request
    → Host validates Session ownership and capability
    → addressed IAgent creates SDK Chat backing
    → Host commits one Chat catalog transition
    → provider creates the addressed IChatService model
    → AgentHostSessionsProvider publishes the ISession.chats update
```

SDK-specific Chat backing IDs and resume data are opaque to the Host catalog.
An Agent may use a separate SDK Session to back a peer Chat, but that backing
does not become another product Session.

Every Chat may be deleted when its own capability permits it, including the
first or last Chat in a Session. Deleting the last Chat leaves an empty Session;
Session deletion is a separate explicit operation. Host routing never
substitutes another Chat when an addressed Chat is missing or unavailable.

Sending a request addresses both Session and Chat. The Host publishes ordered
turn actions for text, reasoning, tool calls, results, permission requests,
user input requests, completion, cancellation, and failure. Agent Host Sessions
integration applies those committed actions to the addressed Workbench Chat
model. There is no second provider-owned transcript or independent Chat
membership collection.

Before the Host commits a turn, Workbench Chat exposes only a preparing
submission tied to the composer revision; it is not Agent history. Host
acceptance creates the user turn and consumes that revision. Pre-acceptance
failure remains a composer error, while post-acceptance failure is recorded on
the committed turn.

## Persistence

Persistence follows ownership:

| State | Owner |
|---|---|
| Host and Agent identity | Agent Host catalog |
| Session and Chat membership | Agent Host catalog |
| normalized Session and Chat metadata | Agent Host runtime |
| SDK resume token, event log, and private metadata | addressed Agent |
| transcript and composer presentation model | Workbench Chat |
| visible Session and active Chat state | Sessions services |

Agent-private resume data crosses Host persistence only as an opaque bounded
value. The Host never parses it. Workbench Chat persistence is not used to
reconstruct backend ownership or invent a missing Host Session.

## Module layout

```text
src/cs/platform/agentHost/
├── common/                       protocol and Agent contracts
├── browser/                      remote-capable connection support
├── electron-browser/             local desktop connection
└── node/
    ├── agentHostRuntime
    └── agents/
        ├── comet/
        ├── copilot/
        ├── claude/
        └── codex/

src/cs/sessions/contrib/providers/agentHost/
├── browser/
│   ├── shared Sessions provider implementation
│   └── remote Host connection discovery and registration
└── electron-browser/             desktop local-Host registration
```

`cs/platform/agentHost` imports neither Workbench nor Sessions. The Agent Host
Sessions provider may consume public Sessions contracts and public Workbench
Chat model contracts, but no UI implementation. Local and remote connection
contributions live in the same Agent Host provider family and construct the
same provider implementation; neither owns another Session or Chat model.

Agent protocol and turn runtime code belongs to Platform Agent Host. It does
not live in a parallel top-level `cs/agent` layer. Model invocation, evidence
retrieval, and other Host-side runtime dependencies use Platform contracts and
implementations; UI settings and feature context cross the Host protocol as
validated values.

## Adding an Agent

1. Implement `IAgent` under `cs/platform/agentHost/node/agents/<agent>/`.
2. Use a stable Agent ID and declare truthful capabilities.
3. Keep SDK types, clients, caches, event mapping, and resume data inside the
   Agent implementation.
4. Register the Agent with the Agent Host runtime.
5. Add contract tests for create, restore, send, cancellation, history,
   disposal, capability enforcement, and event ordering.
6. Do not add a Sessions provider, Chat view, or Host transport for the Agent.

## Adding a Host connection

1. Implement `IAgentHostConnection` for the transport and lifecycle.
2. Preserve the same protocol identities, operations, ordering, and errors.
3. Register one `AgentHostSessionsProvider` for each stable connection.
4. Keep reconnection, authentication, and resource mapping in the connection
   contribution.
5. Do not add Agent-specific routing or duplicate Session and Chat models.

## Invariants

- `CometAgent` is the built-in Agent and has stable Agent ID `comet`.
- Local and remote are Host placements, not Agent identities.
- One Host connection produces one Sessions provider instance.
- All Agent SDKs enter Sessions through Agent Host.
- The Host owns one Session catalog and one Chat catalog per Session.
- A Session owns zero or more equal-status Chats and has no distinguished Chat
  identity or property.
- Session creation may atomically include ordinary Chat creation requests using
  the common Chat contract.
- Every request addresses a Session and a Chat.
- Every submitted turn has one stable submission ID and immutable payload
  digest.
- Agent SDK types never escape their Agent implementation.
- Higher-layer feature objects cross the Host boundary only as typed bounded
  context or client-tool messages.
- Pending composer attachments remain Workbench state; submitted Host
  attachments are immutable and version-addressed.
- Retry reuses submitted Host attachments and never reads current Feature state
  as a substitute.
- Attachments never register tools or grant mutation authority; separately
  registered tools may consume their scoped read references or target tokens.
- Host protocol code imports neither Workbench nor Sessions.
- Workbench Chat owns Chat models but not backend Session lifecycle.
- Capabilities gate optional behavior; provider-ID and Agent-ID branching is
  forbidden outside registration and identity routing.
- Missing connections, Agents, Sessions, Chats, and capabilities fail
  explicitly. No operation falls back to another Host, Agent, or code path.
