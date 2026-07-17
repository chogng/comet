# Legacy `default` Sessions provider to Agent Host migration

## Temporary scope

This migration covers the direct replacement of the built-in default Sessions
provider and main-agent command path by the architecture defined in
[AGENT_HOST.md](AGENT_HOST.md), [AGENT_PACKAGES.md](AGENT_PACKAGES.md),
[COMET_AGENT.md](COMET_AGENT.md), [ATTACHMENTS.md](ATTACHMENTS.md),
[TOOLS.md](TOOLS.md), and
[INTERACTION_TARGETS.md](INTERACTION_TARGETS.md). It also covers the Remote
foundation defined in [REMOTE.md](../platform/remote/REMOTE.md) and the remote
Host composition defined in
[REMOTE_AGENT_HOST.md](REMOTE_AGENT_HOST.md).

The migration establishes the language-neutral Agent Runtime Protocol and a
connected-Agent conformance implementation for genuinely external Agents.
Shipping a production external Agent is not required to delete this migration
document; the Agent Host composition registers `CometAgent` directly without
changing Sessions, Chat, Turn, attachment, or Tool contracts.

The migration also establishes the Host-owned Agent package lifecycle. Its
default installed set contains only the bundled `comet` package. Optional
Copilot, Claude, Codex, and other packages remain absent until an explicit user
install operation commits for the addressed Host. Product-maintained SDK
packages activate direct Host Agents; genuinely external packages use the
connected protocol.

The migration establishes the Remote Tunnel foundation defined in
[REMOTE_TUNNEL.md](../platform/tunnel/REMOTE_TUNNEL.md), including hosted
endpoint publication, discovery, relay connections, authentication, and
transport recovery. Remote Agent Host uses that foundation as a first-class
direct Agent Host Protocol route alongside the Remote Server channel route.

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
- `src/cs/platform/tunnel/**` where the Remote Tunnel lifecycle, provider,
  relay, hosting, and port-forwarding boundaries are established;
- `src/cs/platform/remote/**` and `src/cs/workbench/services/remote/**` where
  the project-owned Remote authority, persistent management connection,
  channel, environment, URI, and resource foundation is established;
- `src/cs/server/**` where the Remote Server and remote Agent Host are
  composed;
- `src/cs/platform/secrets/**` where provider credentials move to encrypted
  persistent ownership;
- `src/cs/agent/**`;
- `build/agent-sdk/**` where exact SDK dependency locks and immutable package
  artifacts replace application-root dependency packaging;
- `src/cs/platform/agentHost/node/agents/**` where SDK-specific Agent
  behavior moves from Code entry-point directories;
- `src/cs/code/common/agentHost/**` and
  `src/cs/code/electron-utility/agentRuntime/**` while package definitions and
  provider behavior moves out, leaving only application and genuinely external
  process entry points;
- `src/cs/code/electron-main/agent/**`;
- `src/cs/code/electron-main/llm/**` and
  `src/cs/code/electron-main/rag/**` where runtime services move behind
  Platform Agent Host contracts;
- `src/cs/code/electron-main/ipc.ts`;
- `src/cs/code/electron-main/main.ts` and
  `src/cs/code/electron-main/storageService.ts` where encrypted secret storage
  is composed;
- the `run_main_agent_turn` contracts in
  `src/cs/base/parts/sandbox/common/sandboxTypes.ts`;
- `src/cs/workbench/services/llm/mainAgentPayload.ts`;
- `src/cs/sessions/sessions.desktop.main.ts`;
- `src/cs/sessions/sessions.web.main.ts`;
- `src/cs/workbench/contrib/preferences/**` where package, model-catalog, and
  Host-default configuration management consumes common Host snapshots;
- `src/cs/sessions/AGENT_HOST.md`, `src/cs/sessions/AGENT_PACKAGES.md`,
  `src/cs/sessions/REMOTE_AGENT_HOST.md`,
  `src/cs/sessions/COMET_AGENT.md`, `src/cs/sessions/ATTACHMENTS.md`,
  `src/cs/sessions/TOOLS.md`, `src/cs/sessions/INTERACTION_TARGETS.md`,
  `src/cs/sessions/README.md`,
  `src/cs/sessions/SESSIONS.md`, `src/cs/sessions/LAYOUT.md`, and
  `src/cs/sessions/LAYERS.md`;
- `src/cs/platform/tunnel/REMOTE_TUNNEL.md` and
  `src/cs/platform/remote/REMOTE.md`;
- `.github/instructions/agent-host.instructions.md`,
  `.github/instructions/agent-sdk.instructions.md`,
  `.github/instructions/chat.instructions.md`,
  `.github/instructions/browserView.instructions.md`,
  `.github/instructions/sessions.instructions.md`,
  `.github/instructions/remote.instructions.md`,
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

The upstream SDK downloader also treats product-configured SDKs as available
before their bytes are local and may trigger a cold download from first Agent
use. That mechanism is a runtime dependency cache, not the target installation
contract. The target does not copy create-on-use or send-on-use download:
optional packages become executable only after a separate explicit install and
activation transaction, while Comet is the sole bundled package.

The Claude and Codex packages and direct `IAgent` implementations now live
under `src/cs/platform/agentHost/node/agents/<agent>`. Their exact module and/or
executable artifacts come from `build/agent-sdk/agents/<agent>`. The remaining
migration preserves that boundary for later product-maintained SDKs:
`src/cs/code` contains application startup only, with no forwarding module,
provider runtime entry, or root-`node_modules` package construction.

The current Claude and Codex implementations nevertheless use the wrong
semantic boundary. They reduce both SDKs to a Comet-shaped model-and-Tool loop:
the common Agent action contract represents only coarse Turn state, text,
reasoning, contributed Tool calls and terminal state; Claude disables its
native Tool, Skill, and setting surfaces and ignores most SDK messages; Codex
subscribes to only a small event subset and answers native command, file, and
permission requests without an addressed Comet interaction. Forking and
steering are reported unsupported even where the installed SDK exposes native
operations. This is removed directly rather than extended as a compatibility
path.

Claude Agent SDK and Codex app-server are orchestration authorities, not model
providers inside a Comet-owned loop. The remaining migration establishes
Comet as their common behavior substrate and gives each direct Agent an
exhaustive bidirectional mapping over its exact pinned SDK version:

| Native behavior family | Canonical Comet ownership |
|---|---|
| SDK Session or thread, Turn, resume, fork, steer, interrupt, and terminal outcome | Agent maps native identity and controls; Host owns canonical identity, committed state, persistence, and routing |
| streamed message, reasoning, status, retry, usage, context, and compaction | Agent maps native events into ordered canonical Turn behavior |
| SDK-native Tool, command, file change, search, MCP, and reserved harness operation | SDK owns orchestration and execution; Agent maps activity, interaction, output, and side effects into canonical Turn behavior |
| Comet-contributed Tool | Host owns descriptor, registration, executor, and result; Agent adds it through the SDK extension surface and correlates the native call |
| permission, approval, elicitation, and structured user input | Agent maps one native request to one addressed Host interaction and returns the exact answer to the same request |
| plan, task, subagent, teammate, and background work | Agent maps native lifecycle into canonical plan, task, child-Chat, and background state |
| SDK-only display or diagnostic event | Agent classifies it explicitly for the pinned version; semantic events are never silently discarded |

The common behavior model is the product union required to present and persist
these Agents, not the least common denominator of their current partial
implementations. Host, Sessions, Chat, and UI consume canonical behavior kinds
and never branch on Agent ID. Only the bundled `CometAgent` owns Comet's native
model-and-Tool orchestration loop.

The repository currently has no project-owned Remote authority, persistent
management connection, Remote Server, remote resource, or bidirectional
channel foundation under `src/cs`. Its tunnel layer contains only proxy
connection metadata and has no hosted Remote Tunnel identity, discovery,
relay, endpoint, authentication, or reconnection lifecycle. The upstream
Remote layers demonstrate authority resolution, one persistent management
connection, bidirectional channels, URI transformation, and Remote Server
composition. Its Agent Host tunnel paths additionally demonstrate direct
Agent Host publication and discovery through a relay, but identify capability
through labels and a well-known port and derive an Agent Host connection token
from tunnel ID. The target keeps both durable routes, moves the shared tunnel
mechanics into the project-owned Remote Tunnel foundation, uses structured
provider, account, tunnel, cluster, endpoint-kind, and protocol-revision
identity, and requires independent endpoint credentials. It carries the common
Agent Host Protocol over each route without introducing a second Agent API.

## Final project-owned boundary

- The `CometAgent` integration, with stable Agent ID `comet`, owns the built-in
  Agent registration. Its bundled package is the only default-installed Agent
  package and implements `IAgent` directly.
- Agent Host owns separate installable-package, installed-package, and active
  registration catalogs. Optional packages require an explicit user
  install for the addressed Host; Session and Turn paths never install or
  download an SDK. Product-maintained SDK packages use direct Host Agents;
  genuinely external packages use connected Agents.
- One installed revision records a fully staged and verified executable
  dependency closure. No Session, Turn, authentication, or runtime-start path
  downloads or replaces an SDK, module, helper, or native executable.
- `IAgent` is the single Host-side semantic port. Comet and product-maintained
  SDK Agents implement it directly; genuinely external Agents project it
  through `IAgentRuntimeConnection`.
- Agent Host is the common behavior, interaction, persistence, connection, and
  presentation substrate. An SDK-backed Agent preserves its installed SDK as
  the orchestration authority and maps native behavior bidirectionally; it does
  not recreate the SDK's model, Tool, planning, task, subagent, background,
  compaction, or retry loop.
- One Host authority accepts one active registration per Agent ID. The
  registration declares exact descriptor, capability, Tool Schema Profile, and
  resume-schema revisions and migration edges; runtime failure never selects
  another endpoint.
- Session and Chat backing retain their owning package ID with the Agent ID and
  opaque resume state. Restoration and migration require the same package and
  Agent; another package cannot claim retained state by registering the same
  Agent ID.
- Package update gates every Agent ID declared by the installed and staged
  revisions, drains every non-terminal accepted Turn and lifecycle mutation,
  checkpoints and releases all materialized backing, stages exact resume
  migrations, and atomically commits the installed record, registrations, and
  migrated state. Bundled Comet product update uses the same transaction.
- Reinstallation also validates every retained record attributed to the
  package and commits required declared resume migrations with activation.
  Incompatible retained records reject installation until the user explicitly
  purges them while the package is absent or chooses a compatible revision.
- Agent-backed package data deletion requires the exact activated runtime and
  ordinary delete lifecycle. A separate retained Host-record purge removes
  only Host catalog, normalized history, and opaque resume state after the
  installed record and registrations are absent, and never claims to delete
  Agent or provider backing.
- Agent Host owns the common Agent registry, Session and Chat catalogs,
  lifecycle, protocol state, routing, and persistence boundaries.
- Local and remote connections implement the same `IAgentHostConnection`.
- Remote Agent Host has two explicit connection routes: an Agent Host channel
  on one project-owned persistent Remote Server connection, and a direct Agent
  Host Protocol endpoint on one selected Remote Tunnel. Both use the common
  Agent Host connection protocol and shared Sessions provider. Neither route
  falls back to or silently replaces the other.
- Remote owns authority resolution, management transport, channel
  multiplexing, URI transformation, and Remote Server lifecycle. Remote
  Tunnel owns provider and account identity, tunnel and endpoint identity,
  hosting, discovery, relay authentication, mutation outcome reconciliation,
  endpoint streams, and transport generations. Agent Host owns protocol
  negotiation, Host identity, semantic recovery, and content and Tool endpoint
  binding.
- The Remote Server composes one `AgentHostAuthority` and binds the advertised
  Agent Host channel directly to it. A Remote Tunnel host binds the common
  Agent Host Protocol endpoint directly to its `AgentHostAuthority`. Neither
  path translates through a second Agent API, unavailable placeholder, or
  local-Host fallback.
- One shared `AgentHostSessionsProvider` implementation maps each Host
  connection into the provider-independent Sessions domain.
- `IChatService` owns addressed Chat presentation models, generic pending
  attachments, and visible request-scoped interaction targets for the addressed
  input. It does not own backend Session lifecycle. Attachments cross the Host
  only after immutable resolution and are read through the content-resource
  protocol; targets carry no content and are consumed only by independently
  exposed Tools.
- Every Agent executes behind the `IAgent` semantics; none registers a direct
  Sessions provider. Product-bundled Comet and product-maintained SDK Agents
  implement the interface directly, while genuinely external Agents receive
  its canonical values through the Agent Runtime Protocol. Each Agent projects
  the exact Turn-bound Comet-contributed Tool set through its supported
  extension surface while preserving SDK-native Tools under SDK ownership.
  Connected clients publish canonical Tool executors rather than a separate
  Tool type.
- Every Agent resolves normalized execution selections through one common
  retry-stable `IAgent` profile operation before attachment and Tool-set
  preparation. The Host binds the bounded opaque result and its exact Agent and
  model descriptor revisions to the Turn; no SDK-native configuration crosses
  that boundary.
- Agent Host owns SDK-neutral Host-default and Session configuration schema and
  value state. Every Agent exposes configuration resolution, bounded dynamic
  completion, and addressed Session application through the same Agent Runtime
  Port; SDK-native configuration and credentials remain inside the Agent
  implementation.
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
| product-configured or first-use SDK download | explicit Host package install and activation; only `comet` is bundled |
| `defaultChat` and `mainChat` roles | no durable role; address the exact Chat ID |
| `sessions.providers.default` | one-time migration input, then deleted; Host catalog and Comet Agent resume state are authoritative |

These are call-site and ownership migrations, not aliases or compatibility
names. No target registration imports or dispatches through the legacy path.

## Direct migration steps

1. Add the platform Agent Host contracts, canonical identities, versioned
   initialization, typed errors, channel snapshots and contiguous revisions,
   complete replay-or-snapshot reconnection, retry-safe operation identities,
   Host-side `IAgent` port, language-neutral Agent Runtime Protocol,
   `IAgentRuntimeConnection`, Agent package identities, manifests, installable
   and installed catalogs, package operations, Host-default and Session
   configuration schemas, values, actions, and Node runtime under
   `src/cs/platform/agentHost/`. Add direct package staging, verification,
   immutable executable-dependency resolution, storage, activation,
   package-wide quiescing, resume migration, update, uninstall, Agent-backed
   deletion, retained Host-record purge, and retained-data ownership under
   `node/packages/`. Migrate the historical `agentHost.packages.v3` source once
   into `agentHost.packages.v4`: convert exact `runtimeForm` and
   `runtimeEntryPoint` manifests to `execution`, persist exact dependency
   executable authority, convert operation transitions to activation
   transitions, validate the complete migrated package state, commit v4, and
   only then delete v3. A committed v4 state is authoritative after interrupted
   cleanup; ordinary reads and writes never choose between both formats. Keep
   Agent Host client connections and Agent runtime connections as distinct
   protocols.
2. Move canonical Agent and Tool protocol values shared by Host integrations
   from `src/cs/agent/` into Platform Agent Host common contracts. Move the
   current model-and-Tool loop and provider implementations into one direct
   Comet Agent under `src/cs/platform/agentHost/node/agents/comet/`, behind
   `IAgent`. Add the generic connected-runtime implementation under
   `src/cs/platform/agentHost/node/runtime/` and exercise the same semantics
   through a protocol conformance fixture. Product-maintained SDK Agents
   implement `IAgent` directly; genuinely external Agent code uses the
   connected-runtime path. Update every consumer directly and delete the
   parallel layer.
3. Move `runMainAgentTurn`, model routing, prompt construction, Tool-loop
   budgets, result interpretation, and Comet-specific resume state into the
   Comet runtime. Add the common execution-profile resolution operation and
   make Comet return its bounded opaque profile envelope through that port
   before attachment and Tool-set preparation. Replace direct Tool closures
   with exact canonical registrations invoked through the Host Tool Execution
   Port. Keep model-provider request formats internal to that runtime and
   update every call site directly. Register exactly one Comet endpoint for
   each Agent Host composition; do not retain the command path or dual-register
   direct and connected implementations.
   Add the common Agent configuration surface, including operation-scoped
   Session prepare, commit, rollback, and reconciliation, migrate Comet
   model-provider settings into SDK-neutral Host-default, Session, and
   model-selection schemas, and keep their native provider projection inside
   the Comet runtime. Move provider credentials into the common secret-storage
   owner, migrate each recognized plaintext predecessor to an operating-system
   encrypted envelope before Agent Host startup completes, and fail startup
   without mutating storage when that encryption authority is unavailable.
4. Replace Comet Agent imports of Editor, Workbench Chat, Fetch, RAG, and other
   higher-layer types with bounded Host context, content-resource contracts,
   and model-facing Tool contracts with explicit executor bindings.
   Register content extraction and the other concrete feature operations from
   their owning higher-layer contributions. Article requests carry normalized
   metadata and stable content references, with scoped handles materialized by
   the content owner and read through the Host content-resource protocol,
   rather than treating Article detail as complete text or requiring a model
   Tool call. Define `client`, `host`, `agent`, and `mcp` as executor bindings
   over one canonical contributed Tool descriptor, call, and result lifecycle.
   Do not add executor-specific Tool types. Define versioned Comet Tool Schema
   Profiles and require lossless projection. Each Agent runtime owns
   projection of Comet-contributed functions, dynamic Tools, aliases, calls,
   results, and private MCP bridges without changing canonical identity or
   executor. SDK-native Tools remain owned and executed by their SDK and map
   into canonical Tool activity without fabricated registrations.
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
   through the bundled `comet` package and one exact runtime registration
   revision. Make it the only default-installed package. Do not register or
   download Copilot, Claude, Codex, or another optional package until an
   explicit user install transaction commits its direct or connected Agent for the
   addressed Host. Persist the opaque resume-schema ID with Agent backing and
   retain the owning package ID and Agent ID on every Session and Chat record.
   Attribute migrated legacy records to the bundled `comet` package and Agent.
   Negotiate exact migration edges. Gate every Agent ID during update, drain
   every non-terminal accepted Turn and lifecycle mutation, checkpoint and
   release materialized backing, stage idempotent migrations, and atomically
   commit registrations and migrated state. Apply the same transaction to
   bundled Comet product updates. Reject duplicate or partial Agent
   registrations, unsupported resume schemas, cross-package state claims, and
   runtime or package replacement while any old-revision Turn remains
   non-terminal.
   Add exact SDK dependency pins and lockfiles under
   `build/agent-sdk/agents/<agent>/`, produce immutable target-specific package
   artifacts there, and publish those revisions into the installable catalog.
   Move Claude, Codex, and later SDK-specific behavior directly into
   `src/cs/platform/agentHost/node/agents/<agent>/`. Keep Code files as thin
   application entry points and composition only; delete package definitions
   and provider Agent implementations from Code after updating their call
   sites. Replace the current reduced Claude and Codex loops with exhaustive
   mappings for the pinned SDK versions. Preserve native Tools, Skills,
   settings, plans, tasks, subagents, background work, context management,
   compaction, retry, and terminal authority. Map native permission and input
   requests bidirectionally, and call native resume, fork, steer, interrupt,
   and supported configuration operations directly.
6. Implement the local desktop `IAgentHostConnection` and route it to the Agent
   Host runtime without retaining the `run_main_agent_turn` command boundary.
7. Implement the project-owned Remote and Remote Tunnel foundations under
   `src/cs/platform/remote`, `src/cs/workbench/services/remote`, and
   `src/cs/server`, and under `src/cs/platform/tunnel`. Add exact authority
   resolution, one authenticated
   persistent management connection, bidirectional typed channels, Remote
   environment and URI transformation, remote resource ownership, transport
   reconnection, and Remote Server lifecycle. Add typed Remote Tunnel provider,
   account, tunnel, cluster, endpoint, lease, connection, generation, and
   operation identity; structured endpoint compatibility; endpoint
   publication; discovery; scoped authentication; relay connections; hosting
   leases; mutation outcome reconciliation; explicit disconnect; and transport
   recovery. Compose one
   `AgentHostAuthority` in the Remote Server, bind its channel directly, and
   implement the Remote Server transport for `RemoteAgentHostConnection` over
   that supplied channel. Bind a Remote Tunnel Agent Host endpoint directly to
   the same protocol and implement its tunnel transport. Register the common
   provider only after the selected transport and Agent Host negotiation
   succeed. Do not switch between the Remote Server and Remote Tunnel routes,
   add a second Agent API, publish an unavailable placeholder, or fall back to
   a local Host.
8. Implement the shared `AgentHostSessionsProvider`, its provider-owned
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
9. Move Chat model creation and Host turn application into the shared Agent
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
10. Add the preparing-submission transaction and normalized Host attachment
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
11. Register Article, Browser, PDF, File, Directory, Editor, Chat-selection,
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
12. Move legacy default-provider Session and Chat persistence to the Host
    catalog and Comet Agent resume boundary. Perform one explicit, versioned,
    atomic data migration of `sessions.providers.default` at the new storage
    owner and delete the old key after the new state commits. Runtime routing
    never reads both formats or chooses between them. Preserve attachment data
    that the old store actually recorded, including user-message images. Do not
    invent historical Article, Editor, Browser, File, or Directory attachments
    from current checkbox state, the active Editor, Article lists, workspace
    folders, or other present-time Feature state when the old turn did not
    persist that association.
13. Replace the desktop entry-point import of the legacy default provider with
    local Agent Host registration and activation of the bundled `comet`
    package. Remote-capable targets initialize the common Remote foundation,
    negotiate the Remote Server environment, and register the remote Host only
    from its advertised live channel. Do not register optional SDK-backed
    Agents from product configuration or entry-point side effects.
14. Update all tests to exercise the Agent contract, Host runtime, local and
    remote connections, Remote authority resolution, management connection,
    bidirectional channels, URI transformation, two-layer reconnection,
    Remote Server composition, shared Sessions provider, composer restoration,
    preparation failure, Host acceptance, acknowledgement reconciliation,
    retry versioning, `blob` and `tree` limits, manifest path and link policy,
    local and remote content lifetimes, version negotiation, revision gaps,
    replay and snapshot recovery, operation-ID conflicts, release versus
    delete, monotonic Turn terminal state, explicit interaction-target binding,
    attachment content-resource reads without Tool calls, Comet Tool Schema
    Profiles, lossless SDK and Comet model projection, SDK alias and call
    mapping, embedded and connected Comet Tool-loop execution, Agent Runtime
    Protocol negotiation, common execution-profile resolution, resolution
    retry stability, Host-default and Session configuration resolution,
    dynamic completion, schema-revision validation, atomic mutable updates,
    durable pre-prepare rollback intent, commit and rollback response
    loss across cold Host and runtime restart, terminal-ledger commit and
    cleanup-acknowledgement retry, logical-operation owner restoration,
    retained-config activation rejection,
    runtime-call correlation,
    resume-schema rejection, exact
    Turn resumption, runtime disconnect without implementation failover,
    bundled-Comet-only initial package state, explicit optional-package
    install, atomic activation and update, uninstall with retained Session
    history, package-wide operation gating, materialized-backing release,
    resume migration commit and rollback, Agent-backed deletion, retained
    Host-record purge, incompatible resume-schema rejection, package operation
    reconciliation, retained package-and-Agent attribution, rejection of a
    different package claiming the same Agent ID, user-installed
    connected-runtime isolation, complete dependency-closure verification,
    rejection of runtime or first-use SDK downloads, reinstall with retained
    state, incompatible retained-state rejection, explicit preinstall purge,
    lazy target-backed reads, and connected-executor disconnect and effect
    reconciliation. Cover typed Article item identity and
    Chat-origin Browser target binding without DOM-order inference, including
    document-epoch changes and snapshot content digests.
15. Delete `src/cs/sessions/contrib/providers/default/**`, the
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
- persisted Agent defaults and explicit Session or model configuration without
  exposing SDK-native values or credentials;
- text, image, Editor, and Article request context;
- request size and model-context enforcement;
- tool execution, evidence results, and Editor patch proposals;
- completed and failed transcript state;
- cancellation and disposal of active requests;
- native permission, input, Tool, plan, task, subagent, background, context,
  compaction, resume, fork, steering, and cancellation behavior exposed by an
  installed SDK;
- rename and delete behavior advertised by capabilities;
- locale changes for provider, Session type, and draft presentation;
- durable restoration of committed Sessions and Chats;
- atomic preservation of existing `sessions.providers.default` records in the
  new Host and Comet Agent stores;
- observer failures not interrupting committed state transitions.

## Completion criteria

The migration is complete only when:

1. The `CometAgent` integration is registered through Agent Host under Agent ID
   `comet`, is activated by the bundled `comet` package, and handles the
   built-in Agent end to end through one exact runtime endpoint.
2. Local, Remote Server, and Remote Tunnel Host connections use the same Agent
   Host protocol and shared Sessions provider implementation. The Remote
   Server route obtains its channel from the project-owned Remote foundation;
   the Remote Tunnel route obtains one exact relay endpoint from the
   project-owned tunnel foundation. Each route binds directly to one
   `AgentHostAuthority` without a second Agent API, unavailable placeholder,
   route substitution, or local fallback.
3. Initialization negotiates one explicit version, channel state applies from
   snapshots and contiguous revisions, and reconnection uses complete replay or
   fresh snapshots without guessing missing state. The selected Remote Server
   or Remote Tunnel transport restores its own logical connection first;
   Agent Host then performs semantic recovery under its own connection
   identity. Recovery never changes route.
4. Session creation, Chat creation, and Turn acceptance use the common Host
   contracts. A product draft commits its Session, one ordinary Chat, and
   initial user Turn in one operation after prepared content binds to reserved
   identities, without creating a permanent Chat role or partial empty Session.
5. Every Chat lifecycle uses the common Host Chat contract and truthful
   capabilities.
6. Release preserves catalog identity and resume state; delete uses a durable
   idempotent Agent operation; retained Host-record purge is a distinct
   Host-only operation available only after installed state and registrations
   are absent; cancellation and steering address an exact Turn; and terminal
   Turn state is monotonic.
   Every retained Session and Chat record also carries its owning package ID;
   restoration, migration, deletion, and purge address that package and Agent
   without inferring ownership from the active Agent registry.
7. No Agent imports Sessions or Workbench Chat. Product-bundled Comet and
   product-maintained SDK Agents implement `IAgent` directly; genuinely
   external Agents negotiate the Agent Runtime Protocol through
   `IAgentRuntimeConnection`. Every Agent projects the exact Turn-bound
   Comet-contributed Tool set internally while SDK-backed Agents preserve and
   map SDK-native orchestration and Tools. Claude and Codex do not contain a
   Comet-owned replacement model loop; every semantic native event and request
   is mapped, explicitly diagnostic, or explicitly unsupported for the pinned
   version. Permissions and user input retain exact native and Host
   correlation, and supported resume, fork, steer, interrupt, and
   configuration controls invoke the native operation directly. Comet
   model-provider formats remain inside the Comet Agent. Every Turn resolves one bounded
   immutable execution-profile envelope through the common Agent port before
   attachment and Tool-set preparation. Feature executors contain no SDK or
   model-provider conversion. One Host Tool Execution Port carries canonical
   calls and results for every executor kind.
8. No Platform Agent Host file imports Editor, Workbench, Sessions, or Code.
   No Platform Remote or Platform Tunnel file imports Workbench, Sessions,
   Agent Host, or Code.
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
19. Remote authority, transport, management connection, bidirectional channel,
    URI, Remote Server, Remote Tunnel identity, hosting, discovery, relay,
    mutation outcome and credential isolation,
    Remote Agent Host, Agent Host, Agent Runtime Protocol,
    direct and connected Agent conformance, common
    execution-profile resolution, package-wide quiescing,
    resume-schema validation and migration, data-deletion and retained-record
    purge, Tool Execution Port, Agent projection, Comet orchestration,
    schema-profile, Sessions provider, Chat integration, entry-point, layer,
    and lifecycle tests pass.
20. Durable documentation describes only the final Remote foundation, Remote
    Tunnel, Remote Agent Host, Agent Host, Agent package, Comet Agent,
    Attachment, Tool, and interaction-target architectures and keeps Remote
    Server transport, tunnel transport, Host placement, package installation,
    Agent runtime packaging, Tool projection, and executor routing separate.
21. The authoritative initial installed-package set contains only `comet`.
    Installable, installed, activated, authenticated, and materialized states
    are distinct; optional Agents require an explicit per-Host user install;
    Session creation, restore, send, model selection, and Agent discovery
    trigger no package or SDK download. Install, update, uninstall, retained
    data, and uncertain package operations use the common Host protocol and
    pass local and remote conformance tests. Product-maintained packages use
    direct Host Agents; genuinely external packages use connected Agents, and
    activation records their complete verified executable dependency closure.
    No execution path downloads SDK or Agent
    assets. Install, reinstall, and update activate only when every retained
    record is supported or migrated in the same commit. Update gates every
    affected Agent, drains all non-terminal accepted Turns and lifecycle
    mutations, releases materialized backing, and commits migrated state
    atomically; Agent-backed deletion and post-uninstall Host-record purge
    remain distinct operations.
    Each activated SDK Agent discovers its provider-native model catalog,
    maps it into immutable common descriptor revisions, and publishes that
    Host snapshot to Sessions and Settings. Product code and Settings contain
    no parallel provider model list, and model discovery never activates or
    downloads an absent package.
    Exact SDK pins, lockfiles, and target artifact production live under
    `build/agent-sdk`; SDK-specific Agent behavior lives under Platform Agent
    Host Node; Code contains only process startup and composition. Application
    startup does not construct installable offerings from root `node_modules`,
    and users never manage raw SDK directories or provider package-manager
    versions.
22. Host Agent defaults, Session configuration, and model execution settings
    use separate exact schema revisions. Agent Host snapshots and ordered
    actions own canonical schemas and values; every Agent resolves and
    applies them through the common Agent configuration surface. A
    materialized Session update retains its prior Agent value until the Host
    persists and finalizes the exact operation, and persistence failure rolls
    that operation back without publishing partial state. The Agent retains
    terminal transaction identity until the Host has persisted the completed
    outcome and sends an exact cleanup acknowledgement; only acknowledged Host
    records are evictable. Invalid or stale
    state fails explicitly, raw credentials enter no configuration, profile,
    catalog, log, or diagnostic and resolve only through exact accepted-Turn
    authority, SDK-native configuration crosses no Host protocol boundary, and
    no Agent-specific settings path remains.

## Deletion condition

Delete this migration document in the same change that satisfies every
completion criterion. It must not remain after the default provider and
main-agent command path have been removed.
