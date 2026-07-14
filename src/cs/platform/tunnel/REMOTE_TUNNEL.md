# Remote Tunnel architecture

## Overview

Remote Tunnel gives a Comet service on one machine a stable, authenticated
relay address that another Comet application can discover and connect to
without exposing the service on a public network interface.

```text
hosting machine                                      client application
┌──────────────────────────────┐                    ┌─────────────────────────┐
│ service endpoint             │                    │ tunnel contribution     │
│   ├── Remote Server          │                    │   → discover descriptor │
│   └── Agent Host Protocol    │                    │   → select endpoint     │
│            ↓                 │                    │   → connect relay       │
│ IRemoteTunnelHostService     │                    │            ↓            │
│   → publish endpoint         │                    │ IRemoteTunnelConnection │
│   → hold hosting lease       │                    │            ↓            │
└──────────────┬───────────────┘                    └────────────┬────────────┘
               └──────── authenticated relay provider ─────────┘
```

Remote Tunnel owns reachability. It does not own Remote Server channel
semantics, Agent Host state, Sessions providers, filesystem meaning, or a
service-specific protocol. A tunnel endpoint carries the exact protocol
declared by its endpoint descriptor.

The [Remote foundation](../remote/REMOTE.md) may use a Remote Tunnel endpoint
as the transport for a selected Remote authority. The
[Remote Agent Host architecture](../../sessions/REMOTE_AGENT_HOST.md) may use
an Agent Host endpoint directly, without first creating a Remote Server
management connection. These are separate consumers of the same tunnel
foundation.

## Remote Tunnel and port forwarding

Remote Tunnel is distinct from port forwarding even though both live under
`cs/platform/tunnel`:

| Facility | Purpose | Stable identity |
|---|---|---|
| Remote Tunnel | Publish and discover authenticated product service endpoints through a relay | provider, tunnel, cluster, and endpoint identity |
| Port forwarding tunnel | Make one remote `host:port` reachable at one local address for an already connected Remote target | remote authority, remote address, and forwarding lease |
| Tunnel proxy | Supply an authenticated proxy address and certificate identity to a transport owner | proxy endpoint and credential reference |

A port-forwarding request never discovers or selects a Remote Tunnel. A
Remote Tunnel endpoint never grants general access to every port on its host.
Tunnel proxy metadata is transport input and does not become tunnel, Remote,
or Agent Host identity.

## Identities

Remote Tunnel keeps these identities distinct:

| Identity | Meaning |
|---|---|
| Tunnel provider ID | Exact relay provider implementation and account namespace |
| Tunnel ID | Stable provider-owned identity of one tunnel record |
| Cluster ID | Exact provider region or relay cluster containing the tunnel |
| Tunnel endpoint ID | Stable identity of one published service endpoint on the tunnel |
| Endpoint kind | Protocol purpose, such as `remoteServer` or `agentHost` |
| Endpoint protocol revision | Exact application protocol revision range advertised for the endpoint |
| Hosting lease ID | One live host attachment that publishes an endpoint |
| Tunnel client connection ID | One logical client connection to one endpoint |
| Tunnel transport generation | One physical relay generation for the logical client connection |
| Credential reference | Exact provider, account, scopes, and secret reference used for one operation |

Tunnel ID is not a Remote authority, hostname, filesystem authority, Agent
Host authority, Agent ID, Sessions provider ID, connection token, or secret.
Cluster ID is part of tunnel routing and must not be guessed from a tunnel
name. Display names and labels are presentation metadata and do not select an
endpoint protocol or compatibility revision.

One tunnel may publish several explicitly declared endpoints. An endpoint is
addressed by `(providerId, tunnelId, clusterId, endpointId)`. Consumers do not
select a service by scanning labels, trying well-known ports, or interpreting
the tunnel display name.

## Ownership

### Platform Tunnel

`cs/platform/tunnel` owns:

- Remote Tunnel provider registration and exact provider selection;
- typed tunnel, endpoint, hosting-lease, and connection identities;
- tunnel discovery and exact lookup;
- provider authentication inputs and scope validation;
- tunnel creation, endpoint publication, update, and explicit deletion;
- relay host and client connection establishment;
- bounded bidirectional endpoint streams;
- connection state, transport generations, reconnect scheduling, and
  explicit-disconnect suppression;
- port-forwarding contracts and their independent forwarding leases;
- tunnel proxy contracts and certificate identity;
- typed failures, limits, redacted diagnostics, and disposal.

Platform Tunnel imports neither Workbench, Sessions, Agent Host, Remote
Workbench services, nor Code. It carries endpoint bytes or messages without
interpreting their service protocol.

### Endpoint owner

The endpoint owner supplies:

- one private local endpoint or server-side stream acceptor;
- endpoint kind and exact protocol revision range;
- capability metadata required before connection;
- endpoint-specific authentication after relay connection when required;
- service lifecycle, semantic recovery, and authorization;
- the decision to publish or stop publishing the endpoint.

Remote Server owns a `remoteServer` endpoint. Platform Agent Host owns an
`agentHost` endpoint. Neither endpoint owner creates a tunnel provider client,
parses relay addresses, persists provider credentials, or implements relay
reconnection.

### Product contributions

Product contributions own user intent and application composition:

- acquiring an authenticated provider session through the product's
  authentication service;
- asking Platform Tunnel to enumerate or look up tunnels for that exact
  account;
- presenting descriptors and status;
- selecting one exact tunnel endpoint;
- creating the service-specific connection over the returned tunnel
  connection;
- remembering recently selected tunnel identities and explicit disconnect
  intent.

Contributions persist no raw provider access token. A cached tunnel identity
is discovery input, not proof that the tunnel exists, is online, is compatible,
or remains authorized.

## Descriptor and endpoint contract

A discovered descriptor contains bounded typed values:

- provider, tunnel, and cluster identity;
- display name and optional presentation labels;
- ownership and visibility metadata safe for presentation;
- current host availability;
- a list of published endpoints;
- each endpoint's stable ID, kind, protocol revision range, connection scope,
  and status;
- provider revision or entity tag used for conditional updates.

Protocol compatibility is declared by structured endpoint fields. A consumer
does not derive a protocol version from labels or accept an unversioned
endpoint because its name resembles a supported service.

Host availability is observation, not identity. Zero active hosts makes the
endpoint offline; it does not delete the tunnel record or authorize a client
to connect to another endpoint. Several host connections for an endpoint are
valid only when the endpoint owner explicitly declares multi-host routing and
its identity semantics. Agent Host endpoints allow one active Host authority
per endpoint.

## Discovery and selection

Discovery is scoped to one exact provider account and requested endpoint kind.
The tunnel service supports two explicit operations:

1. enumerate visible tunnels for the authenticated account; and
2. look up one exact provider tunnel identity supplied by the user or cache.

These operations are not fallback stages. Failure to enumerate does not cause
the service to probe cached names, and failure to look up an exact tunnel does
not select a similarly named result. Duplicate tunnel IDs, cluster mismatch,
missing endpoints, incompatible protocol revisions, denied scopes, and
malformed descriptors fail explicitly.

Recently used tunnel records contain only typed tunnel identity, endpoint ID,
display data, and the authentication provider ID needed to request the right
account. Removing a recent record removes application history, not the
provider-owned tunnel. Deleting a tunnel is a separate explicit provider
operation.

An explicit user disconnect marks that exact endpoint as not eligible for
automatic reconnect. A later explicit connect clears the marker. Discovery
status refresh never clears user disconnect intent.

## Hosting lifecycle

Hosting begins only from an explicit product or server composition that owns a
live service endpoint:

```text
obtain exact provider credential and scopes
    → create or resolve the exact tunnel record
    → publish the typed endpoint descriptor
    → attach the private service endpoint
    → establish the relay host connection
    → commit the hosting lease as active
    → accept authenticated endpoint connections
```

Creation and reuse are separate commands. A create request never adopts a
same-named tunnel. A reuse request requires the exact provider, tunnel, and
cluster identity and validates ownership before changing endpoint metadata.

Endpoint publication and relay-host attachment commit as one hosting
operation. If publication succeeds but attachment fails, the operation removes
the unpublished generation or records the endpoint offline; it never reports
active hosting. Hosting state becomes visible only after the relay accepts the
host connection for the exact endpoint.

Stopping hosting:

1. stops accepting new endpoint connections;
2. drains or closes active connections according to the endpoint contract;
3. releases the hosting lease;
4. marks or removes the published endpoint according to its durable policy;
5. disposes relay, provider, listener, and credential resources.

Stopping a hosting lease does not delete the provider tunnel record. Tunnel
deletion is explicit, validates that no protected endpoint or hosting lease is
active, and returns an idempotent terminal outcome.

## Client connection lifecycle

Connecting addresses one exact descriptor and endpoint:

```text
validate descriptor identity, endpoint kind, and protocol revision
    → obtain an endpoint-scoped provider credential
    → resolve current relay endpoints for the declared cluster
    → establish one logical tunnel client connection
    → open the exact published endpoint stream
    → hand the stream to its service-protocol owner
```

The returned `IRemoteTunnelConnection` exposes logical connection identity,
transport generation, connection state, bounded send and receive, graceful
close, and terminal failure. It does not expose provider SDK objects or raw
access tokens.

Opening the relay and initializing the service protocol are separate steps.
Relay success does not prove that a Remote Server or Agent Host handshake
succeeded. If service initialization fails, the owner closes the tunnel
connection and publishes no partial service or Sessions provider.

One connection attempt has bounded timeouts for provider lookup, relay
attachment, endpoint availability, stream opening, and service initialization.
Timeout identifies the exact step and disposes all resources created by that
attempt.

## Reconnection

Remote Tunnel restores only the selected endpoint transport:

```text
relay transport is lost
    → retain the logical tunnel client connection during its grace period
    → reconnect the same provider, tunnel, cluster, and endpoint
    → create a new tunnel transport generation
    → notify the endpoint protocol owner
    → endpoint owner performs semantic reconnect or fresh initialization
```

Reconnect uses bounded exponential backoff and pauses after its declared
attempt or time budget. Network-online, application-resume, and explicit user
connect events may resume the same route. An explicit disconnect terminates
the loop and remains suppressed until explicit connect.

Reconnect never changes provider, account, tunnel ID, cluster, endpoint ID,
endpoint kind, or Host authority. If the provider record was deleted, the
endpoint disappeared, authentication was revoked, or the logical connection
grace period expired, the connection becomes terminal. A new explicit connect
creates a new logical tunnel connection and service-protocol connection.

Tunnel reconnection does not replay Remote management requests or Agent Host
mutations. The Remote foundation and Agent Host protocol each reconcile their
own state after the tunnel becomes available.

## Authentication and security

Remote Tunnel separates these scopes:

| Scope | Authorizes |
|---|---|
| Provider management | enumerate, read, create, update, or delete tunnel records |
| Host relay | publish and accept connections for one endpoint |
| Client relay | connect to one published endpoint |
| Endpoint protocol | use the Remote Server or Agent Host service after relay connection |

The product requests the minimum scope for the operation. A provider access
token is never stored in configuration, recent-tunnel records, endpoint
descriptors, logs, URIs, Agent Host snapshots, or Remote channel payloads.
Secrets remain in the authentication or secret service and enter Platform
Tunnel as short-lived credential references or guarded values.

Tunnel identity is public routing data, not a secret. Endpoint protocol
credentials are random, endpoint-scoped values or authenticated channel
context; they are never derived from tunnel ID, cluster ID, display name, or
labels. Relay authentication does not grant Agent package, model credential,
Tool, filesystem, Session, Chat, or Turn permission.

Endpoint streams validate framing, maximum message and queue sizes, malformed
input thresholds, cancellation, and close. Logs contain bounded tunnel and
endpoint identities, state transitions, durations, and typed error categories,
not tokens, unrestricted payloads, Chat content, attachment bodies, or Tool
results.

## Remote Agent Host endpoint

An `agentHost` endpoint exposes the common Agent Host Protocol directly:

```text
AgentHostAuthority
    → private Agent Host Protocol listener
    → Remote Tunnel host endpoint(kind = agentHost)
    → authenticated relay
    → IRemoteTunnelConnection
    → RemoteAgentHostConnection
    → AgentHostSessionsProvider
```

The endpoint descriptor advertises the supported Agent Host Protocol revision
range. After the relay stream opens, `RemoteAgentHostConnection` performs the
ordinary Agent Host initialization, obtains the authoritative Host authority
and logical Agent Host client connection ID, subscribes to snapshots, and only
then creates the shared Sessions provider.

Tunnel ID is not Host authority. Recently used tunnels do not create offline
placeholder Hosts. Several Comet clients may connect to one endpoint, but each
receives its own Agent Host client connection and client-owned content and Tool
executor bindings.

The complete placement, resource, Tool, and semantic recovery rules are in
[Remote Agent Host architecture](../../sessions/REMOTE_AGENT_HOST.md).

## Remote Server endpoint

A `remoteServer` endpoint carries the Remote management transport for one
resolved Remote authority. The authority resolver selects the exact tunnel
descriptor and endpoint; Platform Remote constructs `IRemoteServerConnection`
over the returned stream. Higher Remote consumers still use the one management
connection and never see tunnel identities or provider credentials.

Using a Remote Tunnel for a Remote authority does not make every tunnel an
authority. The resolver owns the stable mapping and trust policy. A tunnel ID
alone never becomes a Remote resource URI authority.

## Runtime placement

```text
src/cs/platform/tunnel/
├── common/              Remote Tunnel, endpoint, provider, hosting,
│                         connection, port-forwarding, proxy, state, limits,
│                         and error contracts
├── browser/             browser-provided discovery and relay connections
├── electron-browser/    renderer-facing tunnel composition and IPC clients
├── electron-utility/    desktop provider SDK, relay, and connection ownership
└── node/                shared host, relay, and port-forwarding primitives
```

Desktop provider SDK and relay sockets live outside the renderer. The IPC
boundary carries typed commands, identities, state, and bounded endpoint
frames; it does not reinterpret the endpoint protocol. Web products receive a
browser-capable tunnel provider from product construction and bind it to the
same Platform contracts.

Endpoint-specific composition remains with its owner:

- `cs/platform/remote` binds a tunnel stream to Remote management transport;
- `cs/platform/agentHost` binds a tunnel stream or hosted listener to the
  Agent Host Protocol;
- `cs/sessions/contrib/providers/agentHost` owns tunnel discovery UX and
  provider registration for Remote Agent Host;
- `cs/server` may publish a Remote Server endpoint.

## Verification

Remote Tunnel conformance covers:

- exact provider, account, tunnel, cluster, and endpoint selection;
- descriptor validation and structured protocol compatibility;
- enumeration and exact lookup as distinct operations;
- create, reuse, publish, host, stop, and delete lifecycle;
- provider management, host relay, client relay, and endpoint credential
  isolation;
- desktop and browser connection implementations;
- initial connection, bounded step timeouts, graceful close, abrupt loss,
  reconnect, pause, resume, explicit-disconnect suppression, and grace expiry;
- multiple clients and exact connection-generation ownership;
- Remote Server and Agent Host endpoint binding without protocol inspection;
- malformed frames, backpressure, limits, cancellation, cleanup, and redacted
  diagnostics;
- port-forwarding and Remote Tunnel identity separation;
- absence of provider, account, tunnel, cluster, endpoint, route, local
  service, credential, or protocol fallback.

## Invariants

- Tunnel provider, tunnel, cluster, endpoint, hosting lease, logical client
  connection, transport generation, Remote authority, and Agent Host authority
  remain separate identities.
- Remote Tunnel publishes exact typed endpoints; labels, names, and ports do
  not define protocol compatibility.
- Tunnel identity is routing data, never a credential or filesystem authority.
- Hosting becomes active only after endpoint publication and relay attachment
  both succeed.
- Discovery never creates a Host, provider, Remote authority, or offline
  placeholder.
- Explicit disconnect stops automatic reconnect for the exact endpoint until
  an explicit connect.
- Reconnection preserves one selected route and changes only its transport
  generation.
- Relay recovery does not replay endpoint-protocol operations.
- Remote Tunnel and port forwarding have separate contracts and leases.
- Platform Tunnel carries endpoint data without interpreting Remote Server or
  Agent Host semantics.
- Missing or incompatible providers, tunnels, clusters, endpoints, revisions,
  credentials, scopes, hosts, and relay connections fail explicitly.
- No tunnel failure falls back to another provider, account, tunnel, cluster,
  endpoint, transport route, local service, or credential source.
