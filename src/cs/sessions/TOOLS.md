# Tool architecture

## Overview

A Tool is Comet's canonical model-facing function contract. Tool semantics,
Agent integration, and execution location are independent:

```text
Tool contribution registers canonical semantics and one exact executor
    → Agent Host prepares an immutable Tool-set revision for a Turn
    → Agent runtime receives that revision with the accepted Turn request
    → runtime projects it into its SDK, model provider, or orchestration engine
    → model or Agent emits a call
    → owning runtime normalizes the call into one canonical Tool call
    → Agent Host validates and routes it through the Tool Execution Port
    → exact executor returns one canonical Tool result
    → owning runtime returns the result to the model execution
```

The architecture defines one Tool model and one execution lifecycle. `client`,
`host`, `agent`, and `mcp` identify executor routes; they do not define parallel
Tool types.

## Terms

| Term | Meaning |
|---|---|
| Tool descriptor | Versioned canonical capability semantics, schemas, policy, and limits |
| Tool registration | One descriptor revision bound to one exact typed executor identity |
| Tool executor reference | Canonical route to the implementation responsible for one registration |
| Tool-set revision | Host-issued immutable snapshot of exact registrations exposed to one accepted Turn |
| Tool call | One normalized model-facing invocation with stable canonical identity and bounded input |
| Tool result | One terminal success, denial, cancellation, timeout, or failure for the same call |
| Tool Execution Port | Host-owned canonical boundary that invokes the executor named by a registration |
| Connected client executor | An executor reference whose implementation is published by one logical Comet client connection |

A connected client executor is not a special Tool model and does not provide
SDK conversion. Different SDK and model-provider formats are handled inside
their Agent runtimes. Client connection and reconnection affect executor
availability only.

A connected client executor is also distinct from a connected Agent runtime.
The former executes one registered Tool in a Feature owner; the latter runs an
Agent's reasoning or SDK lifecycle through `IAgentRuntimeConnection`. They may
exchange canonical calls and results through Agent Host, but neither connection
is the other one's transport or lifecycle owner.

## Independent axes

The addressed Agent determines how canonical Tools reach the model:

- the Codex runtime projects them into Codex-native functions;
- the Claude runtime projects them into Claude-native or private MCP Tools;
- the Copilot runtime projects them into Copilot SDK Tools;
- the Comet runtime consumes them in Comet's orchestration loop and projects
  them only at its model-provider boundary.

The Tool registration independently determines where a call executes:

- in Agent Host;
- in the addressed Agent runtime;
- through an MCP server;
- through an exact connected Comet client.

Adding an Agent runtime does not change Feature Tool descriptors or
executors. Adding a Tool or executor does not add SDK-format conversion outside
the owning Agent runtime.

## Canonical Tool contract

### Descriptor

A Tool descriptor contains only SDK-neutral semantics:

- stable namespaced Tool ID and contributor ID;
- canonical function name, display name, and bounded model description;
- versioned input and output schemas;
- read, write, or external-effect safety classification;
- confirmation and editable-input policy;
- optional interaction-target requirements;
- input, output, content, timeout, and concurrency limits;
- descriptor revision.

SDK package types, callbacks, native Tool objects, Zod instances, MCP server
objects, provider event payloads, and SDK call handles never enter the
descriptor. A semantic requirement shared across Agents belongs in the
canonical contract rather than opaque provider metadata.

### Registration and executor reference

A registration binds one descriptor revision to one exact executor reference.
The executor reference is canonical routing data, not part of the model-facing
descriptor:

| Executor kind | Exact execution owner |
|---|---|
| `client` | one logical Comet client connection and contributed executor |
| `host` | one Agent Host executor |
| `agent` | one executor owned by the addressed Agent runtime |
| `mcp` | one registered MCP server and Tool identity |

The reference carries the stable identities and authority required by its kind.
An SDK-private MCP bridge used to expose a registration does not change its
executor to `mcp`; SDK encoding never changes canonical ownership.

Duplicate registration identities, conflicting descriptor revisions,
incompatible schema profiles, and invalid executor references are rejected
atomically. Same-named registrations never shadow one another. Routing always
uses the exact registration captured by the accepted Tool-set revision.

### Connected client executors

A Feature implemented in Browser or Workbench may publish a canonical Tool
descriptor and an executor reference through its logical client connection.
The connection:

- publishes exact descriptors and registrations;
- publishes executor and target availability separately from registration;
- receives canonical calls addressed to its exact executor identity;
- dispatches them to the registered Feature implementation;
- returns bounded progress and one canonical terminal result;
- reconciles active call identities after reconnect.

The Feature receives canonical input and returns a canonical result. It never
constructs Codex, Claude, Copilot, or other SDK Tool objects. Browser, Editor,
Article, PDF, and other implementations remain with their Feature owners.

Equivalent clients may publish the same descriptor revision, but each executor
reference remains a separate registration. Tool-set preparation must resolve
the exact registration required by the request. It never merges definitions by
function name, chooses the first client, shadows another registration, or
substitutes a newly connected client for an accepted executor.

Local and remote Host connections use the same connected-executor protocol. A
local connection may carry it in process and a remote connection may serialize
it over transport, but neither calls the Feature through another route.

## Comet Tool Schema Profile

Tool input and output use a versioned Comet Tool Schema Profile. The profile is
a bounded, transport-neutral schema language over canonical protocol values
with explicit schema capabilities. It is not defined by the currently selected
Agent or model provider.

A descriptor declares its schema profile and required features. An Agent and
model descriptor declare which profiles and features they preserve, together
with name, description, schema, input, output, and content limits. Tool-set
preparation validates the exact intersection.

Projection must preserve validation semantics. An Agent runtime or Comet model
implementation never:

- removes a required field;
- widens or narrows a type silently;
- drops an unsupported constraint;
- truncates a description, schema, input, or output to satisfy a provider;
- converts structured output into untyped text unless the canonical descriptor
  explicitly declares that representation;
- retries with another schema profile.

If a provider requires JSON Schema, Zod, MCP Schema, or another native form,
the owning Agent runtime performs that exact projection internally. A
Tool that cannot be represented without loss is rejected before Host
acceptance.

## Tool-set preparation and Turn binding

Registration, executor availability, policy selection, preparation, exposure,
and invocation are distinct states.

Workbench Chat may own visible per-request Tool policy and canonical Tool IDs.
It never owns descriptors, SDK aliases, or executor handles. The addressed
Agent first resolves the normalized execution selection through the common
execution-profile port. During submission preparation, Agent Host resolves
Tool policy against:

- authoritative registrations and descriptor revisions;
- exact executor availability;
- the exact Agent and model descriptor revisions named by that profile;
- Agent and model Tool capabilities;
- schema-profile compatibility;
- bound interaction targets;
- product and permission policy.

The result is one immutable prepared Tool-set revision bound to the submission
ID, Host authority, Agent runtime registration revision, Agent and model
descriptor revisions, execution-profile revision, targets, and exact Tool
registrations. Host acceptance revalidates and records it with the Turn.

The accepted Tool-set revision travels atomically with the `IAgent` Turn
request. A connected runtime receives the same canonical revision through the
Agent Runtime Protocol. The common contract publishes no mutable
origin-specific Tool list beside the Turn. For Comet, the revision belongs to
the Host-owned Turn execution binding rather than the reusable Comet execution
profile. An SDK that requires session-scoped Tool registration,
synchronization, rebinding, or restart performs it inside its Agent runtime
before starting that Turn. A runtime that cannot enforce the exact accepted set
rejects execution explicitly.

Every model-visible Tool appears in the accepted canonical snapshot. Fixed
SDK-native Tools also require canonical descriptors and registrations. An Agent
never adds, omits, or replaces a Tool based on its own identity or an SDK
default.

## Agent runtime integration

`IAgent` is the common Host-side integration contract. It receives normalized
Turn input, including the exact Tool-set revision, and exposes only canonical
Tool calls and results to Agent Host. The product-bundled embedded Comet runtime
implements it directly. User-installed Agents and the connected Comet form use
its language-neutral wire projection through `IAgentRuntimeConnection`; Tool
identity and schemas do not change at that boundary.

An Agent runtime that uses an SDK owns:

- lossless projection into the SDK's native function, Tool, or private MCP
  surface;
- deterministic SDK-visible aliases that satisfy its naming rules;
- a bijective mapping from aliases to exact canonical registrations;
- package-private SDK loading, session binding, rebind, restart, and lifetime
  mechanics after the owning Agent package is activated;
- normalization of SDK call identity, input, progress, and cancellation;
- conversion of canonical results into the matching SDK call;
- truthful projection capabilities and limits.

SDK descriptors, callbacks, call handles, and result objects remain inside the
Agent runtime. Package discovery, installation, update, uninstall, and Agent
activation follow [Agent package architecture](AGENT_PACKAGES.md); a Tool or
Turn path never installs an SDK. Agent Host never routes by a bare SDK name.

The Comet runtime owns Comet's internal model and Tool loop, explicit execution
budgets, normalized prompt construction, and model-provider request conversion.
It may be embedded or supplied by a connected Rust Comet Code runtime. It
consumes the accepted canonical Tool set directly, invokes registrations
through the Host Tool Execution Port, and feeds canonical results back into its
model loop. Runtime packaging does not create another Tool contract or permit
direct Feature callbacks. Its complete orchestration boundary is defined in
[Comet Agent architecture](COMET_AGENT.md).

Comet model-provider formats remain internal to the Comet runtime. They may
encode canonical descriptors and results for a provider API, but they do not
define product Tool identity, policy, execution routing, or Host call state.

## Tool Execution Port

Agent Host owns one canonical Tool Execution Port for every executor kind. It:

- validates the exact Turn, Tool set, descriptor, registration, input schema,
  target, permission, deadline, and call identity;
- resolves the exact executor reference;
- sends bounded canonical input, cancellation, and operation identity;
- records ordered progress and one terminal result;
- validates result schema, status, and bounds;
- commits canonical call state to the addressed Turn;
- returns the result to the addressed Agent execution.

Host, Agent, MCP, and connected-client executors implement this same semantic
contract. Transport and lifetime mechanics may differ behind the port, but
there is no executor-specific Tool call or result model.

When the addressed Agent runtime is connected, its canonical call reaches the
Host through the Agent Runtime Protocol and its canonical result returns over
that same correlated runtime operation. This does not turn the runtime into a
Tool executor. Only a registration whose executor kind is `agent` routes the
actual Tool operation back to an Agent-owned executor.

The executor never selects another Tool, target, client, MCP server, or
implementation. Missing or unavailable registrations fail explicitly. Calls
that mutate state or cause external effects carry a stable operation identity;
after uncertain execution, Agent Host reconciles that exact operation before
any retry.

## Function-call lifecycle

```text
Agent runtime emits execution-engine call identity and input
    → owning runtime resolves the exact canonical registration
    → Agent Host validates Turn, Tool set, descriptor, schema, and target
    → pending confirmation or running
    → Tool Execution Port invokes the exact executor
    → Agent Host validates result schema, status, and bounds
    → completed, denied, cancelled, timed out, or failed
    → canonical result commits to the addressed Turn
    → owning runtime returns the result to the model execution
```

The call addresses one Host authority, Agent, Session, Chat, Turn, Tool-set
revision, Tool ID, descriptor revision, registration, executor, call ID, and
optional target. The Host never reconstructs these identities from a display
name or SDK alias.

Confirmation is scoped to one call and one validated input. Edited input is
validated again. Cancellation is idempotent by canonical call ID. Late
progress or results cannot reopen a terminal call or Turn.

If a connected executor disconnects before execution, the call waits only when
the accepted Turn contract explicitly supports waiting; otherwise it receives
a typed unavailable result. Reconnection reconciles the same logical executor
and call identities. A different client with an equivalent registration is not
the executor of an already accepted call.

## Interaction targets and readable content

An interaction target is request-scoped resource identity that a Tool may
address. It does not contain content, register or expose a Tool, grant
permission, or choose an executor. Tool-set preparation validates that an exact
compatible registration and target are available.

For example, a Browser Feature may register a readable-content Tool with a
connected client executor. Opening an Article from one addressed Chat may bind
the resulting Browser document target. Content is extracted only if the model
calls that exact Tool. The target model and Browser Article flow are defined in
[Interaction target architecture](INTERACTION_TARGETS.md).

## Operations that are not Tools

The following use dedicated contracts rather than the Tool registry:

| Operation | Contract |
|---|---|
| Resolve and submit immutable attachment context | attachment and submission protocol |
| Read a submitted attachment content reference | content-resource protocol |
| Ask the user for structured input | addressed Turn input request |
| Confirm a Tool call | addressed Tool permission request |
| Synchronize registrations, targets, state, or capabilities | Agent Host connection protocol |
| Open an Editor, navigate a Browser, download, or export | Feature service or command |

An SDK or external runtime may encode one of these through a private callback
or reserved Tool-like mechanism. The owning runtime still maps it to the Host
contract. Private encoding does not decide product semantics.

## Attachments and Tools

| Concern | Attachment | Tool |
|---|---|---|
| Trigger | explicit Add to Chat | model or Agent invocation during an accepted Turn |
| Purpose | immutable message context | explicit read, mutation, or external operation |
| Agent visibility | normalized message input | accepted canonical Tool set |
| Content timing | version binds before Host acceptance | result exists only when the call executes |
| Permission | publication and bounded read lease | per-call safety and confirmation policy |
| Persistence | stored with the user message | call and result stored in Turn history |
| Retry | exact submitted content version | exact call and operation reconciliation |

The complete attachment contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Persistence and privacy

Canonical history stores Tool ID, descriptor and Tool-set revisions,
registration and executor attribution, bounded auditable input, confirmation
outcome, terminal result, errors, and target metadata. SDK aliases, native Tool
objects, callbacks, credentials, connection-local handles, and provider event
payloads remain private.

Tool schemas, inputs, outputs, and target metadata are untrusted and bounded.
Sensitive values use explicit redaction and persistence policy. Logs never copy
raw credentials or unrestricted content.

## Module layout

```text
src/cs/platform/agentHost/common/          canonical Tool schemas,
                                           descriptors, registrations, sets,
                                           calls, results, executor references,
                                           permissions, Agent Runtime Protocol,
                                           and Host protocol contracts
src/cs/platform/agentHost/node/            Tool-set preparation, call state,
                                           Tool Execution Port, routing, and
                                           reconciliation
src/cs/platform/agentHost/node/runtime/    connected Agent runtime correlation
                                           and canonical Tool-call transport
src/cs/platform/agentHost/node/agents/comet/
                                           product-bundled embedded Comet
                                           runtime, when selected
src/cs/sessions/contrib/providers/agentHost/
                                           connected-executor publication and
                                           connection integration
Feature-owning Workbench or Sessions contributions
                                           canonical descriptors, targets, and
                                           Feature executor implementations
```

No Feature contribution imports an Agent SDK. Platform Agent Host defines no
Workbench Feature implementation.

## Adding a Tool

1. Define one stable namespaced Tool ID, descriptor revision, schema profile,
   input and output schemas, safety policy, limits, and target requirements.
2. Implement the canonical operation in its owning subsystem.
3. Register one exact typed executor reference.
4. Ensure intended Agent runtimes and Comet model implementations can represent
   the descriptor without semantic loss.
5. Validate Tool-set and descriptor revisions, input, permission, output,
   timeout, cancellation, target, and operation identity.
6. Add local and remote contract tests, SDK or model projection tests, and
   executor disconnect and reconciliation tests where applicable.
7. Do not add Agent-ID routing branches, SDK dependencies to Features,
   name-based shadowing, hidden executor routes, or catch-and-try-next logic.

## Invariants

- Tool semantics, Agent projection, and execution location are separate.
- The architecture has no executor-specific Tool descriptor, call, or result
  type.
- Every model-visible Tool belongs to one accepted canonical Tool-set revision.
- Every model call maps bijectively to one exact canonical registration.
- SDK-specific formats remain inside the owning Agent runtime.
- Agent package installation is separate from Tool preparation and execution;
  neither a Tool nor a Turn can auto-install an SDK-backed Agent.
- The Comet runtime consumes canonical Tools through its orchestration loop,
  regardless of whether that runtime is embedded or connected.
- Every executor receives and returns canonical Tool data only.
- Connected clients are executor endpoints, not a separate Tool abstraction.
- Connected Agent runtimes and connected client executors are distinct
  endpoints with distinct ownership and lifecycle.
- Local and remote Hosts use the same connected-executor semantics.
- Unsupported projection fails before Host acceptance.
- Missing Tools, registrations, mappings, targets, executors, permissions, and
  capabilities fail explicitly; nothing falls back to another route.
