# Legacy `default` Sessions provider to Agent Host migration

## Temporary scope

This migration covers the direct replacement of the built-in default Sessions
provider and main-agent command path by the architecture defined in
[AGENT_HOST.md](AGENT_HOST.md), [ATTACHMENTS.md](ATTACHMENTS.md),
[TOOLS.md](TOOLS.md), and
[INTERACTION_TARGETS.md](INTERACTION_TARGETS.md).

The migration establishes the language-neutral Agent Runtime Protocol and a
connected-runtime conformance implementation. Shipping the production Rust
Comet Code runtime is not required to delete this migration document; the
Agent Host composition must already register exactly one embedded or connected
Comet runtime without changing Sessions, Chat, Turn, attachment, or Tool
contracts.

The scoped files and final locations are:

- `src/cs/sessions/contrib/providers/default/**`;
- `src/cs/sessions/contrib/providers/agentHost/**`;
- `src/cs/sessions/services/sessions/**` where provider routing and contracts
  require direct call-site changes;
- `src/cs/sessions/contrib/chat/**` where addressed Chat models bind to
  Sessions management;
- `src/cs/sessions/contrib/browserView/**` where Browser context migrates to
  the common composer-attachment API;
- `src/cs/workbench/contrib/chat/**` where the public Chat model, composer,
  attachment registry, and submission transaction require Agent Host state
  integration;
- `src/cs/workbench/contrib/fetch/**` where Article attachment contributions
  enter the common composer path;
- `src/cs/workbench/contrib/pdfEditor/**` and `src/cs/editor/browser/pdf/**`
  where PDF context enters the common composer path;
- `src/cs/workbench/contrib/files/**` where File and Directory sources
  contribute their attachment producers;
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
- `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/ATTACHMENTS.md`,
  `src/cs/sessions/TOOLS.md`, `src/cs/sessions/INTERACTION_TARGETS.md`,
  `src/cs/sessions/README.md`,
  `src/cs/sessions/SESSIONS.md`, `src/cs/sessions/LAYOUT.md`, and
  `src/cs/sessions/LAYERS.md`;
- `.github/instructions/agent-host.instructions.md`,
  `.github/instructions/chat.instructions.md`,
  `.github/instructions/browserView.instructions.md`,
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

The current request boundary also carries a closed Resource, Text, Article,
Editor, and Image union through Sessions management. The Sessions Chat view
constructs Article attachments from checkbox state, harvests the active Editor
at send time, and inserts Browser context as synthetic user history. The
provider appends the user message and clears input before Feature attachment
resolution, then branches on every Feature kind. These paths are removed rather
than wrapped by the common attachment API.

This boundary makes the built-in Agent a direct Sessions provider and gives it
a unique integration path that other Agent SDKs cannot reuse. The names
`default` and `mainAgent` also mix product selection and UI role with Agent
identity.

The current shared Sessions contract separately makes `ISession.mainChat` a
permanent privileged Chat. Management and view services use it for draft send,
selection, close, delete, and missing-selection recovery. The upstream Agent
Host state similarly exposes `defaultChat` and falls back to the first catalog
Chat when that identity is absent. The target does not copy either design:
catalog order is not identity, and missing Chat state remains explicit.

The current attachment request is a closed Feature union owned by Workbench
Chat and interpreted again by the default provider. The provider commits and
clears the input before resolving Feature content, creates its tool list while
branching on attachment kinds, rejects Resource attachments, and persists only
the image subset of submitted attachments. Historical Article, Editor,
Browser, File, or Directory association therefore does not exist in the old
store and cannot be reconstructed from present Feature state.

The current Article result renderer associates `ArticleId` values with generic
Markdown list items by querying `li` elements and assuming matching count and
order. Article link navigation therefore has no typed Chat-and-Article origin
to bind to the opened Browser document. The target renderer owns typed Article
items and passes `chatResource`, Article ID, and URI through the open action
directly; it does not infer the relationship from rendered DOM.

The upstream Agent Host protocol demonstrates explicit initialization and
version selection, channel subscriptions with snapshots, monotonic server
sequence numbers, and reconnect by complete replay or fresh snapshot. Those
protocol mechanisms inform the target connection contract. The target does not
copy upstream `defaultChat` routing, Feature-advisory directory handling,
client-local URI assumptions, or permissive handling that can leave required
state actions unapplied.

## Final project-owned boundary

- The `CometAgent` integration, with stable Agent ID `comet`, owns the built-in
  Agent registration without defining its runtime packaging.
- `IAgent` is the single Host-side semantic port. An embedded Comet runtime may
  implement it directly; a connected Comet Code SDK runtime implements the
  language-neutral Agent Runtime Protocol through `IAgentRuntimeConnection`.
- One Host authority accepts one active runtime registration per Agent ID. The
  registration declares exact descriptor, capability, Tool Schema Profile, and
  resume-schema revisions; runtime failure never selects another endpoint.
- Agent Host owns the common Agent registry, Session and Chat catalogs,
  lifecycle, protocol state, routing, and persistence boundaries.
- Local and remote connections implement the same `IAgentHostConnection`.
- One shared `AgentHostSessionsProvider` implementation maps each Host
  connection into the provider-independent Sessions domain.
- `IChatService` owns addressed Chat presentation models, generic pending
  attachments, and visible request-scoped interaction targets for the addressed
  input. It does not own backend Session lifecycle. Attachments cross the Host
  only after immutable resolution and are read through the content-resource
  protocol; targets carry no content and are consumed only by independently
  exposed Tools.
- Every Agent executes behind the `IAgent` semantics; none registers a direct
  Sessions provider. Embedded runtimes implement the interface directly, while
  connected runtimes receive its canonical values through the Agent Runtime
  Protocol. Each runtime projects the exact Turn-bound canonical Tool set.
  Connected clients publish canonical Tool executors rather than a separate
  Tool type.
- The Comet runtime owns the migrated model and Tool orchestration loop. It
  consumes canonical Tool registrations directly, invokes them through the
  Host Tool Execution Port, and keeps model-provider conversion internal
  whether it is embedded or connected.
- The shared provider family and implementation path use `agentHost`; Agent
  behavior uses registered Agent IDs such as `comet`; Host placement uses
  `local` or `remote`; and every Chat is addressed by its own Chat ID.
- A Session owns an ordered collection of zero or more equal-status Chats. It
  has no `mainChat`, `defaultChat`, primary-Chat identity, or implicit
  first-Chat routing rule. View-owned `activeChat` is optional and never
  becomes Host or provider domain state.
- No target symbol, filename, directory, provider ID, Session type, Chat type,
  storage key, or runtime route uses `default` as an implementation identity or
  prefix. `sessions.providers.default` is solely a one-time migration source
  key and is deleted after the new state commits.

The naming cutover is direct:

| Legacy source | Durable target |
|---|---|
| `contrib/providers/default/**` | `contrib/providers/agentHost/**` |
| `DefaultSessionsProvider` | `AgentHostSessionsProvider` |
| `DefaultSession` and `DefaultChat` | Host-identified provider models implementing `ISession` and `IChat` |
| `mainAgent` and `run_main_agent_turn` | one `CometAgent` integration registered as `comet` through the Agent Runtime Port |
| `defaultChat` and `mainChat` roles | no durable role; address the exact Chat ID |
| `sessions.providers.default` | one-time migration input, then deleted; Host catalog and Comet Agent resume state are authoritative |

These are call-site and ownership migrations, not aliases or compatibility
names. No target registration imports or dispatches through the legacy path.

## Direct migration steps

1. Add the platform Agent Host contracts, canonical identities, versioned
   initialization, typed errors, channel snapshots and contiguous revisions,
   complete replay-or-snapshot reconnection, retry-safe operation identities,
   Host-side `IAgent` port, language-neutral Agent Runtime Protocol,
   `IAgentRuntimeConnection`, and Node runtime under
   `src/cs/platform/agentHost/`. Keep Agent Host client connections and Agent
   runtime connections as distinct protocols.
2. Move canonical Agent and Tool protocol values shared by Host integrations
   from `src/cs/agent/` into Platform Agent Host common contracts. Move the
   current model-and-Tool loop and provider implementations into one embedded
   Comet runtime under `src/cs/platform/agentHost/node/agents/comet/`, behind
   `IAgent`. Add the generic connected-runtime implementation under
   `src/cs/platform/agentHost/node/runtime/` and exercise the same semantics
   through a protocol conformance fixture. Update every consumer directly and
   delete the parallel layer.
3. Move `runMainAgentTurn`, model routing, prompt construction, Tool-loop
   budgets, result interpretation, and Comet-specific resume state into the
   Comet runtime. Replace direct Tool closures with exact canonical
   registrations invoked through the Host Tool Execution Port. Keep
   model-provider request formats internal to that runtime and update every
   call site directly. Register exactly one Comet endpoint for each Agent Host
   composition; do not retain the command path or dual-register embedded and
   connected runtimes.
4. Replace Comet Agent imports of Editor, Workbench Chat, Fetch, RAG, and other
   higher-layer types with bounded Host context, content-resource contracts,
   and model-facing Tool contracts with explicit executor bindings.
   Register content extraction and the other concrete feature operations from
   their owning higher-layer contributions. Article requests carry normalized
   metadata and stable content references, with scoped handles materialized by
   the content owner and read through the Host content-resource protocol,
   rather than treating Article detail as complete text or requiring a model
   Tool call. Define `client`, `host`, `agent`, and `mcp` as executor bindings
   over one canonical Tool descriptor, call, and result lifecycle. Do not add
   executor-specific Tool types. Define versioned Comet Tool Schema Profiles
   and require lossless projection. Each Agent runtime owns its native
   function, dynamic Tool, fixed Tool, alias, call, result, and private
   MCP-bridge conversion without changing canonical identity or executor.
   The Comet runtime consumes the canonical set through its orchestration loop
   and projects only at its internal model-provider boundary. A connected
   runtime receives the same Tool-set revision and returns canonical calls and
   results through the Agent Runtime Protocol.
   Add one generic Host Tool Execution Port for every executor kind. The shared
   client connection publishes exact connected executors and carries canonical
   calls, cancellation, progress, results, registrations, and target
   availability. Resolved attachments may supply scoped immutable content
   references but never interaction targets or the request's Tool list. Add a
   generic request-scoped interaction-target model:
   a Feature explicitly binds only identity and version to an addressed Chat
   input, and lazy content extraction occurs only when the model or Agent emits
   a call to the independently exposed Tool. Add stable Browser main-frame
   document epochs so a target can address one navigation without pretending
   to be an immutable content snapshot.
5. Register the `CometAgent` integration with Agent Host under Agent ID `comet`
   and one exact runtime registration revision. Persist the opaque
   resume-schema ID with Agent backing. Reject duplicate Agent IDs,
   unsupported resume schemas, and runtime replacement during an active Turn.
6. Implement the local desktop `IAgentHostConnection` and route it to the Agent
   Host runtime without retaining the `run_main_agent_turn` command boundary.
7. Implement the shared `AgentHostSessionsProvider`, its provider-owned
   `ISession` and `IChat` models, draft replacement, capability mapping, and
   authoritative collection transitions. Remove `ISession.mainChat` and update
   every call site directly to use the addressed Chat or optional view-owned
   `activeChat`. Allow a committed Session to contain zero Chats. Remove
   first-Chat close and delete restrictions and every implicit Chat-selection
   substitution. Replace `supportsMultipleChats` with explicit user-Chat
   creation capability and capacity; update every capability consumer directly.
   Distinguish runtime release from durable delete, reconcile every catalog
   mutation by operation ID, and address cancellation and steering by exact
   Turn ID.
8. Move Chat model creation and Host turn application into the shared Agent
   Host Sessions integration. Add one addressed composer-attachment model, one
   public attachment API, one separate addressed interaction-target model,
   current-version producer codecs, and registries for Feature-owned
   resolution, canonical Tools with executor bindings, generic Tool execution,
   and browser presentation. Add separate request-scoped Tool-selection policy
   and stable IDs without copying descriptors into Chat. Replace the closed
   request attachment union and send-time active-Editor harvesting. Change
   Sessions management and provider send contracts to route only the addressed
   Session and Chat; the shared provider begins the immutable request snapshot
   through `IChatService`. Update every call site directly.
9. Add the preparing-submission transaction and normalized Host attachment
   and content-resource protocols. Resolve every captured attachment, bind
   immutable source versions, resolve the requested Tool policy into one exact
   prepared Tool-set revision bound to the exact Agent runtime registration,
   validate limits and Agent capabilities, then submit with an idempotent
   submission ID and payload digest. Host acceptance revalidates and records
   the attachments, interaction targets, Agent runtime registration revision,
   and exposed Tool-set revision with the Turn. Consume the composer only after
   Host acceptance. Pre-acceptance failure preserves it and creates no turn;
   post-acceptance Agent failure completes the committed turn as failed. For a
   product draft, prepare under the Host connection and submission ID before
   creating the Host Session. In one create operation, reserve Session,
   ordinary User Chat, and Turn identities, bind prepared references to those
   identities, and atomically commit the Session, Chat, and initial user Turn.
   Pre-commit failure publishes none of them; the created Chat receives no
   permanent role.
10. Register Article, Browser, PDF, File, Directory, Editor, Chat-selection,
    text, and image producers directly through the common attachment path. File
    resolves one immutable `blob`; Directory resolves one immutable bounded
    `tree` manifest with normalized relative entries, explicit enumeration and
    link policy, and depth, entry, per-file, and total-byte limits. Do not pass
    client-local paths to remote Hosts, flatten a Directory into prompt text,
    expand it into inferred File attachments, or grant access beyond committed
    tree entries. Keep Article and other Feature selections independent,
    replace automatic Article projection with explicit attachment actions, and
    delete direct Editor harvesting and synthetic Browser context messages.
    Replace Markdown-list DOM correlation with typed Article item rendering and
    an open action carrying `chatResource`, Article ID, and URI. Add
    version-addressed, bounded content publication before enabling Article
    full-content attachment resolution; `ArticleDetail` is never used as a
    full-text fallback.
11. Move legacy default-provider Session and Chat persistence to the Host
    catalog and Comet Agent resume boundary. Perform one explicit, versioned,
    atomic data migration of `sessions.providers.default` at the new storage
    owner and delete the old key after the new state commits. Runtime routing
    never reads both formats or chooses between them. Preserve attachment data
    that the old store actually recorded, including user-message images. Do not
    invent historical Article, Editor, Browser, File, or Directory attachments
    from current checkbox state, the active Editor, Article lists, workspace
    folders, or other present-time Feature state when the old turn did not
    persist that association.
12. Replace the desktop entry-point import of the legacy default provider with
    local Agent Host registration. Register remote Host discovery only in
    targets that provide a real remote connection implementation.
13. Update all tests to exercise the Agent contract, Host runtime, local and
    remote connections, shared Sessions provider, composer restoration,
    preparation failure, Host acceptance, acknowledgement reconciliation,
    retry versioning, `blob` and `tree` limits, manifest path and link policy,
    local and remote content lifetimes, version negotiation, revision gaps,
    replay and snapshot recovery, operation-ID conflicts, release versus
    delete, monotonic Turn terminal state, explicit interaction-target binding,
    attachment content-resource reads without Tool calls, Comet Tool Schema
    Profiles, lossless SDK and Comet model projection, SDK alias and call
    mapping, embedded and connected Comet Tool-loop execution, Agent Runtime
    Protocol negotiation, runtime-call correlation, resume-schema rejection,
    exact Turn resumption, runtime disconnect without implementation failover,
    lazy target-backed reads, and connected-executor disconnect and effect
    reconciliation. Cover typed Article item identity and Chat-origin Browser
    target binding without DOM-order inference, including document-epoch
    changes and snapshot content digests.
14. Delete `src/cs/sessions/contrib/providers/default/**`, the
   `run_main_agent_turn` command and payload contracts, default-provider
   storage, every `default`-prefixed implementation symbol and file, the
   parallel `src/cs/agent/**` layer, and all obsolete tests in the same
   migration.

Call sites migrate directly to the final contracts. The migration must not add
aliases, re-exports, wrappers, facades, compatibility providers, dual
registration, catch-and-try-next logic, or a legacy command path.

## Behavior that must be preserved

- workspace-bound and workspace-less Session creation;
- existing Chat histories, identities, origins, and catalog ordering without
  preserving a privileged main-Chat role;
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

1. The `CometAgent` integration is registered through Agent Host under Agent ID
   `comet` and handles the built-in Agent end to end through one exact runtime
   endpoint.
2. Local and remote Host connections use the same protocol and shared Sessions
   provider implementation.
3. Initialization negotiates one explicit version, channel state applies from
   snapshots and contiguous revisions, and reconnection uses complete replay or
   fresh snapshots without guessing missing state.
4. Session creation, Chat creation, and Turn acceptance use the common Host
   contracts. A product draft commits its Session, one ordinary Chat, and
   initial user Turn in one operation after prepared content binds to reserved
   identities, without creating a permanent Chat role or partial empty Session.
5. Every Chat lifecycle uses the common Host Chat contract and truthful
   capabilities.
6. Release preserves catalog identity and resume state; delete uses a durable
   idempotent operation; cancellation and steering address an exact Turn; and
   terminal Turn state is monotonic.
7. No Agent runtime imports Sessions or Workbench Chat. Embedded runtimes
   implement `IAgent`; connected runtimes negotiate the Agent Runtime Protocol
   through `IAgentRuntimeConnection`. Every runtime projects the exact
   Turn-bound canonical Tool set internally. Comet model-provider formats
   remain inside the Comet runtime. Feature executors contain no SDK or
   model-provider conversion. One Host Tool Execution Port carries canonical
   calls and results for every executor kind.
8. No Platform Agent Host file imports Editor, Workbench, Sessions, or Code.
9. No Sessions service or non-provider contribution imports an Agent runtime
   implementation.
10. Every Feature attachment enters through the common addressed Chat
    attachment API, and submitted attachments use the normalized Host protocol
    without provider-specific routing or silent omission. Lazy Feature
    operations use the canonical Tool and separate interaction-target contracts.
    Reading a submitted content reference uses the content-resource protocol
    and never creates a Tool call.
11. File and Directory use separate producers over the common attachment API.
   File submissions bind immutable `blob` references; Directory submissions
   bind immutable bounded `tree` manifests. Remote Hosts receive no client-local
   path, live recursive grant, inferred File expansion, or unmanifested entry.
12. Sessions management and provider send contracts carry only addressed
   Session and Chat identity; no closed Feature attachment union or parallel
   request payload remains outside `IChatService`.
13. Pre-acceptance attachment and Host failures preserve the composer and
   create no turn; post-acceptance Agent failures preserve the committed failed
   turn; retry never substitutes current Feature state for submitted content.
14. Request-scoped interaction targets carry only exact identity and version,
   are bound explicitly to one addressed Chat input, and trigger no content
   extraction unless the model or Agent emits a call to the exact exposed Tool.
   General submission does not scan globally active Editors or route a missing
   Tool, executor, or target to another implementation.
15. `providers/default`, `DefaultSessionsProvider`, `DefaultSession`,
   `DefaultChat`, every other `default`-prefixed implementation identity, and
   `run_main_agent_turn` no longer exist. The old storage key appears only in
   the completed one-time data migration and is absent from runtime routing and
   newly persisted state.
16. `ISession.mainChat`, `defaultChat`, main-Chat branches, first-Chat
    privileges, and implicit first-Chat selection no longer exist. Empty
    committed Sessions and an undefined view-owned `activeChat` are represented
    explicitly.
17. The parallel `src/cs/agent/**` layer no longer exists.
18. No old symbol is retained through an alias, wrapper, re-export, or
    compatibility module.
19. Agent Host, Agent Runtime Protocol, embedded and connected runtime
    conformance, resume-schema validation, Tool Execution Port, Agent
    projection, Comet orchestration, schema-profile, Sessions provider, Chat
    integration, entry-point, layer, and lifecycle tests pass.
20. Durable documentation describes only the final Agent Host, Attachment,
    Tool, and interaction-target architectures and keeps Agent runtime
    packaging, Tool projection, executor routing, and Host placement separate.

## Deletion condition

Delete this migration document in the same change that satisfies every
completion criterion. It must not remain after the default provider and
main-agent command path have been removed.
