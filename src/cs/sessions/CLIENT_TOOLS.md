# Tool and Client Tool architecture

## Overview

A Tool is a model-facing function-call contract available to an addressed
Agent during a Turn. A Client Tool is not a separate kind of Agent capability;
it is a Tool whose exact executor is a connected Comet client contribution.

`client` therefore describes where the call executes, not who requests it.
The usual caller is the model through an Agent SDK:

```text
accepted Turn captures one exposed Tool-set revision
    → Agent implementation maps Tool descriptors into its SDK
    → model or Agent SDK emits a function/tool call
    → Agent implementation normalizes the call into Agent Host state
    → Agent Host validates and routes it to the bound executor
    → executor returns one bounded Tool result
    → Agent implementation maps that result back into the same SDK call
    → model continues the Turn
```

Agent Host records and routes the call; it does not invent a Tool call because
a Feature, Editor, or attachment is present. A client contribution executes a
Client Tool only after receiving the exact normalized call bound to it.

Client Tools cover model-selected operations such as reading an explicitly
bound Browser document, querying Editor state, or applying a user-approved
edit. They do not include every Host-to-client request.

## Terms

| Term | Meaning |
|---|---|
| Tool descriptor | Canonical Tool ID and function name, description, schemas, policy, limits, executor kind, and revision |
| Tool registration | One descriptor revision bound to one exact executor identity |
| Executor binding | Tagged exact route to one client contributor, Host implementation, Agent implementation, or MCP server |
| Exposed Tool set | Host-issued immutable snapshot of exact registrations made available to one accepted Turn |
| Tool call | One Agent-originated function call with stable call identity and bounded input |
| Tool result | One terminal success, denial, cancellation, timeout, or failure returned to the same call |
| Client Tool | A Tool registration whose executor kind is `client` and whose binding names one connected Comet client contributor |
| Interaction target | Request-scoped identity and version that an exposed Tool may address |

Registration, availability, exposure, invocation, and execution are separate
states. A registered Tool is not automatically exposed to every Agent, model,
Session, Chat, or Turn.

## Executor bindings

Every model-facing Tool uses the same descriptor, call, result, permission, and
Turn lifecycle. An executor binding carries an exact execution identity and one
of four kinds:

| Executor kind | Execution owner | Examples |
|---|---|---|
| `client` | exact connected Comet client contributor | Browser, Article, Editor, PDF, and other client-only Feature operations |
| `host` | Agent Host runtime | Host-owned resource or session operations |
| `agent` | addressed Agent implementation | SDK-native and Agent-private operations surfaced in the Turn |
| `mcp` | exact registered MCP server | MCP-contributed operations |

These are execution bindings, not competing Tool abstractions. An Agent
implementation may translate the same canonical descriptor into an SDK-native
tool, a dynamic function, or an SDK-specific MCP bridge. That translation does
not change the canonical Tool ID or executor binding. In particular, routing a
Client Tool through an SDK's MCP integration does not make the MCP server its
owner.

SDK-internal work that is not exposed as a model-facing function and does not
enter the product Turn is not a Tool in this contract. If an SDK surfaces a
call for a registered model-facing capability, the Agent implementation
normalizes it into the common Tool lifecycle regardless of executor. An SDK
event or field named `tool` is not sufficient to decide product semantics;
reserved input, permission, and other control requests map to their dedicated
Host contracts.

## Operations that are not Tools

The following operations do not enter the canonical Tool registry or generic
Tool-call lifecycle:

| Operation | Owning contract |
|---|---|
| Resolve a pending attachment and bind its immutable version | attachment producer and submission transaction |
| Read or materialize a submitted attachment content reference | Agent Host content-resource protocol |
| Open an Editor, navigate a Browser, download, or export | Feature service or command |
| Ask the user for structured input | addressed Turn input request |
| Confirm a Tool call | addressed Tool permission request |
| Synchronize descriptors, targets, state, or capabilities | Agent Host connection protocol |

An SDK may encode one of these semantic operations using an SDK-private tool or
callback. The Agent implementation still maps it to the owning Host contract;
an SDK mechanism does not turn attachment transport, user input, permission, or
state synchronization into a canonical Tool.

A direct reverse request is not a Client Tool merely because it crosses from a
remote Host to the Comet client. It is a Client Tool only when it is exposed to
the Agent as a model-facing Tool, produces a normalized Tool call, and returns
a Tool result to the Agent SDK.

Attachment content access is deliberately not a function call. Once the Host
accepts an attachment, the Agent implementation can obtain its exact content
through the content-resource protocol while translating the message into SDK
input. It never depends on the model deciding to invoke a readable-content
Tool. The complete content-reference and lease contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Ownership

### Agent Host

Agent Host owns:

- canonical Tool, descriptor revision, executor, call, Turn, and permission-
  request identities;
- descriptor and exposed Tool-set validation;
- input and output schema validation;
- normalized Tool-call state, ordering, cancellation, and terminal results;
- routing to the exact executor binding;
- safety classification and confirmation orchestration;
- connection availability and call reconciliation;
- normalized Tool calls and results in canonical Turn history.

Agent Host does not implement Browser extraction, inspect Editor models, parse
Article records, or call a Feature through another route when its executor is
unavailable.

### Agent implementation

The addressed Agent implementation:

- receives the exact exposed Tool-set revision for the Turn;
- maps canonical descriptors into the SDK's function/tool surface;
- maintains an exact mapping between SDK-visible names and canonical Tool IDs;
- converts SDK call events into normalized Host calls;
- returns normalized results to the matching SDK call;
- keeps SDK-only call IDs, aliases, types, and bridge mechanisms private.

An SDK-visible name may differ because of SDK naming constraints, but the
mapping is bijective within the exposed Tool-set revision. Agent Host never
routes by a bare SDK name, display name, Agent ID, or model family. If an SDK
requires a restart or another private mechanism to install the exact Tool set,
the Agent implementation owns that adaptation without changing Host, Sessions,
or Feature semantics.

### Client Feature contribution

The contribution that owns a Client Tool provides:

- one stable namespaced canonical Tool ID and contributor ID;
- bounded versioned input and output schemas;
- read, write, or external-effect safety classification;
- target requirements and exact target validation;
- execution through the Feature's public service;
- cancellation, timeout, result limits, and typed errors;
- user-facing confirmation details for effects that require approval.

The contribution registers one implementation with the client-side connection
integration. It does not construct an Agent-specific SDK request, add Agent-ID
branches, or expose a second implementation through a hidden local route.

## Registration, availability, and exposure

A canonical Tool descriptor contains:

- stable Tool and contributor identities;
- canonical function name, display name, and bounded model description;
- versioned input and output schemas;
- executor kind and binding requirements;
- safety class, confirmation policy, and editable-input policy;
- interaction-target requirements;
- timeout, input, output, and content limits;
- descriptor revision.

One registration pairs that descriptor revision with an exact executor
identity, such as a logical client contributor, Host implementation, addressed
Agent implementation, or MCP server. The client publishes its Client Tool
descriptors and executor registrations during connection initialization and
through ordered registry changes. Duplicate registration identities,
conflicting non-binding definitions for one canonical Tool ID and revision,
incompatible schema versions, ambiguous SDK-name mappings, and invalid
descriptors are rejected atomically.

Availability means the registration's exact executor can currently accept a
call. Exposure means an allowed registration is included in the Tool-set
snapshot for an accepted Turn and actually supplied to the addressed Agent
SDK. Product policy, user selection, Agent capability, model capability, and
executor availability determine that snapshot explicitly.

Equivalent client instances may publish the same canonical descriptor revision
under different exact executor bindings. They remain separate registrations.
For a target-backed Client Tool, the exact target owner must match the selected
registration. For a target-free Client Tool, request preparation binds the
originating client only when the Tool-selection policy defines that rule;
otherwise it requires an exact registration identity. An unresolved ambiguity
fails before acceptance. A same-named Tool registration never shadows another
registration or becomes its fallback.

When the product offers per-request Tool selection, Workbench Chat owns only
the visible selection policy and canonical Tool IDs for the addressed input as
non-attachment request configuration. It does not copy descriptors or executor
handles. During submission preparation, Agent Host resolves those IDs against
the authoritative registries, capabilities, availability, targets, and policy.
It returns one immutable prepared Tool-set revision bound to the submission ID,
Host authority, Agent and model descriptor revisions, and exact executor
registrations. The final payload digest covers both the requested policy and
that prepared revision.

Preparation is idempotent. Repeating the same submission ID with the same
Agent, model, targets, and Tool policy returns the same prepared revision.
Reusing that ID with different preparation input is a conflict.

Host acceptance revalidates the prepared revision and atomically records it as
the Turn's exposed Tool set. A registry, capability, target, or executor change
that makes it stale rejects submission before acceptance and preserves the
composer. The Host does not silently resolve a newer set under the same
submission ID.

Attachments, interaction targets, Skills, UI commands, and Feature focus never
register or expose a Tool implicitly. MCP discovery may explicitly create or
remove `mcp` registrations through the Tool registry; an MCP configuration
object is not itself a Tool or an exposed Tool set. Binding a target may declare
that the request requires a compatible operation, but the independently
resolved Tool set must already contain that operation. If a promised target
operation cannot be exposed, submission fails before Host acceptance instead
of sending unusable context.

Registry changes affect a later Tool-set snapshot. An accepted Turn retains the
descriptor revisions and executor bindings it was given. An executor that
becomes unavailable during the Turn fails the exact call; the Host does not
replace it with a same-named Tool or another client.

The exposed snapshot accounts for every model-visible generic Tool, including
fixed SDK-native Tools. An SDK-reserved control primitive instead maps to a
dedicated Host operation declared by the Agent's capabilities. An Agent
descriptor declares whether it can install an exact Tool set per Turn, must
rebind or restart private SDK state, or has a fixed set. Agent Host rejects a
selection policy the implementation cannot enforce. An Agent implementation
never leaves an extra model-visible Tool outside the canonical snapshot or
silently omits one that the snapshot contains.

## Interaction targets

An interaction target identifies a resource that a Client Tool may address. It
contains only:

- an opaque target ID and owner contribution ID;
- target type and schema version;
- exact resource identity and resource or document epoch token;
- bounded display metadata;
- connection and availability scope.

A target contains no extracted body, file bytes, DOM object, service instance,
callback, executable code, content lease, Tool descriptor, or permission
approval. Possessing a target does not authorize a read or mutation and does
not expose a Tool.

Workbench Chat owns visible request-scoped targets for one addressed input
separately from attachments. A Feature explicitly binds an exact target to that
input when it establishes the interaction. For example, opening an Article link
from a Chat result in the Editor Browser can bind the resulting Browser document
target to the same Chat input. The UI presents the binding so the meaning of
“this page” is inspectable.

Ordinary send captures the bound identity and epoch in the request's
non-attachment interaction context. It does not read the page or create a
content snapshot. Agent Host stores the bounded target metadata with the
accepted Turn. Dynamic content is acquired only when the Agent produces a call
to an exposed compatible Tool, and the Tool result records the content version
and digest actually read.

General send never scans Editors, chooses a globally active page, or harvests
Editor or Browser content. A Browser opened without an addressed Chat binding
is not implicit context. A separate Use in Chat action can create the binding.

## Function-call lifecycle

One Tool call follows a deterministic lifecycle:

```text
Agent SDK emits call identity, Tool name, and input
    → Agent implementation resolves the canonical descriptor
    → Agent Host validates Turn, Tool-set revision, schema, and target
    → pending confirmation or running
    → exact executor performs the operation
    → completed, denied, cancelled, timed out, or failed
    → bounded result commits to the addressed Turn
    → Agent implementation returns it to the matching SDK call
```

The call addresses one Host authority, Agent, Session, Chat, Turn, Tool-set
revision, canonical Tool ID, descriptor revision, exact registration and
executor binding, call ID, and optional target.
The executor rejects a stale descriptor, unknown target, wrong contributor,
invalid schema, expired version, or mismatched Turn before performing effects.

Confirmation is scoped to one call and one validated input. Edited input is
validated again. Denial is a terminal result returned to the Agent. Approval
does not persist as authority for another call unless a separate explicit
permission policy grants that exact scope.

Cancellation is idempotent by call ID. A completed call cannot be reopened.
Late progress or results are rejected without changing terminal Turn state.

Calls that mutate state or cause external effects carry a stable operation
identity. After an uncertain disconnect, the Host reconciles that call before
any retry. It never repeats an external effect under a new call identity or
routes it to another executor.

## Readable-content Client Tool

Readable content is a model-facing Client Tool implemented by a Feature-owned
extractor. Its input addresses one exact interaction target and includes an
opaque cursor and requested bound. Its result contains normalized readable
chunks, source attribution, the content version read, the next cursor when more
content exists, and exact truncation information.

The extractor owns source acquisition and parsing. Agent Host and Agent SDKs do
not scrape Browser pages or treat Article detail metadata as complete text. An
extractor does not execute scripts contained in the source. Unknown, changed,
expired, denied, or unsupported targets fail explicitly.

The same Feature extraction service may support both immutable attachment
publication and lazy readable-content execution. Those remain different
protocol operations: attachment publication produces an immutable content
reference, while the Client Tool produces a Tool result for a model-issued
call. Sharing an implementation service does not merge their identities,
lifetimes, permissions, persistence, or failure semantics.

### Open Browser Article flow

```text
user opens an Article link from the addressed Chat
    → Editor Browser binds an exact Browser document target to that input
    → user asks about “this article” without attaching it
    → accepted Turn carries target metadata but no article snapshot
    → Agent SDK exposes the readable-content Tool
    → model emits a Tool call if it needs the body
    → Agent Host routes the call to the target's client contributor
    → extractor returns bounded text for that exact document epoch
    → Tool result returns to the model and enters canonical Turn history
```

If no Tool call occurs, Comet does not extract or publish the body. If the user
needs the content to be guaranteed message context independent of Tool choice,
the user explicitly adds a Browser or Article attachment instead.

## Mutation Tools

An interaction target and attachment content grant no mutation authority. An
Editor or Browser mutation uses a separately registered and exposed Tool with
its own write or external-effect classification, input schema, preview,
permission request, executor binding, and call identity.

Binding a target does not enable that Tool. Adding an attachment neither binds
a live interaction target nor registers, exposes, or approves a Tool. A
workflow that intentionally needs both uses two explicit contracts.

## Attachments and Client Tools

| Concern | Attachment | Client Tool |
|---|---|---|
| Trigger | explicit Add to Chat | model or Agent SDK function call during an accepted Turn |
| Purpose | immutable message context | explicit read, mutation, or external operation |
| Agent visibility | part of normalized message input | part of the exposed Tool set |
| Content timing | version and availability bind before Host acceptance | result is produced only when the call executes |
| Client transport | content-resource protocol for a client-owned reference | normalized Tool-call routing to a client executor |
| Failure before Turn | blocks submission and preserves composer | not applicable |
| Permission | bounded publication and read lease | per-call read, write, or external-effect policy |
| Persistence | normalized envelope stored with user message | call and result stored in Turn history |
| Retry | exact submitted content version | no automatic effect replay; every new call has its own identity |

The complete attachment contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Connection loss and unavailable clients

Client Tool descriptors and targets declare their connection dependency. If
the bound client disconnects before a call starts, the call waits only when the
Agent and Turn contract explicitly supports waiting; otherwise it fails with a
typed unavailable result. Agent Host never routes it to another client or
substitutes a Host implementation.

After reconnection, the same logical client republishes descriptor and target
availability. The Host reconciles active call IDs and descriptor revisions
before resuming. A target whose exact identity or epoch cannot be
re-established remains unavailable.

## Persistence and privacy

Canonical Turn history stores normalized Tool identity, executor attribution,
bounded input required for audit, confirmation outcome, bounded result, errors,
and target metadata. It does not persist live callbacks, credentials,
permission tokens, DOM state, service objects, or connection-local handles.

Tool inputs, outputs, and target metadata are untrusted and size-bounded.
Sensitive values use explicit redaction and persistence policy in the Tool
schema. Logs do not copy raw credentials or unrestricted document bodies.

## Module layout

```text
src/cs/platform/agentHost/common/          Tool descriptors, executor bindings,
                                           calls, results, targets, permissions,
                                           and protocol contracts
src/cs/platform/agentHost/node/            Host orchestration and Agent SDK Tool
                                           translation
src/cs/workbench/contrib/chat/common/      addressed interaction-target model
                                           and public API
src/cs/sessions/contrib/providers/agentHost/
                                           Client Tool publication and routing
Feature-owning Workbench or Sessions contributions
                                           client descriptors, targets, and
                                           implementations
```

Platform Agent Host defines no Workbench Feature implementation. The shared
Sessions provider routes canonical protocol values and consumes only public
Chat and Feature registration contracts. Attachment content-resource contracts
remain owned by the architecture defined in `ATTACHMENTS.md` and do not enter
the Tool registry.

## Adding a Client Tool

1. Define one stable namespaced canonical Tool ID, schemas, safety class,
   limits, target requirements, and `client` executor binding.
2. Implement the operation in the contribution that owns the public Feature
   service.
3. Register the descriptor and implementation through the client-side Host
   connection integration.
4. Ensure every Agent implementation can map the canonical descriptor and result
   without exposing SDK types or changing executor identity.
5. Validate exact target identity, descriptor and Tool-set revisions,
   permission, input, output, timeout, and cancellation.
6. Add local and remote contract tests, including SDK mapping, disconnect,
   stale targets, denial, cancellation, duplicate call IDs, and uncertain
   effects.
7. Do not add an Agent-ID branch, Feature import in Platform Agent Host, hidden
   local implementation, content-resource alias, or catch-and-try-next route.

## Invariants

- A Client Tool is a model-facing Tool whose exact executor is a connected
  Comet client contributor.
- Executor location and SDK exposure mechanism do not change canonical Tool
  identity.
- Registration, availability, exposure, target binding, and invocation remain
  separate states.
- A request-scoped target carries identity, not content, permission, or a Tool.
- Content-resource reads for submitted attachments are not Tool calls.
- No model or Agent SDK call means no lazy content extraction or Tool effect.
- Every call addresses one contributor, Turn, Tool-set revision, Tool
  descriptor revision, and optional target.
- Tool calls and terminal results are ordered canonical Host state and return
  to the matching Agent SDK call.
- Mutation and external effects require their own safety and confirmation
  policy.
- Local and remote Hosts use the same Tool protocol.
- Missing contributors, clients, targets, versions, permissions, and
  capabilities fail explicitly; nothing falls back to another Tool, client,
  target, executor, or protocol.
