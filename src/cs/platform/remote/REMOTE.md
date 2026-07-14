# Remote foundation architecture

## Overview

The Remote foundation connects one Comet application instance to one addressed
Comet Remote Server. It owns remote authority resolution, authenticated
management transport, one persistent logical management connection,
bidirectional channel multiplexing, remote environment discovery, and remote
resource identity.

```text
Comet application
    → selected RemoteAuthority
    → IRemoteAuthorityResolverService
    → IRemoteServerService
    → IRemoteServerConnection
    → persistent management transport
    → Comet Remote Server
        ├── remote environment and resource services
        ├── remote filesystem and process services
        └── contributed typed channels
```

Remote is infrastructure, not an Agent integration. In Comet terminology an
Agent is a reasoning runtime registered with Agent Host. The remote process
that accepts the management connection is therefore called the Remote Server,
not a remote Agent.

The [Remote Tunnel architecture](../tunnel/REMOTE_TUNNEL.md) is the sibling
reachability foundation for discoverable relay-hosted service endpoints. A
Remote authority resolver may select a Remote Tunnel `remoteServer` endpoint
as its exact management transport. A Remote Tunnel may also expose an
`agentHost` endpoint directly; that route does not create an
`IRemoteServerConnection`.

The [Remote Agent Host architecture](../../sessions/REMOTE_AGENT_HOST.md) uses
either one typed channel on this Remote Server foundation or one direct Agent
Host endpoint on the Remote Tunnel foundation. Remote and Remote Tunnel own
their respective transport lifecycles; Agent Host does not duplicate either.

## Identities

The Remote foundation keeps these identities distinct:

| Identity | Meaning | Owner |
|---|---|---|
| Remote authority | Stable user- and product-facing identity of one Remote Server placement | application configuration and authority resolver |
| Authority resolver ID | Exact resolver registered for one remote authority kind | Remote Platform registry |
| Resolved endpoint | One transport endpoint and short-lived connection authority for the remote authority | addressed resolver |
| Remote client ID | Stable logical application client across transport reconnections | Remote management protocol |
| Connection generation | One physical transport generation of the logical remote client | Remote transport |
| Remote Server instance ID | Exact running server instance accepted by the handshake | Remote Server |
| Channel name | Stable protocol route within one management connection | owning subsystem |
| Remote resource URI | Authority-qualified identity of a resource owned by the Remote Server | Remote resource owner |

A Remote authority is not a hostname, socket address, tunnel ID, filesystem
path, Agent Host authority, Agent ID, Session ID, or credential. The authority
resolver may change the endpoint used to reach an authority without changing
the authority itself.

Transport generation is never application identity. Reconnecting a logical
client changes its generation while preserving the client ID. Opening another
application instance creates another logical client even when it addresses the
same Remote authority.

## Ownership

### Remote Platform

`cs/platform/remote` owns the environment-neutral Remote contracts and
transport mechanics:

- Remote authority validation, parsing, and resolver registration;
- exact authority-to-endpoint resolution;
- transport authentication and initial protocol negotiation;
- persistent logical connection identity and transport generations;
- bounded framing, flow control, keepalive, and graceful disconnect;
- bidirectional typed channel registration and multiplexing;
- connection-state events and reconnection coordination;
- Remote resource URI transformation and canonicalization contracts;
- typed Remote errors and bounded diagnostics.

Platform Remote imports neither Workbench, Sessions, Agent Host, nor Code. It
does not know which application Feature owns a channel.

### Workbench Remote service

`IRemoteServerService` is the application-facing owner of the selected Remote
authority and its one persistent `IRemoteServerConnection`. It lives under
`cs/workbench/services/remote` because it binds the lower Platform connection
to application environment, profile, lifecycle, and service registration.

It owns:

- creating the connection for the exact selected Remote authority;
- exposing the connected Remote Server environment and capabilities;
- making the shared channel multiplexer available to higher layers;
- registering client-owned reverse channels;
- publishing authoritative connection state;
- ending and disposing the logical connection with the application.

The service does not interpret subsystem channel messages, mirror their state,
or decide whether an Agent Host Session, Editor, terminal, or filesystem
operation should be retried.

An application instance with no selected Remote authority has no
`IRemoteServerConnection`. A consumer that requires Remote execution validates
that requirement explicitly. It does not receive a local connection from the
Remote service.

### Remote Server

`cs/server` owns the Remote Server application and Node composition:

- authenticating the management connection and establishing its context;
- negotiating Remote protocol version and server capabilities;
- registering the exact server-side channel set;
- owning remote filesystem, process, storage, logging, and lifecycle services;
- applying URI transformation at the client/server boundary;
- retaining logical clients during the declared reconnection grace period;
- disposing every client-owned channel and resource when its logical client
  ends.

The Remote Server does not implement Workbench or Sessions presentation. A
server channel delegates directly to the lower subsystem that owns its
semantics.

### Feature and subsystem consumers

A Remote Server consumer owns its channel name, request and response values,
state model, and semantic recovery. It receives an
`IRemoteServerConnection` from the Remote service and never opens a second
management socket, resolves the authority again, or creates a private Remote
Server lifecycle.

Examples include remote filesystem, terminal, and the Remote Server Agent Host
connection. The Remote foundation provides transport and channel continuity
only. Each subsystem remains authoritative for its own protocol state and
operations. A direct Remote Tunnel Agent Host is a consumer of Platform Tunnel,
not an `IRemoteServerConnection` consumer.

## Authority resolution

One exact registered resolver handles one Remote authority kind. Resolution
accepts the stable authority and returns:

- the exact endpoint kind and address required by the transport;
- a short-lived connection credential or typed reference when required;
- canonical authority metadata and trust state;
- transport and server constraints needed before connection.

Resolver selection is by the declared authority kind, never by trying
resolvers in sequence. Missing, duplicate, malformed, denied, or incompatible
resolution fails with a typed Remote error. The caller does not reinterpret
that failure as a local target or try another transport.

SSH, WSL, WebSocket endpoints, and later management transports are resolver
and socket implementations below the same Remote connection contract. A
tunnel-backed resolver obtains the exact `remoteServer` endpoint through the
Remote Tunnel contracts; it does not implement tunnel discovery, hosting, or
relay authentication inside Platform Remote. A higher-layer Remote consumer
never parses transport address syntax or owns its authentication prompts.

Resolution data is bounded and immutable for one connection attempt. Endpoint
changes require a new resolution and transport generation under the same
logical client. Raw connection credentials are not written to application
configuration, resource URIs, logs, or channel payloads.

## Remote Tunnel reachability

Remote Tunnel is first-class Remote infrastructure, not a synonym for the
Remote management connection. It owns provider, account, tunnel, cluster,
endpoint, hosting-lease, relay-connection, and transport-generation identity.
Platform Remote consumes it only when an authority resolver declares a
tunnel-backed `remoteServer` endpoint.

```text
Remote authority
    → exact tunnel-backed authority resolver
    → provider + account + tunnel + cluster + remoteServer endpoint
    → IRemoteTunnelConnection
    → Remote management handshake
    → IRemoteServerConnection
```

The Remote authority remains the stable resource and application identity.
Tunnel identity is transport routing data and never enters Remote resource
URIs or consumer channel payloads. Tunnel relay recovery occurs before Remote
management recovery; the Remote protocol then reconnects the same logical
Remote client and its consumers perform their own semantic recovery.

Remote Tunnel also permits service owners to publish other typed endpoints.
An `agentHost` endpoint carries the common Agent Host Protocol directly and is
consumed without a Remote authority, Remote Server, or management channel.
Remote management failure never switches to that endpoint, and direct Agent
Host tunnel failure never constructs a Remote Server route.

Discovery, endpoint publication, authentication scopes, hosting, explicit
disconnect, reconnect, port-forwarding separation, and security are defined in
[Remote Tunnel architecture](../tunnel/REMOTE_TUNNEL.md).

## Connection and handshake

The Remote management handshake authenticates the product client and selects
one Remote protocol version before normal channel traffic. It binds:

- Remote authority and Remote Server instance;
- stable Remote client ID and new transport generation;
- exact product and Remote protocol versions;
- client and server capabilities;
- locale, profile, and URI transformation context;
- transport limits and reconnection policy.

Product and build strings are informational. Behavior is gated by the selected
protocol version and explicit capabilities. An incompatible version, product
commit, server target, or capability fails the connection; the client never
parses implementation strings to choose another dialect.

Remote transport authentication authorizes the connection to the Remote
Server. It does not authenticate an Agent runtime, model provider, Agent
package, Session, Tool call, or filesystem mutation. Each contributed channel
performs its own authorization within the established remote client context.

## Persistent management connection

One logical management connection carries all Remote channels for the
application instance. It provides:

- ordered bounded frames per channel operation;
- request, response, event, cancellation, and disposal correlation;
- independent channel namespaces without semantic message inspection;
- backpressure and per-connection resource limits;
- graceful end and bounded drain;
- reconnection of the same logical client within the negotiated grace period.

Consumers do not open parallel management connections for individual
subsystems. A long-lived filesystem watch, terminal, or Agent Host
subscription is owned by its channel implementation and does not become a
transport-level special case.

### Bidirectional channels

The Remote Server registers server-owned channels that the client can call.
The client may register reverse channels for operations whose implementation
remains in the application process. A reverse call is still scoped to the same
Remote authority, logical client, channel, operation, and generation.

Channel registration is exact. Duplicate registration, a missing required
channel, an unknown required command, or an invalid message fails explicitly.
The channel router does not redirect an operation to another channel or
reinterpret an unknown request.

## Reconnection and semantic recovery

Transport reconnection and subsystem recovery are separate layers:

```text
physical transport loss
    → Remote foundation reconnects the same Remote client
    → channel transport becomes available at a new generation
    → each stateful subsystem runs its own protocol recovery
    → authoritative subsystem state resumes
```

The Remote foundation preserves framing and logical client identity within the
negotiated grace period. It does not claim that a request committed, replay a
subsystem mutation under a new identity, or synthesize missing subsystem
events.

After reconnection, each stateful channel reconciles with its own durable
sequence, subscription, operation, and digest contracts. If the Remote Server
cannot retain the logical client, the next connection is a new client and
subsystems perform their explicit cold-start or unavailable behavior. They do
not treat the new client as a continuation merely because the Remote authority
is the same.

## Remote resources

A Remote resource URI contains the stable Remote authority and the identity
understood by the Remote Server resource owner. It is not a client-local path.
URI transformation occurs exactly at the client/server serialization boundary
and preserves scheme, authority, path, query, and fragment semantics.

The Remote filesystem service registers one provider for the Remote resource
scheme and delegates operations to the exact server channel. Equality and
containment use the shared URI identity services with the Remote Server's path
case policy. A consumer never converts a Remote resource to a local `file`
resource because both happen to contain the same path text.

Remote environment state publishes the bounded server values required by
consumers, including operating system, architecture, user and temporary roots,
storage roots, path policy, and advertised service capabilities. Consumers do
not infer these values from the authority string or the local machine.

## Lifecycle and failure

The application owns `IRemoteServerService`; the service owns its connection;
the connection owns its transport, channel registrations, listeners, and
reconnection state. The Remote Server owns one context and resource store per
logical client.

```text
application starts with Remote authority
    → resolve and authenticate
    → establish management connection
    → obtain environment and capabilities
    → register required client channels
    → higher-layer contributions connect

application ends or explicitly disconnects
    → stop accepting new channel work
    → cancel or reconcile owned operations by their contracts
    → drain the management connection
    → dispose client and server connection resources
```

Unexpected transport loss enters reconnecting state. Protocol violation,
authentication rejection, expired reconnection state, or explicit disconnect
is terminal for that logical connection. A terminal Remote failure never
selects a local endpoint, another Remote authority, or an Agent-specific
transport.

## Security and privacy

- Resolver and transport credentials are scoped to the Remote connection and
  never become general environment variables or channel data.
- Remote Server connection identity is authenticated before channels execute.
- Every channel validates its own request values, resource ownership,
  permissions, limits, and cancellation.
- Remote resource paths and metadata are untrusted input at the client
  boundary.
- Logs contain bounded identities and typed failures, not credentials,
  unrestricted file content, Chat transcripts, or Agent attachment bodies.
- A client reverse channel grants only its registered operations; it does not
  expose ambient Workbench services to the Remote Server.

## Module layout

```text
src/cs/platform/remote/
├── common/              authorities, resolver and connection contracts,
│                         protocol values, channel context, URI transformation,
│                         transport state, versions, limits, and errors
├── browser/             browser socket and authority-resolution support
├── electron-browser/    desktop-managed management socket support
└── node/                shared Remote Server transport primitives

src/cs/platform/tunnel/
├── common/              Remote Tunnel provider, descriptor, endpoint,
│                         hosting, connection, port-forwarding, proxy,
│                         state, limit, and error contracts
├── browser/             browser-provided discovery and relay support
├── electron-browser/    renderer-facing tunnel composition
├── electron-utility/    desktop provider SDK and relay ownership
└── node/                shared relay, hosting, and forwarding primitives

src/cs/workbench/services/remote/
├── common/              IRemoteServerService and environment contracts
├── browser/             application connection and remote-resource wiring
└── electron-browser/    desktop Remote service composition

src/cs/server/
├── common/              Remote Server product values
└── node/                server bootstrap, handshake, channel registry,
                          filesystem, process, storage, and lifecycle composition
```

Remote subsystem implementations live with their owners. Agent Host protocol
code remains under `cs/platform/agentHost`; its Remote Server composition lives
under `cs/server/node/agentHost`; and its Sessions provider contribution lives
under `cs/sessions/contrib/providers/agentHost`.

## Adding a Remote transport

1. Define one exact Remote authority kind and resolver registration.
2. Implement the common socket contract and authenticated management
   handshake for that endpoint kind. A relay-hosted transport uses the Remote
   Tunnel contracts and an exact `remoteServer` endpoint.
3. Preserve Remote client identity, generation, framing, limits, channel
   multiplexing, graceful end, and reconnection semantics.
4. Add authority, transport, handshake, disconnect, reconnect, cancellation,
   flow-control, URI, and channel-isolation tests.
5. Keep transport parsing and credentials below `IRemoteServerConnection`;
   keep tunnel discovery, hosting, relay, and endpoint identity in Platform
   Tunnel.
6. Do not add consumer-specific sockets, retry another resolver, or route a
   failure to the local application.

## Verification

Remote conformance covers:

- exact resolver selection and malformed or duplicate authority rejection;
- exact tunnel-backed authority-to-endpoint binding, when selected, without
  exposing tunnel identity to Remote consumers;
- authentication, version negotiation, capability validation, and limits;
- initial connection, graceful end, abrupt loss, reconnection, grace expiry,
  and new logical-client establishment;
- channel request, response, event, cancellation, disposal, and isolation;
- bidirectional channel registration and logical-client ownership;
- URI round trip, canonicalization, path case, and local/remote separation;
- server resource cleanup and observer-failure isolation;
- absence of local, alternate-authority, alternate-resolver, or
  consumer-specific transport fallback.

## Invariants

- Remote authority, endpoint, logical client, transport generation, Remote
  Server instance, channel, and resource identity remain separate.
- One application instance uses one persistent management connection for its
  selected Remote authority.
- One exact resolver handles an authority kind; resolution never tries another
  resolver after failure.
- A tunnel-backed Remote authority uses one exact `remoteServer` endpoint;
  Remote Tunnel identity never replaces Remote authority.
- The Remote foundation owns transport continuity, not subsystem semantics.
- Every stateful subsystem performs its own recovery after transport
  reconnection.
- Remote resources never masquerade as client-local paths.
- Bidirectional channels expose exact registered operations, not ambient
  services.
- Remote transport authentication grants no Agent, Tool, package, model, or
  resource permission by itself.
- Missing authorities, endpoints, versions, capabilities, channels, resources,
  and permissions fail explicitly.
- No Remote failure falls back to a local endpoint, another Remote authority,
  another resolver, another transport kind, a direct Agent Host tunnel, or a
  subsystem-private connection.
