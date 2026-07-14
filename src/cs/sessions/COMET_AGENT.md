# Comet Agent architecture

## Overview

Comet Agent is Comet's product-owned general Agent. It has stable Agent ID
`comet`, is supplied by the bundled `comet` Agent package, and is the only
Agent installed by default.

Comet Agent uses the same Agent Host contracts as every optional Agent. Its
special status is product distribution and ownership, not a private Sessions,
Chat, Tool, attachment, or transport API.

```text
accepted Host Turn
    → Comet runtime
        → build exact model input
        → call exact configured model endpoint
        → normalize response or Tool calls
        → invoke canonical Tools through Agent Host
        → feed canonical results into the next model step
        → emit one terminal Turn outcome
```

The Comet runtime may be an embedded implementation or a connected Rust Comet
Code runtime. A Host composition chooses exactly one form and registers it
through the common Agent Runtime Port.

## Product contract

The bundled Comet package is installed and activated by product composition.
Users do not need an Agent package installation operation before creating a
Comet Session. Ordinary Agent package operations cannot uninstall Comet; its
revision changes with the Comet product distribution through the same
package-wide quiesce, resume migration, and atomic activation transaction used
for package updates. Product distribution retains the previous Comet endpoint
until that transaction commits.

Being installed does not imply that a usable model endpoint or credentials
exist. Agent authentication state describes only authentication of the Agent
runtime registration; the bundled embedded Comet runtime requires none. A
model descriptor's enabled state describes product-catalog availability, not
the presence of its referenced provider secret. Credential material is neither
probed nor cached as model discovery state and resolves only for an accepted
Turn. If no exact model execution profile or credential can be resolved, the
addressed Turn fails explicitly; Comet does not select an unrelated provider,
credential, runtime, or Agent. Empty Session creation remains governed by the
ordinary Host capability.

Package lifecycle is defined in
[Agent package architecture](AGENT_PACKAGES.md). The Host-facing runtime,
Session, Chat, Turn, connection, and resume contracts are defined in
[Agent Host architecture](AGENT_HOST.md).

## Ownership

| Owner | Responsibilities |
|---|---|
| Agent Host | Agent registration; Session, Chat, Turn, Tool-call, permission, input-request, operation, and canonical history state |
| Comet runtime | prompt construction, context policy, model execution profiles, orchestration steps, model and Tool loop, provider projection, usage accounting, and opaque checkpoints |
| Model endpoint implementation | exact provider request/stream protocol and credential use selected by the Comet runtime |
| Tool executor | the canonical Feature, Host, Agent, or MCP operation addressed by one Tool registration |
| Feature content owner | immutable attachment publication and bounded content-resource reads |

Comet never imports Sessions services, Workbench Chat, Editor, Browser, PDF,
Fetch, or Feature implementations. It receives normalized Host values and uses
the content-resource and Tool ports. Agent Host never interprets Comet's
private plan, provider messages, SDK objects, or model cache.

Comet does not own Agent package installation. Once its bundled package is
activated, the runtime owns only its execution-engine and package-private SDK
or model-provider lifecycle.

## Execution profile and Turn binding

The Comet execution profile is Comet's implementation of the common Agent
execution-profile envelope; it is not a second Comet-only request contract.
Agent Host invokes the common resolution operation with the exact Comet runtime
registration, stable submission, and normalized user or product selection.
Comet returns one bounded immutable profile before attachment and Tool-set
preparation. Its common envelope names exact Agent and model descriptor
revisions. Agent Host binds the separately resolved model configuration to the
same accepted Turn, while the opaque profile body contains only Comet-owned
execution choices:

- the exact model runtime and provider-projection revision corresponding to the
  envelope's model descriptor revision;
- the exact Comet instruction-profile revision;
- reasoning, response, and provider settings supported by that model;
- Agent-owned step, token, context, and concurrency budget policy, subsequently
  constrained by the Host ceilings in the Turn binding;
- the exact provider-projection behavior required by the selected model.

Agent Host validates the envelope and separately creates one immutable Turn
execution binding after request preparation. It contains:

- the complete bounded Comet execution-profile envelope;
- the complete resolved model configuration and its exact schema revision;
- the exact typed credential references authorized for this Turn;
- the exact Agent runtime registration revision;
- the accepted canonical Tool-set revision, including its Tool Schema Profile;
- Host policy ceilings, accepted deadline, cancellation identity, and output
  constraints;
- the optional opaque resume state and its schema ID.

The execution profile never contains a secret, Tool-set revision, executor,
runtime registration, Host deadline, cancellation identity, or resume state.
Those values have one authority in the accepted Host Turn binding. Comet
validates their correlation but does not publish a second copy. Resolution is
side-effect-free and retry-stable for the same submission, selection digest,
and runtime registration.

A new Chat request identifies either an explicit user model selection or one
explicit product-provisioned Comet profile-preset ID. That selection must
resolve to one exact profile before use; a failed user selection is not retried
through the product preset. Catalog order, display name, model family, last
successful provider, and installed SDKs never choose a model implicitly. A
later model change creates a new profile revision and affects only Turns that
bind it.

Product composition owns the exact Comet model catalog and automatic preset.
Each model descriptor publishes its own model-configuration schema with one
fixed HTTPS provider endpoint, provider-native model identity, and exact typed
credential reference as complete validated values. These values cannot be
recombined across product-owned model descriptors. The configuration-schema
revision content-addresses the complete schema. The model-descriptor revision
content-addresses that schema together with the runtime identity, provider
protocol settings, and attachment capabilities. Provider-specific request
controls remain opaque execution-profile data interpreted by that model
runtime. Comet does not derive Agent Host models from the general application
settings object, SDK discovery, credential presence, or a mutable provider
registry.

Secrets are referenced through the Agent credential boundary and are not
stored in Chat configuration, model configuration, Turn input, package
manifests, execution profiles, or opaque resume data. Each model step resolves
only the reference bound to its exact package, runtime registration, Session,
Chat, and Turn. Model availability is validated before Host acceptance where
possible. If the exact endpoint or credential becomes unavailable after
acceptance, the committed Turn fails; it is not rerouted to another model,
provider, runtime, credential source, or Agent.

The Host supplies hard policy ceilings and the accepted deadline. Comet may
allocate smaller per-step budgets inside those ceilings, but it records the
effective allocation before the corresponding step. Exhaustion ends the Turn
with an explicit terminal outcome rather than silently increasing a limit.

## Accepted Turn input

Comet receives one normalized `IAgent` request containing:

- exact Host, Agent, Session, Chat, Turn, submission, and operation identities;
- the accepted user message and relevant canonical Chat history;
- normalized attachments and their immutable content references;
- explicitly bound interaction targets;
- the immutable Host Turn execution binding, containing the resolved Comet
  profile envelope, resolved model configuration, credential references,
  runtime registration, canonical Tool-set, deadline, cancellation, output,
  and optional resume-state authorities;
- current permission, cancellation, steering, and user-input operation state.

The request is the complete execution authority. Comet does not query the
active Editor, visible Browser, selected Article checkboxes, composer DOM,
currently focused Part, local filesystem paths, or other ambient Workbench
state. It does not reconstruct a Tool set or attachment list from Agent ID,
prompt text, or previous UI state.

## Orchestration lifecycle

Comet uses one explicit state machine inside the accepted Host Turn:

```text
initialize exact execution profile and Host Turn binding
    → materialize accepted attachment context
    → compose provider-neutral model input
    → project exact canonical Tool set
    → execute model step
        ├── terminal response → complete Host Turn
        ├── canonical Tool calls
        │       → Host Tool Execution Port
        │       → canonical results
        │       → checkpoint and next model step
        └── error, cancellation, or budget exhaustion → terminal Host outcome
```

Before the first model request, Comet validates that its runtime, model
endpoint, schema profile, attachment carriers, and Tool projection can
represent the accepted request without semantic loss. Validation after Host
acceptance produces a failed Turn; it never edits the committed request.

For each model step Comet:

1. builds provider-neutral input from canonical history, the current user
   message, accepted context, prior model output, and canonical Tool results;
2. projects that input and every exposed Tool into the exact selected model
   protocol inside the runtime;
3. emits bounded reasoning, response, usage, and checkpoint actions to Agent
   Host as the model stream progresses;
4. maps every model call bijectively to one canonical Tool registration;
5. invokes the call through the Host Tool Execution Port and waits for its
   canonical terminal result;
6. records budget consumption and feeds the result into the next exact model
   step, or commits one terminal response.

Comet may execute multiple model and Tool steps, but they remain substate of
one Host Turn. It does not create synthetic user turns, hidden Tool calls, or a
second transcript. Provider-native fixed Tools are usable only when represented
in the accepted canonical Tool set.

Context compaction, summarization, or retrieval is Comet orchestration policy.
When enabled by the bound execution profile, it is deterministic for that
revision and records sufficient checkpoint metadata to reproduce or explain
the selected context. It never silently discards a required attachment, Tool
result, system constraint, or user message to make a provider request fit.

## Attachments, targets, and Tools

Accepted attachments are explicit message context. Comet materializes their
bounded content references through the Host content-resource protocol before
or during input construction according to the attachment contract. Reading an
accepted attachment is not a model Tool call.

Interaction targets are different: they carry request-scoped identity and
version but no content. Comet can obtain target content only by invoking an
exact Tool that was independently registered, exposed in the accepted Tool
set, and bound to that target.

Every model-selected operation uses the canonical Tool lifecycle described in
[Tool architecture](TOOLS.md). Comet owns only lossless model-provider
projection and call correlation. It never keeps Feature callbacks, invokes a
connected client directly, or treats package installation, Browser navigation,
download, export, permission, or user input as an implicit Tool.

Attachment and interaction-target semantics are defined in
[Attachment architecture](ATTACHMENTS.md) and
[Interaction target architecture](INTERACTION_TARGETS.md).

## Workers and Agent boundaries

Comet may decompose a Turn into private reasoning steps, parallel model work,
or Agent-owned worker conversations. Private steps remain opaque orchestration
state. A worker conversation that must be visible or resumable is published as
an ordinary Tool-origin Chat owned by the same Comet Agent and uses the Host
Chat lifecycle.

Installed Agents are peer runtime registrations. The Comet runtime does not
call Claude, Codex, Copilot, or another registered Agent implicitly, and an
installed Agent is not automatically a Comet Tool. Cross-Agent delegation
would require an explicit product protocol with its own ownership, permission,
identity, lifecycle, and persistence rules; it is not inferred from package
installation or SDK availability.

## Embedded and Rust connected runtimes

The embedded Comet runtime implements `IAgent` directly under Platform Agent
Host. A Rust Comet Code runtime implements the same semantics through the
language-neutral Agent Runtime Protocol and `IAgentRuntimeConnection`.

Both forms must:

- use Agent ID `comet` and one exact runtime registration revision;
- consume the same accepted Turn, attachment, target, and Tool contracts;
- emit the same canonical ordered actions and typed terminal outcomes;
- use the Host Tool Execution Port and content-resource protocol;
- expose truthful model, schema, attachment, queue, steering, and resume
  capabilities;
- pass the same Agent and orchestration conformance tests.

The Rust package owns its process, native dependencies, provider clients, and
private storage implementation. Agent Host owns launch authorization,
connection negotiation, operation correlation, and runtime registration. No
Comet-specific IPC command, Sessions provider, Tool bridge, or alternate
request payload exists beside the Agent Runtime Protocol.

One Host composition selects embedded or connected Comet before registration.
It never registers both, probes for one after the other, or switches forms
after a failure. Moving the implementation from TypeScript to Rust therefore
changes package composition, not public Agent Host or Sessions contracts.

## Cancellation, steering, and effects

Cancellation and steering address the exact active Host Turn. Comet observes
them through `IAgent`, stops or updates the exact execution when its declared
capability permits, and emits the corresponding ordered action. It never
emulates steering with a synthetic user message or treats transport loss as
user cancellation.

Before or after an effectful Tool call, checkpoints retain its canonical call
and operation identities. On resumption, Comet and Agent Host reconcile that
same effect before continuing. An uncertain effect is never repeated under a
new identity, and a failed model or Tool step never selects another executor or
model as recovery.

## Persistence and resumption

Agent Host persists canonical Session, Chat, Turn, Tool-call, permission, and
normalized response history. Comet persists or returns opaque bounded state
needed to continue its own execution, including execution-profile revision,
provider conversation correlation, orchestration position, consumed budgets,
and canonical Tool-call correlation.

Every opaque checkpoint carries a Comet resume-schema ID. It contains no raw
credentials, Workbench objects, Feature callbacks, client-local paths, or
unbounded provider event log. An accepted active Turn resumes only under the
same logical Comet registration revision with explicit support for that schema.
A released Session or Chat may materialize after an atomic Comet package update
only when the new registration explicitly supports its stored schema or the
package update committed a migration through the common Agent resume-state
operation. Comet declares exact source and target schema edges and returns a
new opaque value into package-operation staging; it never mutates committed
state during validation. Otherwise the Session or Turn is unavailable or
failed according to its committed Host state; no unqualified runtime, model,
or Agent receives the checkpoint.

## Module layout

```text
src/cs/platform/agentHost/
├── common/                    IAgent and Agent Runtime Protocol contracts
└── node/
    ├── agents/comet/          embedded Comet runtime, when selected
    ├── packages/              bundled Comet package activation
    └── runtime/               generic connected-runtime support
```

The Rust Comet Code source and build may live outside the TypeScript Agent Host
module. Its package entry point is an implementation detail; the only Host
integration surface is the Agent Runtime Protocol.

## Verification

Comet conformance covers:

- exact execution-profile resolution and Host Turn binding;
- common-profile conformance shared with other Agent runtimes;
- prompt and attachment input construction within declared limits;
- lossless Tool projection and canonical call/result correlation;
- multi-step model and Tool orchestration with explicit budgets;
- cancellation, steering, permission, input, and terminal-state ordering;
- effect reconciliation and exact checkpoint resumption;
- idempotent staged resume migration and atomic package activation;
- embedded and connected runtime behavioral equivalence;
- unavailable model, credential, Tool, content, runtime, and resume-schema
  failures without another route.

## Invariants

- Comet has stable Agent ID and package ID `comet` in distinct namespaces.
- Comet is the only bundled and default-installed Agent.
- Comet uses the same Agent Host, Session, Chat, Turn, attachment, target, and
  Tool contracts as optional Agents.
- Exactly one embedded or connected Comet runtime is registered per Host.
- The Comet runtime owns orchestration; Agent Host owns canonical product
  lifecycle and state.
- Every Turn binds one exact Comet execution profile and one Host-owned Turn
  execution binding containing the accepted Tool-set revision.
- SDK and model-provider formats remain private to the Comet runtime.
- Accepted attachments are read as context; interaction targets require exact
  Tool calls.
- Internal steps do not create hidden Host Turns or implicit cross-Agent calls.
- Runtime, model, provider, Tool, executor, package, and resume failures are
  explicit and never select another path.
