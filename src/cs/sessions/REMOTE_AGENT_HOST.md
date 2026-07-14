# Remote Agent Host architecture

## Overview

Remote Agent Host connects the Sessions application to an Agent Host authority
outside the application process through the common `IAgentHostConnection`
contract. It has two explicit connection routes:

```text
Remote Server route

Sessions application
    → RemoteServerAgentHostSessionsContribution
    → RemoteAgentHostConnection
    → Agent Host channel on IRemoteServerConnection
    → Comet Remote Server
    → AgentHostAuthority

Remote Tunnel route

Sessions application
    → RemoteTunnelAgentHostSessionsContribution
    → selected Remote Tunnel agentHost endpoint
    → RemoteAgentHostConnection
    → Agent Host Protocol over IRemoteTunnelConnection
    → AgentHostAuthority
```

The routes share the Agent Host Protocol, Host state model, connection
implementation, and `AgentHostSessionsProvider`. They differ only in how the
protocol transport is established and recovered. Neither route is a fallback
for the other.

The Remote Server route is built on the
[Remote foundation](../platform/remote/REMOTE.md). The direct tunnel route is
built on [Remote Tunnel](../platform/tunnel/REMOTE_TUNNEL.md). Agent Host owns
Agent packages, registrations, configuration, Sessions, Chats, Turns, Tools,
content resources, and semantic protocol state. Remote and Remote Tunnel own
their respective reachability and transport lifecycles.

The common Agent, package, Session, Chat, Turn, and protocol semantics remain
authoritative in [Agent Host architecture](AGENT_HOST.md). This document owns
remote placement, the two transport bindings, Remote Server and Remote Tunnel
composition, connection lifecycle, resource direction, and Sessions provider
registration.

## Identities and addresses

Remote Agent Host keeps these identities distinct:

| Identity | Meaning |
|---|---|
| Remote Agent Host address | Discriminated product address selecting exactly one Remote Server or Remote Tunnel route |
| Remote authority | Stable identity of the Remote Server route |
| Remote client ID | Logical product client on a persistent Remote Server management connection |
| Remote transport generation | Physical generation of the Remote Server management connection |
| Tunnel provider, account, tunnel, cluster, and endpoint ID | Stable routing identity of the Remote Tunnel route |
| Tunnel client connection ID | Logical client connection to the selected tunnel endpoint |
| Tunnel transport generation | Physical relay generation of the logical tunnel connection |
| Tunnel operation ID | Idempotent identity of one tunnel record, endpoint, or hosting mutation |
| Agent Host authority | Stable authority returned by Agent Host initialization |
| Agent Host client connection ID | Logical `IAgentHostConnection` across semantic reconnections |
| Sessions provider ID | One provider instance for the initialized Host authority in this application |
| Agent package ID and revision | Exact installation owned by the remote Host |
| Agent ID and runtime registration | Exact Agent behavior activated in the remote Host |
| Session, Chat, Turn, and operation IDs | Canonical state owned by the remote Host |

`RemoteAgentHostAddress` is a closed discriminated value:

- `remoteServer` contains the stable Remote authority and required Agent Host
  channel capability;
- `remoteTunnel` contains the exact provider, account, tunnel, cluster, and
  `agentHost` endpoint identity.

The address selects a route before connection. It is not Host authority. Host
initialization returns the exact `AgentHostAuthority`, and the contribution
binds that authority to the selected address and logical connection. A tunnel
ID never becomes Host authority, Remote authority, or Sessions provider ID.

A reconnect preserves the selected address, Host authority, and Agent Host
client connection. If any of those changes, it is a new connection and cannot
continue the old provider state. A failed Remote Server address is never
rewritten as a Remote Tunnel address, and a failed tunnel is never retried
through a Remote Server authority.

Agent IDs are placement-independent. Agent ID `comet` identifies the same
behavior on local and remote Hosts, while every Host owns separate package,
registration, Session, Chat, Turn, configuration, and credential state.
Installing an Agent on one Host does not install it on another.

Several product clients may connect to one Host authority. Each receives its
own Agent Host client connection and client-owned content and Tool executor
authority. If two selected routes initialize to an already registered Host
authority in one application, provider registration rejects the conflicting
second binding; it does not merge routes or replace the active connection.

## Ownership

### Remote Server foundation

For a `remoteServer` address, the Remote foundation owns:

- Remote authority and exact resolver selection;
- endpoint and Remote Server authentication;
- persistent logical management connection and transport generations;
- bidirectional channel registration and multiplexing;
- Remote Server environment, URI transformation, and resource services;
- management connection state, graceful end, and transport reconnection.

Remote does not inspect Agent Host commands, snapshots, actions, operation
digests, package state, or Turn state. It never reports that an Agent Host
mutation committed merely because a channel frame was delivered.

### Remote Tunnel foundation

For a `remoteTunnel` address, Platform Tunnel owns:

- provider, account, tunnel, cluster, and endpoint identity;
- exact discovery and lookup under one authenticated account;
- endpoint publication and hosting leases;
- provider and relay authentication scopes;
- logical tunnel client connection and relay generations;
- bounded endpoint streams, close, disposal, and transport recovery;
- explicit disconnect and connection-level reconnect suppression.

Remote Tunnel carries Agent Host Protocol frames without interpreting them.
It does not own Host authority, protocol negotiation, Sessions provider state,
semantic replay, content resources, or Tool calls.

### Remote Agent Host protocol connection

`RemoteAgentHostConnection` implements the same `IAgentHostConnection` used by
the local contribution. It consumes one exact `IAgentHostProtocolTransport`:

- `RemoteServerAgentHostTransport` binds to the advertised Agent Host channel
  on `IRemoteServerConnection`;
- `RemoteTunnelAgentHostTransport` binds to the selected `agentHost` endpoint
  stream on `IRemoteTunnelConnection`.

The connection owns:

- endpoint-scoped authentication for every Remote Tunnel transport generation;
- Agent Host initialization and protocol version negotiation;
- Host authority and Agent Host client connection validation;
- common protocol serialization, validation, limits, and errors;
- channel subscriptions, snapshots, and ordered action delivery;
- semantic reconnection after the selected lower transport recovers;
- exact client-owned content-resource and Tool-executor reverse endpoints;
- disposal of protocol, subscription, operation, and reverse-endpoint state.

It does not resolve Remote authorities, enumerate tunnels, acquire provider
authentication sessions, create relay hosts, start another provider
implementation, or interpret Agent-specific state.

### Remote Server Agent Host composition

The Remote Server composes one `AgentHostAuthority` using the shared Platform
Node Host runtime. Server composition supplies:

- Host catalog, package, operation, and normalized history stores;
- package artifact and connected-runtime roots for the server target;
- encrypted credential storage and exact secret authority;
- content materialization and Tool execution services;
- the bundled Comet package and one selected Comet runtime form;
- Agent Host connection and reverse-operation channels;
- Agent Host lifecycle tied to the Remote Server product lifecycle.

The advertised server channel binds directly to
`AgentHostAuthority.createConnection` for the authenticated Remote client
context. It does not translate through another command API, Agent Host
service, WebSocket, or relay. The renderer cannot restart the Host through a
local-process method; supported lifecycle operations use explicit Remote
Server or Agent Host contracts.

### Remote Tunnel Agent Host hosting

An Agent Host-capable product may publish its live `AgentHostAuthority` through
one Remote Tunnel endpoint. Hosting composition:

- obtains one private Agent Host Protocol listener from the Host authority;
- asks `IRemoteTunnelHostService` to publish an `agentHost` endpoint with the
  exact supported Agent Host Protocol revision range;
- requires private authenticated endpoint visibility and rejects any provider
  downgrade to public or anonymous access;
- authenticates a separately provisioned endpoint credential before creating
  the generation-one Agent Host client connection or binding content, Tool,
  and protocol services;
- binds accepted endpoint streams directly to new Agent Host client
  connections;
- owns the exact returned hosting lease and constructs its stop mutation from
  the returned endpoint identity and opaque descriptor revision;
- releases live hosting with the product or explicit stop action, preserving
  the same stop mutation for outcome reconciliation when the provider reports
  `OperationUnknown`;
- retains the live Host and stream binding after any rejected stop until the
  lease has an authoritative stopped state;
- never publishes an active endpoint before both Host and relay are ready.

The endpoint is not a generic port grant. It exposes only the Agent Host
Protocol and grants no Remote filesystem, terminal, process, or management
channel access. Stopping hosting closes or drains endpoint connections and
leaves the endpoint descriptor offline. It does not delete Host Sessions,
uninstall packages, or change Host authority. Endpoint removal and deletion of
the provider-owned tunnel are separate explicit operations.

### Sessions contributions

The provider family has two placement contributions and one shared provider:

- `RemoteServerAgentHostSessionsContribution` watches the selected Remote
  Server connection and its advertised Agent Host capability;
- `RemoteTunnelAgentHostSessionsContribution` discovers compatible
  `agentHost` endpoints, connects the exact user-selected or explicitly
  reconnectable endpoint, and tracks tunnel status;
- both initialize `RemoteAgentHostConnection`, then create the common
  `AgentHostSessionsProvider` and register it through
  `ISessionsProvidersService`.

The tunnel discovery list is connection UX, not the Sessions provider
catalog. A recently used or offline tunnel does not create a placeholder
Sessions provider. A provider is registered only after the transport and Agent
Host initialization both succeed and authoritative snapshots are available.

Both contributions publish client-owned content-resource and canonical Tool
executors through the initialized connection. Neither defines remote-only
Session or Chat models.

## Initialization

### Remote Server route

```text
resolve and connect to the selected Remote Server
    → authenticate and negotiate the Remote management protocol
    → read Remote environment and Agent Host channel capability
    → open the exact Agent Host channel
    → initialize Agent Host Protocol
    → obtain Host authority and Agent Host client connection ID
    → register reverse endpoints and initial subscriptions
    → receive authoritative snapshots
    → create and register AgentHostSessionsProvider
```

An absent or incompatible channel is typed Host unavailability. The
contribution does not create a placeholder provider, connect to the local
Host, or search for a tunnel exposing the same machine.

### Remote Tunnel route

```text
obtain the exact authenticated tunnel account
    → enumerate or look up compatible agentHost endpoints
    → select one exact provider, account, tunnel, cluster, and endpoint
    → establish IRemoteTunnelConnection
    → open the endpoint stream
    → authenticate the separately supplied endpoint credential
    → initialize Agent Host Protocol
    → obtain Host authority and Agent Host client connection ID
    → register reverse endpoints and initial subscriptions
    → receive authoritative snapshots
    → create and register AgentHostSessionsProvider
```

Enumeration and exact lookup are separate user-intent operations, not fallback
stages. Tunnel relay success does not imply Agent Host compatibility. A failed
step disposes all resources created by the attempt and registers no provider.

Remote management, Remote Tunnel relay, Agent Host endpoint authentication,
and Agent Host Protocol handshakes are separate. Compatibility or
authentication in one layer does not imply authority in another. Product,
build, tunnel labels, display names, ports, and Host implementation strings
never substitute for negotiated protocol revisions, endpoint credentials, and
typed capabilities.

## Protocol transport contract

The Agent Host Protocol carries the complete `IAgentHostConnection` surface:

- initialize, reconnect, and subscription operations;
- configuration resolution and completion;
- submission preparation;
- Session, Chat, Turn, and lifecycle mutations;
- package operations and exact outcome reconciliation;
- ordered Host actions and authoritative snapshots;
- client content-resource and canonical Tool executor reverse operations.

Both transport implementations preserve the same bounded ordered messages,
request and operation correlation, cancellation, close, error, and connection
state. Remote transport objects, tunnel provider SDK values, relay addresses,
socket handles, filesystem paths, credentials, and Agent SDK values never
enter Agent Host protocol payloads.

Reverse endpoint registration is bound to the Host authority, Agent Host
client connection ID, lower logical connection ID and generation, and exact
executor or content owner. The Host never invokes an ambient Workbench service
or another client with an equivalent registration.

## Layered reconnection

Each route restores transport before Agent Host restores semantics.

Remote Server route:

```text
management transport is lost
    → IRemoteServerConnection reconnects the same Remote client
    → Agent Host channel reopens on the new Remote generation
    → RemoteAgentHostConnection reconnects the same Agent Host client
    → Host returns complete replay or fresh snapshots
    → provider reconciles operations and reverse endpoints
```

If the Remote Server management transport itself uses a `remoteServer` tunnel
endpoint, its full order is tunnel relay, Remote management, then Agent Host
semantic recovery.

Direct Remote Tunnel route:

```text
relay transport is lost
    → IRemoteTunnelConnection reconnects the same tunnel endpoint
    → endpoint stream reopens on the new tunnel generation
    → endpoint credential reauthenticates that exact generation
    → RemoteAgentHostConnection reconnects the same Agent Host client
    → Host returns complete replay or fresh snapshots
    → provider reconciles operations and reverse endpoints
```

The lower transport never replays Agent Host mutations. Endpoint
authentication never creates, replays, or reconciles Agent Host mutations.
Agent Host never opens another route to recover lower state. Reconnect
preserves the exact selected address, lower logical connection, Host authority,
Agent Host client connection ID, last applied Host sequence, and subscriptions.

If the lower logical connection expires, the Host authority changes, or the
Host no longer recognizes the Agent Host client connection, continuation fails
explicitly. A new explicit connect creates a new connection; it does not
resend uncertain mutations under new operation IDs or take over the old
provider identity.

Explicit tunnel disconnect terminates automatic reconnect for that exact
endpoint until explicit connect. Network-online or application-resume events
may resume only a non-suppressed reconnect loop for the same route.

## Packages, Agents, and credentials

The remote Host owns its package lifecycle and executable target. An explicit
package operation through `IAgentHostConnection` causes that Host to download,
stage, verify, activate, update, uninstall, or purge the package according to
[Agent package architecture](AGENT_PACKAGES.md).

The product client never downloads an archive locally and sends a local path
to the Host. Package manifests are checked against the Host machine's
operating system, architecture, policy, and storage roots. Installed and
activated state is authoritative only on that Host.

Product-maintained SDK packages activate direct `IAgent` implementations on
the Host machine. Genuinely external Agent packages run as connected processes
under the exact package sandbox and authority and connect through
`IAgentRuntimeConnection`, not through Remote management or Remote Tunnel.

Remote Server credentials, tunnel provider management and relay credentials,
Agent Host endpoint credentials, runtime registration credentials, Agent
authentication, model-provider credentials, and typed secret references are
separate scopes. A tunnel ID is never converted into a credential. Raw
model-provider secrets resolve only under the accepted Turn authority and
never cross to the product client.

## Resources and filesystem authority

Resource meaning depends on the selected address without changing Agent Host
content contracts.

| Resource owner | Route and read behavior |
|---|---|
| Remote Server filesystem | `remoteServer` resources retain their Remote authority and use Remote resource services |
| Agent Host | Either route reads exact Host-owned content through the Agent Host content service |
| Originating product client | Either route sends a bounded reverse content-resource request to that exact Agent Host client connection |

A direct `remoteTunnel` address grants no generic filesystem authority. The
tunnel ID does not create a Remote URI scheme, and a Host-local path does not
cross the Agent Host protocol. If a tunnel-hosted Agent needs content, the
content must already be Host-owned or be supplied through the exact client
content-resource contract.

Client-owned content is not copied merely because the Host is remote. Host
acceptance validates whether its declared lifetime supports background
execution. If the originating client or immutable version is unavailable, the
read fails; the Host does not search another client, Remote filesystem, or
local path for matching text.

Directory attachments remain immutable bounded tree manifests. A Remote
workspace or tunnel connection is not a recursive attachment grant. Complete
content rules are defined in [Attachment architecture](ATTACHMENTS.md).

## Tools and client executors

Remote Host Tools use the same canonical registrations and Turn-bound Tool
sets as local Host Tools. Execution location remains independent from route:

- `host` executes in the remote Agent Host;
- `agent` executes in the addressed Agent runtime;
- `mcp` executes through the exact MCP registration owned by the Host;
- `client` executes through the reverse endpoint on the exact originating
  product client.

A route does not convert client Tools to Host Tools or expose filesystem
operations implicitly. SDK and model-provider conversion remains inside the
addressed Agent runtime. Disconnect and effect reconciliation use the exact
Tool call and operation identities defined in [Tool architecture](TOOLS.md).

Interaction targets retain exact owner, authority, and version. A target owned
by one client cannot be invoked through another client or replacement
connection. See [Interaction target architecture](INTERACTION_TARGETS.md).

## State and lifecycle

| State | Owner |
|---|---|
| Remote authority, Remote client, and management generation | Remote foundation and Remote Server route |
| Tunnel identity, recent selection, mutation outcomes, hosting lease, logical connection, and relay generation | Remote Tunnel foundation and tunnel contribution |
| Host authority, packages, registrations, catalogs, history, and operation outcomes | remote Agent Host |
| Agent-native resume data and private history | addressed Agent runtime |
| submitted references, targets, Tool sets, Turns, and Host materializations | remote Agent Host |
| client pending composer state, content leases, and Tool executors | exact originating product client and Host connection |

Closing the application disposes its providers and client connections but does
not delete remote Sessions, uninstall packages, or delete provider tunnel
records. Stopping tunnel hosting removes its live reachability according to
the hosting contract without deleting Agent Host state. Deletion, uninstall,
Agent-data deletion, retained-record purge, and tunnel deletion remain
separate explicit operations.

Before Host shutdown, the product stops accepting new Agent Host operations,
records or resolves accepted mutations, checkpoints or releases runtime
backing as required, closes logical client connections, stops active tunnel
hosting leases, and disposes Host resources. It never reports accepted work as
cancelled solely because one product client disconnected.

## Module layout

```text
src/cs/platform/remote/
└── common|browser|electron-browser|node/
    Remote authority, management connection, channel, URI, and server primitives

src/cs/platform/tunnel/
└── common|browser|electron-browser|electron-utility|node/
    Remote Tunnel discovery, hosting, relay, connection, forwarding, and proxy

src/cs/workbench/services/remote/
└── common|browser|electron-browser/
    selected Remote Server service, environment, and resource wiring

src/cs/platform/agentHost/
├── common/                 IAgentHostConnection, protocol, transport,
│                            address, and hosting contracts
├── browser/                RemoteAgentHostConnection plus Remote Server and
│                            Remote Tunnel protocol transports
├── electron-browser/       desktop local Host and tunnel IPC composition
└── node/                   AgentHostAuthority, runtime services, private
                             protocol listener, and tunnel hosting binding

src/cs/server/node/agentHost/
├── remoteAgentHostMain.ts  Remote Server Host composition and lifetime
├── remoteTunnelAgentHostMain.ts
│                            Remote Tunnel Host composition and lifetime
├── remoteAgentHostChannel.ts
│                            direct Remote channel binding to AgentHostAuthority
└── remoteAgentHostEndpointCredentialAuthority.ts
                             exact tunnel endpoint credential verifier

src/cs/sessions/contrib/providers/agentHost/
├── browser/                shared AgentHostSessionsProvider, Remote Server
│                            contribution, tunnel discovery and contribution
└── electron-browser/       local Host and desktop tunnel composition
```

Platform Agent Host and Platform Tunnel import neither Workbench nor Sessions.
The higher Sessions contributions obtain authenticated lower connections from
their owning product services, initialize the common Agent Host connection,
and own provider composition.

## Product composition

Remote Server route startup order:

1. Remote Platform and selected authority transport;
2. `IRemoteServerService` and Remote resource services;
3. Remote Server connection and environment negotiation;
4. common Sessions services;
5. Remote Server Agent Host contribution;
6. Sessions shell.

Remote Tunnel client startup order:

1. Platform Tunnel provider and authentication integration;
2. exact Agent Host endpoint credential authority;
3. common Sessions services;
4. Remote Tunnel discovery and Agent Host contribution;
5. Sessions shell.

Tunnel hosting starts only after Platform Agent Host and the private protocol
listener are live. Remote Server advertises its channel only after its Host
composition is live. An advertised capability or active endpoint always has
an owning implementation. Tunnel Host shutdown stops the exact returned lease,
disposes its stream binding and Host service, and then closes the Host
authority. An unknown stop outcome retains the live composition and exact stop
mutation until that outcome is reconciled. Any other rejected stop likewise
retains the live composition until the lease authoritatively reports stopped.

## Verification

Remote Agent Host conformance covers:

- discriminated Remote Server and Remote Tunnel address validation;
- exact Remote authority or
  provider/account/tunnel/cluster/endpoint-to-Host-authority binding;
- one common protocol and provider across local, Remote Server, and Remote
  Tunnel connections;
- structured capability and protocol revision negotiation;
- per-generation endpoint authentication before Host materialization or peer
  attachment, with credential isolation, rejection, timeout, and expiry;
- tunnel discovery, exact lookup, hosting, explicit disconnect, and status
  without placeholder provider registration;
- tunnel mutation conflict, lost acknowledgement, and outcome reconciliation;
- snapshots, contiguous actions, replay, fresh snapshot recovery, and gaps;
- Remote management or tunnel relay recovery followed by Agent Host semantic
  recovery in the required order;
- lost submission and package-operation acknowledgements;
- multiple logical clients and exact reverse-endpoint ownership;
- Remote filesystem, tunnel Host content, and client content separation;
- canonical client Tool execution, disconnect, cancellation, progress,
  terminal results, and effect reconciliation;
- remote package lifecycle and credential isolation;
- disposal, Host shutdown, tunnel hosting stop, active Turn handling, and
  resource cleanup;
- absence of route switching, local Host, alternate authority, alternate
  tunnel, alternate client, path, Tool, package, runtime, or credential
  fallback.

## Invariants

- Remote Server and Remote Tunnel are explicit peer routes to the same Agent
  Host Protocol; neither is fallback for the other.
- Remote authority, Remote client, Remote generation, tunnel provider,
  account, tunnel, cluster, endpoint, tunnel client, tunnel generation, Host
  authority, Agent Host client connection, Sessions provider, package, Agent,
  Session, Chat, Turn, tunnel operation, and Agent Host operation identities
  remain separate.
- One initialized `IAgentHostConnection` creates one common
  `AgentHostSessionsProvider` for its Host authority.
- Local, Remote Server, and Remote Tunnel connections expose identical Agent
  Host semantics.
- The selected lower foundation restores transport; Agent Host restores
  semantic state.
- Remote Server channels and tunnel endpoints bind directly to Platform Agent
  Host ownership and introduce no second Agent API or parallel command path.
- A direct Agent Host tunnel grants no Remote Server or filesystem authority.
- Remote packages, runtimes, storage, materializations, and credentials remain
  owned by the remote Host.
- Client content and Tool executors remain bound to the exact originating
  logical client and connection generation.
- Transport authentication grants no Agent, Tool, package, model, resource, or
  mutation permission by itself.
- Missing or incompatible authorities, tunnels, endpoints, capabilities,
  versions, Hosts, resources, executors, credentials, and operation outcomes
  fail explicitly.
- No remote Agent Host failure falls back to the local Host, switches between
  Remote Server and Remote Tunnel, selects another authority or tunnel, or
  substitutes another client, Agent, runtime, package, resource, or credential.
