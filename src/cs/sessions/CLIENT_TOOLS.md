# Client Tool architecture

## Overview

A Client Tool is a canonical Tool registration whose executor is one exact
connected Comet client contributor. It lets a model call a bounded Feature
operation without moving Browser, Editor, Article, PDF, or other Workbench
implementations into Agent Host or an Agent SDK.

A Client Tool is not the SDK protocol-conversion boundary. Every Agent SDK
uses its own Agent Tool Port to project all canonical Tools, including Client
Tools, into that SDK. The common Tool model, schema profiles, Tool-set
preparation, Agent Tool Port, call state, and result lifecycle are defined in
[Tool architecture](TOOLS.md).

```text
Feature contribution registers a canonical Tool with a client executor
    → Agent Host exposes that exact registration in a Turn's Tool set
    → Agent Tool Port projects it into the addressed SDK
    → model or Agent SDK emits a call
    → Agent Tool Port produces one canonical Tool call
    → Agent Host routes it to the exact contributing client
    → Feature executes through its public service
    → canonical Tool result returns through the Agent Tool Port
```

## Boundary

| Concern | Owning contract |
|---|---|
| Canonical Tool semantics, schema, Tool set, call, and result | Tool architecture |
| SDK function format, aliases, callbacks, and result encoding | addressed Agent Tool Port |
| Exact client execution identity and reverse call routing | Client Tool registration and Client Tool Execution Port |
| Browser, Editor, Article, PDF, or other operation | owning Feature contribution |
| Submitted attachment content | attachment and content-resource protocol |

The Agent Tool Port is SDK-specific but executor-neutral. The Client Tool
execution protocol is executor-specific but SDK-neutral. Neither imports nor
implements the other.

Client Tools cover model-selected operations such as reading an explicitly
bound Browser document, querying client-only Editor state, or applying a
user-approved edit. A Host-to-client message is not automatically a Client
Tool. It is a Client Tool only when it originates as an exposed canonical Tool
call and returns a canonical Tool result to the Agent SDK.

## Operations that are not Client Tools

These client interactions use their own protocols:

| Operation | Why it is separate |
|---|---|
| Publish or read an attachment content reference | deterministic message context, not a model-selected action |
| Synchronize Tool descriptors or targets | registry and connection state, not a Tool call |
| Ask the user for input | addressed Turn input request |
| Present Tool confirmation | addressed permission request |
| Open an Editor, navigate, download, or export | direct Feature command |

An SDK-private MCP bridge used to expose a Client Tool is also not the Client
Tool executor. It is only an implementation mechanism inside that Agent Tool
Port. Canonical executor ownership remains `client`.

## Ownership

### Feature contribution

The contribution that owns a Client Tool provides:

- one stable namespaced canonical Tool ID and contributor ID;
- a Tool descriptor using the Comet Tool Schema Profile;
- a `client` executor registration for the exact logical contributor;
- optional interaction-target type and validation;
- execution through the Feature's public service;
- cancellation, timeout, result limits, and typed failures;
- user-facing effect and confirmation details required by canonical policy.

The contribution never constructs Codex, Copilot, Claude, or other SDK Tool
objects. It receives canonical input and returns a canonical result. Adding a
new Agent SDK never changes the Feature implementation.

### Client Tool Execution Port

The client-side Agent Host integration is the Client Tool Execution Port. It:

- publishes exact Client Tool descriptors and registrations;
- publishes target availability separately from Tool registration;
- receives canonical calls addressed to its logical client identity;
- dispatches each call to the exact registered Feature implementation;
- returns progress and one terminal canonical result;
- reconciles active call identities after reconnect.

It does not reinterpret Tool semantics, choose another Feature, or convert
canonical Tools into an Agent SDK format.

Local and remote Host connections use this same canonical execution contract.
A local connection may carry it in process and a remote connection may
serialize it over transport, but neither bypasses the port by calling a
Feature through a separate route.

### Agent Host

Agent Host owns registration validation, Tool-set exposure, canonical call
state, permission orchestration, exact executor routing, terminal results, and
reconciliation. It never imports Feature implementations or SDK Tool types.

### Agent implementation

The Agent implementation handles Client Tools only through the same Agent Tool
Port used for every canonical Tool. It projects descriptors into its SDK,
normalizes calls, and returns results. It never invokes Browser, Editor,
Article, PDF, or other client services directly.

## Registration and availability

A Client Tool registration pairs one canonical descriptor revision with:

- executor kind `client`;
- exact logical client connection identity;
- exact Feature contributor identity;
- availability and authorization scope;
- supported target types when applicable.

Registration, current availability, Turn exposure, target binding, permission,
and invocation are independent states. Registering a Client Tool does not expose
it to every Agent or Turn. Binding a target does not register or expose a Tool.

Equivalent clients may publish the same canonical descriptor revision, but
each exact executor binding remains a separate registration. For a Tool backed
by a target, the selected registration must own that target. For a target-free
Tool, submission preparation must resolve one exact client registration from
explicit Tool policy and request origin. Ambiguity fails before Host acceptance.

The Host never merges Client Tools by function name, picks the first client,
lets one registration shadow another, or replaces a disconnected executor with
a same-named registration. The accepted Tool-set revision stores the exact
registration used by the Turn.

## Interaction targets

An interaction target identifies a client-owned resource that an exposed
Client Tool may address. It contains only:

- opaque target ID and owner contributor ID;
- target type and schema version;
- exact resource identity and resource or document epoch;
- bounded display metadata;
- logical client and availability scope.

A target contains no document body, file bytes, DOM object, service instance,
callback, Tool descriptor, SDK object, content lease, executable code, or
permission approval. Possessing a target neither exposes a Tool nor authorizes
an operation.

Workbench Chat owns visible request-scoped targets for one addressed input,
separately from attachments and Tool policy. A Feature binds a target only
through an explicit addressed interaction. Ordinary send captures that exact
identity and epoch; it never scans globally active Editors or Browsers.

For example, opening an Article link from one addressed Chat in the Editor
Browser may bind the resulting Browser document target to that same Chat input.
Opening a page without an addressed Chat relationship creates no implicit
target. A separate Use in Chat action can bind it explicitly.

## Client execution lifecycle

After the Agent Tool Port emits a canonical Client Tool call, Agent Host:

```text
validates Turn, Tool set, registration, schema, and target
    → obtains per-call confirmation when canonical policy requires it
    → publishes one running call to the exact logical client
    → client connection dispatches to the registered Feature executor
    → Feature validates current target identity and performs the operation
    → client returns progress and one terminal canonical result
    → Agent Host validates result schema, status, and bounds
    → Agent Host commits the result to the addressed Turn
    → addressed Agent Tool Port returns it to the SDK call
```

The client receives canonical Tool ID, descriptor and Tool-set revisions,
registration ID, call ID, bounded input, optional target, operation identity,
deadline, cancellation, and permission outcome. It does not receive an SDK Tool
object or infer identity from an SDK-visible name.

The executor rejects an unknown registration, wrong client, wrong contributor,
stale descriptor, invalid input, expired target, mismatched Turn, or reused
effect identity before execution. A terminal call cannot be reopened by late
progress or a second result.

## Readable-content Client Tool

Readable content is a model-facing Client Tool implemented by a Feature-owned
extractor. Its input addresses one exact interaction target and includes a
cursor and requested bound. Its canonical result contains normalized readable
chunks, source attribution, the content version read, the next cursor when more
content exists, and exact truncation information.

The extractor owns acquisition and parsing. Agent Host and Agent SDKs do not
scrape Browser pages or treat Article metadata as complete content. The
extractor does not execute scripts from the source. Unknown, changed, expired,
denied, or unsupported targets fail explicitly.

The same Feature extraction service may support immutable attachment
publication and lazy Client Tool execution. Those remain separate protocols:
attachment publication produces a version-addressed content reference, while
the Client Tool produces a canonical result for a model-issued call. Sharing
the extraction service does not merge their identities, lifetimes,
permissions, persistence, or failure semantics.

### Open Browser Article flow

```text
user opens an Article link from the addressed Chat
    → Editor Browser binds one exact document target to that Chat input
    → user asks about the opened article without attaching it
    → accepted Turn contains target metadata and an exposed Tool registration
    → Agent Tool Port projects the readable-content Tool into the SDK
    → model calls it if complete content is needed
    → Agent Host routes the canonical call to the target-owning client
    → extractor returns bounded content for that exact document epoch
    → canonical result returns to the model and enters Turn history
```

No call means no lazy extraction. If content must be guaranteed message context
independently from model choice, the user explicitly adds a Browser or Article
attachment instead.

## Mutation and external effects

An interaction target or attachment grants no mutation authority. A client
mutation uses a separately registered and exposed Client Tool with its own
write or external-effect classification, input schema, preview, permission
request, executor binding, and stable operation identity.

Edited confirmation input is validated again. After uncertain execution or
disconnect, Agent Host reconciles the exact call and operation before retry. It
never repeats an effect under a new identity or routes it to another client.

## Attachments and Client Tools

| Concern | Attachment | Client Tool |
|---|---|---|
| Trigger | explicit Add to Chat | model or Agent SDK call during an accepted Turn |
| Purpose | immutable message context | explicit client-owned operation |
| Agent visibility | normalized message input | canonical exposed Tool set |
| SDK conversion | attachment projection owned by Agent implementation | generic Agent Tool Port |
| Client transport | content-resource request for a client-owned reference | canonical Tool-call execution protocol |
| Content timing | version binds before Host acceptance | result exists only when the call executes |
| Permission | publication and bounded read lease | per-call Tool safety and confirmation policy |
| Persistence | stored with the user message | call and result stored in Turn history |
| Retry | exact submitted content version | exact call/effect reconciliation; no automatic replay |

The complete attachment contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Connection loss

Client Tool registrations and targets declare their logical client dependency.
If that client disconnects before execution, the call waits only when the Turn
contract explicitly supports waiting; otherwise it receives a typed unavailable
result. Agent Host does not route it to another client or Host implementation.

After reconnection, the same logical client republishes descriptor and target
availability and reconciles active canonical call IDs before resuming. A new or
different client with equivalent registrations is not the executor of an
already accepted call. A target whose exact identity or epoch cannot be
re-established remains unavailable.

## Persistence and privacy

Canonical history stores Tool and registration identity, client executor
attribution, bounded auditable input, permission outcome, terminal result,
errors, and target metadata. It does not store live callbacks, DOM state,
service objects, credentials, SDK aliases, or connection-local handles.

Client Tool input, output, and target metadata are untrusted and bounded.
Feature schemas declare redaction and persistence policy. Logs never copy raw
credentials or unrestricted document bodies.

## Module layout

```text
src/cs/platform/agentHost/common/          client executor bindings, execution
                                           messages, calls, results, targets,
                                           permissions, and protocol contracts
src/cs/workbench/contrib/chat/common/      addressed interaction-target model
                                           and public Chat API
src/cs/sessions/contrib/providers/agentHost/
                                           Client Tool publication, reverse
                                           routing, and connection integration
Feature-owning Workbench or Sessions contributions
                                           canonical descriptors, targets, and
                                           client implementations
```

SDK-specific Agent Tool Ports remain under the owning Agent implementation as
defined in [Tool architecture](TOOLS.md). Platform Agent Host defines no
Workbench Feature implementation.

## Adding a Client Tool

1. Define one canonical Tool descriptor, schema profile, safety policy, limits,
   and target requirements.
2. Implement the canonical operation in the contribution that owns the public
   Feature service.
3. Register its exact descriptor with an executor binding of kind `client`
   through the client-side Agent Host connection integration.
4. Ensure intended Agent Tool Ports can project the descriptor without changing
   its semantics or executor identity.
5. Validate target, registration, Tool-set and descriptor revisions, input,
   permission, output, timeout, cancellation, and operation identity.
6. Add local and remote contract tests for registration, SDK projection,
   disconnect, stale targets, denial, cancellation, duplicate calls, and
   uncertain effects.
7. Do not add an Agent-ID branch, SDK dependency in the Feature, hidden local
   implementation, name-based route, or catch-and-try-next path.

## Invariants

- A Client Tool is a canonical Tool whose exact executor is a connected Comet
  client contributor.
- A Client Tool is not the SDK protocol-conversion port.
- Every Agent SDK projects Client Tools through its generic Agent Tool Port.
- The Client Tool Execution Port receives and returns canonical Tool data only.
- Local and remote Hosts use the same Client Tool execution semantics.
- Feature implementations consume and return only canonical Tool data.
- Registration, availability, exposure, target binding, permission, and
  invocation remain separate.
- Interaction targets carry identity, not content, Tool definitions,
  permission, or executable handles.
- Content-resource reads for submitted attachments are not Client Tool calls.
- No model or Agent SDK call means no lazy Client Tool operation.
- Every call routes to one exact accepted client registration.
- Missing clients, registrations, mappings, targets, versions, permissions, and
  capabilities fail explicitly; nothing falls back to another executor or
  protocol.
