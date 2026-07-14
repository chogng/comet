---
description: Architecture rules for Remote authorities, Remote Server connections, Remote Tunnel, channels, resources, and Remote Agent Host composition.
applyTo: "{src/cs/platform/remote/**,src/cs/platform/tunnel/**,src/cs/workbench/services/remote/**,src/cs/server/**,src/cs/platform/agentHost/**,src/cs/sessions/contrib/providers/agentHost/**}"
---

# Remote foundation

Read `src/cs/platform/remote/REMOTE.md` before changing Remote authority,
transport, connection, channel, server, environment, or resource behavior.
Read `src/cs/platform/tunnel/REMOTE_TUNNEL.md` before changing tunnel
discovery, hosting, relay, endpoint, port-forwarding, proxy, authentication, or
reconnection behavior.
Read `src/cs/sessions/REMOTE_AGENT_HOST.md` and
`src/cs/sessions/AGENT_HOST.md` before changing Remote Agent Host composition
or its connection.

- Use Remote Server for Comet's generic remote process. Agent identifies a
  reasoning runtime registered with Agent Host.
- One exact resolver handles one Remote authority kind. Missing, duplicate,
  malformed, denied, and incompatible resolution fails explicitly.
- One application instance uses one persistent Remote management connection
  for its selected authority. Consumers do not open private sockets or create
  another Remote Server lifecycle.
- Remote authority, endpoint, Remote client, transport generation, Remote
  Server instance, channel, resource, Agent Host authority, and Agent Host
  client connection are separate identities.
- Remote transport reconnection preserves only the Remote logical client and
  channel transport. Each stateful subsystem performs its own semantic
  recovery afterward.
- Remote resources remain authority-qualified and never masquerade as
  client-local paths.
- Bidirectional channels expose exact registered operations. They do not expose
  ambient services or redirect missing operations to another channel.
- Remote Tunnel provider, tunnel, cluster, endpoint, hosting lease, logical
  connection, and transport generation are separate from Remote authority,
  Remote Server connection, and Agent Host identity.
- Remote Tunnel discovery and exact lookup are distinct operations. Names,
  labels, and well-known ports never select protocol compatibility.
- Remote Agent Host supports two exact routes: a typed channel from
  `IRemoteServerConnection`, and a direct `agentHost` endpoint from
  `IRemoteTunnelConnection`. Both carry the common Agent Host Protocol and
  register the shared provider only after initialization succeeds.
- Never switch between Remote Server and Remote Tunnel routes during connect
  or recovery. A direct tunnel grants no Remote Server or filesystem authority.
- A Remote Server advertises the Agent Host channel only when its owning Host
  composition is live. Do not register an unavailable placeholder or connect
  to the local Host when the capability is absent.
- Remote transport credentials, Agent runtime registration, Agent
  authentication, tunnel management and relay credentials, Agent Host
  endpoint credentials, model credentials, secret references, Tool permission,
  and resource authority remain separate scopes. Never derive a credential
  from tunnel identity.
- Do not fall back to a local endpoint, another Remote authority, resolver,
  transport, tunnel provider, tunnel, cluster, endpoint, route, channel,
  client, Host, resource, package, Agent, runtime, Tool, or credential source.
