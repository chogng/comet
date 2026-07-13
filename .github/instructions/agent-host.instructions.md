---
description: Architecture rules for Agent Host, Agent SDK integrations, and local and remote Host connections.
applyTo: "{src/cs/platform/agentHost/**,src/cs/sessions/contrib/providers/agentHost/**}"
---

# Agent Host

Read `src/cs/sessions/AGENT_HOST.md` before changing Agent Host contracts,
Agents, connections, or Sessions integration.

- Agent Host is the single execution boundary for Agent SDKs.
- `CometAgent` has stable Agent ID `comet`.
- Local and remote identify Host placement and transport, not Agent identity.
- `cs/platform/agentHost` owns the protocol, runtime, connection contract,
  Agent registry, and Host-side `IAgent` contracts. It never imports Workbench
  or Sessions.
- Agent implementations own SDK calls, SDK event conversion, capabilities, and
  opaque resume data. They never import Sessions, Workbench Chat, UI, or Host
  transport implementations.
- Editor, Article, Browser, and other higher-layer capabilities cross the Host
  boundary only through typed bounded context or client-tool protocol messages.
  Their implementations remain with the feature owner.
- One shared `AgentHostSessionsProvider` maps one Host connection to
  `ISessionsProvider`. Local and remote contributions supply connections; they
  do not duplicate Session or Chat models.
- Agent Host owns separate canonical Session and Chat catalogs. A Session may
  contain zero or more Chats. Session creation may atomically include ordinary
  Chat creation requests, but no created Chat receives a permanent role.
- Agent Host implementation names use `agentHost`, Agent identity uses the
  registered Agent ID such as `comet`, and Host placement uses `local` or
  `remote`. `default` is not an Agent, provider, Session, Chat, storage, or
  routing identity and is never an implementation prefix. There is no
  `defaultChat` or `mainChat` identity, field, type, or routing rule.
- `IChatService` owns addressed conversation models only. It does not create
  product Sessions or own backend lifecycle.
- Agent Host message attachments use one generic envelope with producer model
  representation, bounded inline content or content references, MIME data, and
  bounded round-trip metadata. The protocol does not enumerate Workbench
  Feature attachment kinds.
- Pending Workbench composer attachments never cross the Host boundary. Host
  turns contain only producer-resolved attachments bound to an immutable source
  version.
- Attachment transport and media capabilities are explicit. An Agent never
  silently drops an attachment, stringifies an unreadable resource, or retries
  it as another kind.
- Agent and model descriptors declare carrier, MIME, count, and byte limits.
  Callers never infer attachment support from Agent IDs, model IDs, family
  names, or display names.
- Turn submission is idempotent by stable submission ID and payload digest.
  Attachment preparation or Host rejection creates no turn; Agent or SDK
  failure after Host acceptance completes the committed turn as failed.
- Content references declare ownership, version, and availability scope.
  Client-owned references use exact, turn-scoped grants and never expose a
  client-local path as a remote-Host path. Reads are chunked and bounded.
- Retry uses the normalized attachments stored on the submitted message. It
  never resolves current Feature state in place of the submitted version.
- Attachments may carry exact read references or target tokens, but never
  register or enable tools. Skills, MCP servers, commands, mutation permissions,
  confirmation policy, Agent selection, and model selection remain separate
  request fields.
- Optional operations are capability-gated and fail explicitly when
  unsupported.
- Do not branch on Agent IDs for behavior, probe for methods, try another Agent
  or Host after failure, or retain a second execution path.
