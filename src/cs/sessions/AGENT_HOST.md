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

Text selected from the Chat transcript is captured by the Chat renderer as
ordered fragments with source message identity and role. Chat stores the
captured text as a composer attachment. The Host receives only bounded text
context when the request is submitted; DOM ranges and renderer objects remain
inside Workbench Chat.

The Sessions Chat contribution binds Chat input to
`ISessionsManagementService`. Requests continue through the owning Sessions
provider; Workbench Chat never calls an Agent SDK or Host connection directly.

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
live capability handle. The feature owner materializes a read handle for an
addressed Host connection, Session, Chat, and lease lifetime declared by the
protocol. An Agent can invoke the typed read-content client tool with that
handle; the connection routes the request to the feature owner that issued it.
Agent Host does not scrape pages, and an Agent does not import Fetch or Browser
types. Unknown, expired, denied, or unsupported references and handles fail
explicitly without trying another extractor.

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

Creating a Session follows one deterministic path:

```text
Sessions management creates a product draft
    → AgentHostSessionsProvider resolves Host, Agent, workspace, and config
    → IAgentHostConnection.createSession(...)
    → Agent Host prepares the canonical Session identity and default Chat
    → addressed IAgent creates its SDK backing
    → Host atomically commits Session state and the default Chat catalog entry
    → provider replaces the product draft with the committed ISession
```

Every committed Session has exactly one default Chat, and that Chat is always
the Session's `mainChat`. An Agent whose SDK cannot materialize backing until
the first prompt may keep provisional backing internally, but the Host still
performs one explicit create operation before send. There is no create-on-send
fallback or catch-and-retry path.

Restoration resolves the owning Agent from persisted Host identity, asks the
Agent to materialize opaque SDK backing, reconstructs normalized history, and
then publishes the Session. Consumers never infer ownership from URI shape,
workspace, title, or recency.

## Chat lifecycle

The Host owns the authoritative Chat catalog. The default Chat is created with
the Session. Peer and fork Chats enter through the same catalog commit path:

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

Sending a request addresses both Session and Chat. The Host publishes ordered
turn actions for text, reasoning, tool calls, results, permission requests,
user input requests, completion, cancellation, and failure. Agent Host Sessions
integration applies those committed actions to the addressed Workbench Chat
model. There is no second provider-owned transcript or independent Chat
membership collection.

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
- Session creation atomically establishes the default Chat.
- Every request addresses a Session and a Chat.
- Agent SDK types never escape their Agent implementation.
- Higher-layer feature objects cross the Host boundary only as typed bounded
  context or client-tool messages.
- Host protocol code imports neither Workbench nor Sessions.
- Workbench Chat owns Chat models but not backend Session lifecycle.
- Capabilities gate optional behavior; provider-ID and Agent-ID branching is
  forbidden outside registration and identity routing.
- Missing connections, Agents, Sessions, Chats, and capabilities fail
  explicitly. No operation falls back to another Host, Agent, or code path.
