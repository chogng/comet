# Default Sessions provider to Agent Host migration

## Temporary scope

This migration covers the direct replacement of the built-in default Sessions
provider and main-agent command path by the Agent Host architecture defined in
[AGENT_HOST.md](AGENT_HOST.md).

The scoped files and final locations are:

- `src/cs/sessions/contrib/providers/default/**`;
- `src/cs/sessions/contrib/providers/agentHost/**`;
- `src/cs/sessions/services/sessions/**` where provider routing and contracts
  require direct call-site changes;
- `src/cs/sessions/contrib/chat/**` where addressed Chat models bind to
  Sessions management;
- `src/cs/sessions/contrib/browserView/**` where Browser context migrates to
  the common composer-attachment API;
- `src/cs/workbench/contrib/chat/common/chatService/**` where the public Chat
  model contract requires Agent Host state integration;
- `src/cs/workbench/contrib/draftEditor/**` where Editor context migrates to
  the common composer-attachment API;
- `src/cs/platform/agentHost/**`;
- `src/cs/agent/**`;
- `src/cs/code/electron-main/agent/**`;
- `src/cs/code/electron-main/llm/**` and
  `src/cs/code/electron-main/rag/**` where runtime services move behind
  Platform Agent Host contracts;
- `src/cs/code/electron-main/ipc.ts`;
- the `run_main_agent_turn` contracts in
  `src/cs/base/parts/sandbox/common/sandboxTypes.ts`;
- `src/cs/workbench/services/llm/mainAgentPayload.ts`;
- `src/cs/sessions/sessions.desktop.main.ts`;
- `src/cs/sessions/sessions.web.main.ts`;
- `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/README.md`,
  `src/cs/sessions/SESSIONS.md`, and `src/cs/sessions/LAYERS.md`;
- `.github/instructions/agent-host.instructions.md`,
  `.github/instructions/sessions.instructions.md`,
  `.github/instructions/source-code-organization.instructions.md`, and
  `.github/instructions/article.instructions.md`;
- tests under the scoped provider, Agent execution, Agent Host, connection,
  Sessions service, and Chat model directories.

## Current boundary being removed

`DefaultSessionsProvider` currently owns the built-in Session and Chat models,
Chat model references, request transactions, model selection, attachment
resolution, request payload construction, native command dispatch, lifecycle,
and durable transcript storage. The electron-main `run_main_agent_turn` command
owns the corresponding built-in Agent execution.

This boundary makes the built-in Agent a direct Sessions provider and gives it
a unique integration path that other Agent SDKs cannot reuse. The names
`default` and `mainAgent` also mix product selection and UI role with Agent
identity.

## Final project-owned boundary

- `CometAgent`, with stable Agent ID `comet`, owns the built-in Agent behavior.
- `CometAgent` implements the common Host-side `IAgent` contract.
- Agent Host owns the common Agent registry, Session and Chat catalogs,
  lifecycle, protocol state, routing, and persistence boundaries.
- Local and remote connections implement the same `IAgentHostConnection`.
- One shared `AgentHostSessionsProvider` implementation maps each Host
  connection into the provider-independent Sessions domain.
- `IChatService` owns addressed Chat presentation models only.
- All Agent SDK integrations implement `IAgent`; none registers a direct
  Sessions provider.

## Direct migration steps

1. Add the platform Agent Host contracts, canonical identities, ordered state
   protocol, and Node runtime under `src/cs/platform/agentHost/`.
2. Move the reusable protocol and turn runtime from `src/cs/agent/` into
   Platform Agent Host and update every consumer directly.
3. Move the implementation of `runMainAgentTurn`, its tools, request limits,
   and SDK-facing state into `CometAgent`. Rename main-agent-owned contracts to
   Comet Agent contracts and update every call site directly.
4. Replace Comet Agent imports of Editor, Workbench Chat, Fetch, RAG, and other
   higher-layer types with bounded Host context and client-tool contracts.
   Register content extraction and the other concrete feature operations from
   their owning higher-layer contributions. Article requests carry normalized
   metadata and stable content references, with scoped handles materialized by
   the content owner, rather than treating Article detail as complete text.
5. Register `CometAgent` with the Agent Host runtime under Agent ID `comet`.
6. Implement the local desktop `IAgentHostConnection` and route it to the Agent
   Host runtime without retaining the `run_main_agent_turn` command boundary.
7. Implement the shared `AgentHostSessionsProvider`, its provider-owned
   `ISession` and `IChat` models, draft replacement, capability mapping, and
   authoritative collection transitions.
8. Move Chat model creation and Host turn application into the shared Agent
   Host Sessions integration. Add one addressed composer-attachment model and
   one public attachment API plus a registry for Feature-owned attachment
   types. Keep Article selection independent, and replace its automatic request
   projection with an explicit Article attachment action. Replace direct Editor
   harvesting and synthetic Browser context messages with explicit producers
   registered through the common attachment path. Snapshot only existing
   composer attachments at send and associate them with the user turn. Keep
   Chat input routed through `ISessionsManagementService` and the addressed
   provider.
9. Move default-provider Session and Chat persistence to the Host catalog and
   Comet Agent resume boundary. Perform one explicit, versioned, atomic data
   migration of `sessions.providers.default` at the new storage owner and
   delete the old key after the new state commits. Runtime routing never reads
   both formats or chooses between them.
10. Replace the desktop entry-point import of the default provider with local
   Agent Host registration. Register remote Host discovery only in targets that
   provide a real remote connection implementation.
11. Update all tests to exercise the Agent contract, Host runtime, local and
   remote connections, shared Sessions provider, and Chat model integration.
12. Delete `src/cs/sessions/contrib/providers/default/**`, the
    `run_main_agent_turn` command and payload contracts, default-provider
    storage, the parallel `src/cs/agent/**` layer, and all obsolete tests in the
    same migration.

Call sites migrate directly to the final contracts. The migration must not add
aliases, re-exports, wrappers, facades, compatibility providers, dual
registration, catch-and-try-next logic, or a legacy command path.

## Behavior that must be preserved

- workspace-bound and workspace-less Session creation;
- one main Chat for every Session;
- explicit draft discard and atomic draft-to-committed replacement;
- model discovery, selection, and disabled-model validation;
- text, image, Editor, and Article request context;
- request size and model-context enforcement;
- tool execution, evidence results, and Editor patch proposals;
- completed and failed transcript state;
- cancellation and disposal of active requests;
- rename and delete behavior advertised by capabilities;
- locale changes for provider, Session type, and draft presentation;
- durable restoration of committed Sessions and Chats;
- atomic preservation of existing `sessions.providers.default` records in the
  new Host and Comet Agent stores;
- observer failures not interrupting committed state transitions.

## Completion criteria

The migration is complete only when:

1. `CometAgent` is registered through Agent Host and handles the built-in Agent
   end to end.
2. Local and remote Host connections use the same protocol and shared Sessions
   provider implementation.
3. Session creation and default Chat creation use the common Host contracts.
4. Additional Chat lifecycle uses the common Host Chat contract and truthful
   capabilities.
5. No Agent SDK implementation imports Sessions or Workbench Chat.
6. No Platform Agent Host file imports Editor, Workbench, Sessions, or Code.
7. No Sessions service or non-provider contribution imports an Agent
   implementation.
8. Every Feature adds request context through the common addressed Chat
   attachment API, and submitted attachments use the normalized Host protocol
   without provider-specific routing or silent omission.
9. `providers/default`, `DefaultSessionsProvider`, `DefaultSession`,
   `DefaultChat`, and `run_main_agent_turn` no longer exist.
10. The parallel `src/cs/agent/**` layer no longer exists.
11. No old symbol is retained through an alias, wrapper, re-export, or
    compatibility module.
12. Agent Host, Sessions provider, Chat integration, entry-point, layer, and
    lifecycle tests pass.
13. Durable documentation describes only the final Agent Host architecture.

## Deletion condition

Delete this migration document in the same change that satisfies every
completion criterion. It must not remain after the default provider and
main-agent command path have been removed.
