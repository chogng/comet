---
description: Architecture rules for Agent packages, Agent Host, embedded and connected runtimes, and local and remote Host connections.
applyTo: "{src/cs/platform/agentHost/**,src/cs/sessions/contrib/providers/agentHost/**}"
---

# Agent Host

Read `src/cs/sessions/AGENT_HOST.md` before changing Agent Host contracts,
Agents, connections, or Sessions integration. Read
`src/cs/sessions/REMOTE_AGENT_HOST.md` and
`src/cs/platform/remote/REMOTE.md` before changing remote Host placement or
Remote Server composition. Read `src/cs/platform/tunnel/REMOTE_TUNNEL.md`
before changing tunnel-hosted Agent Host publication, discovery, relay,
connection registration, remote resources, or recovery. Read
`src/cs/sessions/AGENT_PACKAGES.md` before changing package discovery,
installation, verification, activation, update, uninstall, SDK loading, or
runtime registration. Read `src/cs/sessions/COMET_AGENT.md` before changing
Comet execution profiles, Host Turn binding, orchestration, model integration,
workers, checkpoints, or embedded and Rust runtime composition. Read
`src/cs/sessions/ATTACHMENTS.md` before changing attachment, content-reference,
content-resource, or submission contracts. Read `src/cs/sessions/TOOLS.md`
before changing canonical Tools, schemas, Tool sets, Agent projection,
permissions, calls, results, or executors. Read
`src/cs/sessions/INTERACTION_TARGETS.md` before changing request-scoped target
binding, target-backed Tools, or lazy Feature operations.

- Agent Host is the single execution boundary for every Agent runtime.
- The `CometAgent` integration has stable Agent ID `comet`; its orchestration
  runtime may be embedded or connected. The bundled `comet` package is the
  only default-installed Agent package.
- Copilot, Claude, Codex, and every other optional Agent are absent until the
  user explicitly installs their package for the addressed Host and user
  scope. Installable catalog entries are not installed packages or Agent
  registrations. Session creation, restore, send, model selection, and Agent
  discovery never install or download a package. User-installed packages
  always execute as connected runtimes outside the Agent Host process; only a
  product-bundled Comet composition may use an embedded runtime.
- Treat one installed revision as the complete verified executable dependency
  closure. Package installation or update must stage every SDK, module, helper,
  and native asset before activation. Session, Turn, authentication, and
  runtime-start paths never download or replace executable dependencies.
- Launch user-installed runtimes under the exact sandbox and authority derived
  from their verified manifest and Host policy. They receive no ambient Host
  service objects or credential environment; filesystem, network, secret, and
  Tool-executor access never exceeds the committed grant.
- Agent package ID, package revision, Agent ID, runtime registration,
  authentication, and runtime materialization are separate. Agent SDKs remain
  private runtime dependencies and are not the product installation contract.
  Persist every Session and Chat backing with its owning package ID as well as
  its Agent ID. Restoration and resume migration require that same package and
  Agent; a different package that registers the same Agent ID must never claim
  retained catalog or opaque resume state.
- Package install and update stage, verify, negotiate, and atomically publish
  installed state, declared Agent registrations, and any staged resume
  migrations. Reinstallation validates every retained record attributed to the
  package; incompatible records reject activation and require a separate
  explicit purge while the package is absent. Update gates every Agent ID in
  the package, drains every non-terminal accepted Turn and lifecycle mutation,
  checkpoints and releases all materialized backing, and commits migrated
  resume values with the new registrations. Uninstall preserves Host Session
  history and never reassigns Sessions to another Agent. Agent-backed deletion
  requires the activated runtime; retained Host-record purge is Host-only,
  requires absent installed state and registrations, and never claims to delete
  Agent or provider backing. Do not infer package state from product
  configuration, files, environment variables, credentials, or Agent display
  data.
- Local and remote identify Host placement and transport, not Agent identity.
- Remote Agent Host uses one explicitly selected route: a channel on the
  common persistent Remote Server connection, or an `agentHost` endpoint on
  one exact Remote Tunnel connection. Both carry the common Agent Host
  Protocol and create the shared provider only after initialization.
- Remote Server and Remote Tunnel routes never replace one another after
  failure. The selected lower transport restores its logical connection first;
  Agent Host then reconciles subscriptions, actions, operations, content
  leases, and Tool calls by their exact identities.
- `cs/platform/agentHost` owns the protocol, runtime, connection contract,
  Agent registry, Host-side `IAgent` contract, and language-neutral Agent
  Runtime Protocol. It never imports Workbench or Sessions.
- `IAgent` is the single Host-facing semantic port. The product-bundled
  embedded Comet runtime implements it directly; user-installed Agents and the
  connected Comet form use `IAgentRuntimeConnection` and the exact wire
  projection of the same lifecycle. Do not add a second Agent API.
- One Host authority accepts one active runtime registration per Agent ID.
  Registrations declare exact descriptor, capability, Tool Schema Profile, and
  resume-schema revisions and migration edges. Do not dual-register embedded
  and connected implementations or switch runtime form after failure.
- Connected runtime authentication grants registration authority for exact
  Agent IDs and is separate from product-client transport authentication and
  Agent SDK or model-provider credentials.
- Configuration may persist only typed credential references. Before execution,
  bind the exact declared references and installed package secret grants to the
  accepted package, Agent, runtime registration, Session, Chat, and Turn. Raw
  values resolve only through that active Turn authority, are never copied into
  configuration, profiles, catalogs, logs, or diagnostics, and have no
  alternate credential source.
- Agent runtimes own their execution strategy, capabilities, opaque resume
  data, SDK or model-provider calls, event conversion, and Tool projection.
  The Comet runtime owns Comet's model and Tool orchestration loop. Runtimes
  never import Sessions, Workbench Chat, UI, or Agent Host client-connection
  implementations.
- Before attachment and Tool-set preparation, resolve the normalized user or
  product execution selection through the common `IAgent` execution-profile
  port. The result is retry-stable, bounded, immutable, and opaque outside the
  Agent except for exact Agent and model descriptor revisions. It contains no
  secret, Tool set, executor, runtime endpoint, Host deadline, cancellation
  identity, resume state, or SDK-native object. Comet, Copilot, Claude, Codex,
  and later runtimes use this same port.
- The exact accepted Tool-set revision travels with the Turn request. Do not
  add a mutable client-origin Tool list beside the Turn. Agent runtimes project
  the canonical set internally; the Comet runtime consumes it directly and
  invokes Tools through the Host Tool Execution Port. SDK aliases, dynamic
  functions, private MCP bridges, and model-provider formats never change
  canonical Tool identity or executor.
- Editor, Article, Browser, and other higher-layer capabilities cross the Host
  boundary only through typed bounded context, content-resource operations, or
  canonical Tool calls. Their implementations remain with the Feature owner.
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
- Initialization negotiates one explicit protocol version and capabilities.
  Implementation names and build versions are informational and never drive
  feature detection.
- State-bearing channels use authoritative snapshots and contiguous channel
  revisions. A gap or conflict requires explicit resynchronization; clients do
  not apply later actions or infer the missing transition.
- Reconnection uses the same logical client identity, Host sequence, and exact
  subscription set. The Host returns a complete replay or fresh snapshots, and
  missing resources remain explicit.
- Mutating operations reconcile by stable operation ID. Turn submissions also
  bind a payload digest. An uncertain result is reconciled before any resend
  under a new identity.
- Release unloads runtime backing but preserves catalog identity and resume
  state. Delete is a recorded destructive operation and is never implemented
  as release plus hidden catalog removal.
- Turn preparation is Workbench state. Host acceptance commits the user message
  and Turn identity. Completed, cancelled, and failed Turn states are terminal;
  cancellation, steering, permission, and input operations address the exact
  Turn and request.
- A Tool is a model-facing function-call contract. `client`, `host`, `agent`,
  and `mcp` are executor bindings over the same descriptor, call, result, and
  Turn lifecycle. They do not define parallel Tool types.
- Tool registration, executor availability, Turn exposure, target binding, and
  invocation remain separate. Attachments, targets, Skills, commands, focus,
  and Agent identity never expose a Tool implicitly.
- A Tool descriptor defines only canonical model-facing semantics. A Tool
  registration binds one descriptor revision to one exact typed executor
  identity. The accepted Tool-set revision records exact registrations, not
  bare names.
- Tool input and output use versioned Comet Tool Schema Profiles. Agents and
  Comet model implementations declare exact projection capabilities; lossy
  schema conversion or silent constraint removal is forbidden.
- Every model-visible Tool, including fixed SDK-native Tools, appears in that
  canonical Tool set. An Agent declares whether it supports per-Turn Tool sets,
  requires private SDK rebinding, or exposes a fixed set, and incompatible
  selection fails explicitly.
- One Host Tool Execution Port routes every call to its exact registered
  executor. Connected client executors publish and consume only canonical Tool
  data; they are not an SDK conversion layer. The client connection carries
  registrations, calls, cancellation, progress, results, and target
  availability without defining another Tool lifecycle.
- A connected Agent runtime executes Agent reasoning through
  `IAgentRuntimeConnection`; a connected client executor executes one Feature
  Tool. These are distinct endpoints and neither connection owns the other's
  lifecycle.
- Request-scoped interaction targets carry identity, version, and display
  metadata but no content, Tool, permission, or executable handle. Missing
  contributors and targets fail without another route.
- Host-to-client content-resource reads, descriptor synchronization, user-input
  requests, permissions, and other non-model protocol operations are not Tools
  and do not enter the model function-call lifecycle.
- Agent Host message attachments use one generic envelope with a normalized
  common model representation, bounded inline content or content references,
  MIME data, and bounded round-trip metadata. The protocol does not enumerate
  Workbench Feature attachment kinds.
- Pending Workbench composer attachments never cross the Host boundary. Host
  turns contain only producer-resolved attachments bound to an immutable source
  version.
- Attachment transport and media capabilities are explicit. An Agent never
  silently drops an attachment, stringifies an unreadable resource, or retries
  it as another kind.
- Agent and model descriptors declare carrier, structural shape, MIME, count,
  depth, entry, and byte limits. Callers never infer attachment support from
  Agent IDs, model IDs, family names, or display names.
- Turn submission is idempotent by stable submission ID and payload digest.
  Attachment preparation or Host rejection creates no turn; Agent runtime or
  execution-engine failure after Host acceptance completes the committed turn
  as failed.
- Content references declare ownership, version, and availability scope.
  Client-owned references use exact, turn-scoped grants and never expose a
  client-local path as a remote-Host path. Reads are chunked and bounded through
  the content-resource protocol and never require a model Tool call.
- File attachments resolve to immutable `blob` references. Directory
  attachments resolve to immutable bounded `tree` manifests with normalized
  relative entries, explicit enumeration and link policy, and depth, entry,
  per-file, and total-byte limits. A tree never grants live recursive path
  access or includes entries absent from its committed manifest.
- Retry uses the normalized attachments stored on the submitted message. It
  never resolves current Feature state in place of the submitted version.
- Attachments may carry exact immutable content references, but never
  interaction targets, Tool descriptors, or executor bindings. Skills, MCP
  servers, commands, mutation permissions, confirmation policy, Agent
  selection, model selection, and exposed Tool sets remain separate request
  fields.
- Resuming an accepted active Turn requires the same logical runtime identity,
  registration revision, active-operation identities, and an explicitly
  supported resume schema. A released Session or Chat may materialize after an
  atomic package update only when the activated registration supports its
  stored schema or the package transaction committed a migration through the
  common Agent resume-state operation. Migration declares exact schema edges,
  is idempotent by operation, backing, source digest, and target schema, and
  cannot mutate authoritative state before package commit. Missing runtime
  state fails explicitly.
- Optional operations are capability-gated and fail explicitly when
  unsupported.
- Do not branch on Agent IDs for behavior, probe for methods, try another Agent
  or Host after failure, switch runtime packaging, auto-install a package, try
  another package source or revision, or retain a second execution path.
