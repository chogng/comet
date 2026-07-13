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
- Agent Host owns canonical Session and Chat catalogs. Session creation
  atomically establishes the default Chat.
- `IChatService` owns addressed conversation models only. It does not create
  product Sessions or own backend lifecycle.
- Agent Host message attachments use one generic envelope with producer model
  representation, bounded inline content or content references, MIME data, and
  bounded round-trip metadata. The protocol does not enumerate Workbench
  Feature attachment kinds.
- Attachment transport and media capabilities are explicit. An Agent never
  silently drops an attachment, stringifies an unreadable resource, or retries
  it as another kind.
- Optional operations are capability-gated and fail explicitly when
  unsupported.
- Do not branch on Agent IDs for behavior, probe for methods, try another Agent
  or Host after failure, or retain a second execution path.
