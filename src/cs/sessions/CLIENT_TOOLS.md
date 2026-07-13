# Client Tool architecture

## Overview

Client Tools let an Agent invoke bounded capabilities that are implemented by
the connected Comet client and its Workbench Features. They cover operations
such as reading an explicitly addressed Browser document, extracting readable
Article content, querying Editor state, or applying a user-approved edit without
importing those Feature types into Agent Host or an Agent SDK.

```text
Agent requests one registered tool
    → Agent Host creates an addressed tool call
    → IAgentHostConnection routes it to the contributing client
    → Feature owner validates target, input, permission, and limits
    → Feature owner uses its public service
    → bounded typed result returns to the same Turn and tool call
```

A Client Tool is not an attachment. An attachment supplies immutable user-
selected context to a message. A Client Tool performs an explicit operation
during a Turn. Either may refer to the same source, but registration,
availability, authority, lifetime, persistence, and failure are independent.

## Tool classes

Agent Host distinguishes tool ownership without changing the Turn protocol:

| Class | Execution owner | Examples |
|---|---|---|
| Host tool | Agent Host runtime | Host resource and terminal operations |
| Agent tool | addressed Agent | SDK-native tools and Agent-private operations |
| MCP tool | registered MCP server | server-contributed tool contracts |
| Client Tool | connected Comet client | Browser, Article, Editor, PDF, and client-only Feature operations |

All classes produce the same ordered tool-call lifecycle in the Chat Turn. The
tool descriptor identifies its contributor and execution surface; the Host
never infers ownership from the tool name or Agent ID.

## Ownership

### Agent Host

Agent Host owns:

- stable tool, contributor, call, Turn, and permission-request identities;
- descriptor registration and duplicate rejection;
- input and result schema validation;
- tool-call state, ordering, cancellation, and terminal result;
- routing to the exact registered execution owner;
- safety classification and confirmation orchestration;
- capability publication and connection availability;
- normalized tool calls and results stored in canonical Turn history.

Agent Host does not implement Browser extraction, inspect Editor models, parse
Article records, or call a Feature through a hidden local alternative.

### Feature contribution

The contribution that owns a Client Tool provides:

- one stable namespaced tool ID and contributor ID;
- bounded input and output schemas;
- read, write, or external-effect safety classification;
- target requirements and target validation;
- execution through the Feature's public service;
- cancellation, timeout, result limits, and typed errors;
- user-facing confirmation details for effects that require approval.

A Feature contribution does not add Agent-ID branches or construct a special
SDK request. It registers once with the client-side Host connection integration.

### Agent implementation

The addressed Agent receives normalized descriptors that its SDK can expose as
tools. It translates SDK tool-call events into Host calls and Host results back
into SDK results. It does not import the contributing Feature or execute a
second implementation when the registered contributor is unavailable.

## Registration and capabilities

A tool descriptor contains:

- stable tool and contributor identity;
- display name and bounded description;
- versioned input and output schemas;
- execution surface and safety class;
- confirmation and editable-input policy;
- target requirements;
- timeout, input, output, and content limits;
- descriptor revision and availability scope.

The client publishes its Client Tool descriptors during connection
initialization and through ordered registry changes. Duplicate identities,
incompatible schema versions, and invalid descriptors are rejected atomically.
An Agent or model descriptor declares which common tool surfaces and schema
versions it supports. Product names, model families, and display names are not
capability signals.

Tool availability is a property of the addressed Host connection and
contributor registration. A tool registered on one client is not available to
another connection merely because the tool ID matches.

## Interaction targets

An interaction target identifies a resource that a Client Tool may address. It
contains only:

- an opaque target ID and owner contribution ID;
- a target type and schema version;
- exact resource identity and resource or document epoch token;
- bounded display metadata;
- connection and availability scope.

A target contains no extracted body, file bytes, DOM object, service instance,
callback, executable code, permission approval, or content lease. Possessing a
target does not authorize a read or mutation; the invoked tool still validates
its input and permission contract.

Workbench Chat owns request-scoped interaction targets for one addressed input
separately from attachments. A Feature surface explicitly binds a visible
target to that input when it establishes the interaction. For example, opening
an Article link from a Chat result in the Editor Browser can bind the resulting
Browser document target to that same Chat input. The UI presents the bound
target so the meaning of “this page” is inspectable.

Binding a target does not capture content. The ordinary send path captures the
target identity and epoch in the request's non-attachment interaction context;
it does not read the page or create a content snapshot. Agent Host stores the
bounded target metadata with the accepted Turn so tool routing and retry
address the same document. Dynamic content is read at invocation time and its
result records the actual content version and digest.

The send path never scans all Editors, chooses the globally active page, or
harvests Editor or Browser content. A Browser opened without an addressed input
binding is not implicit Chat context. A separate Use in Chat action can create
that binding when the navigation did not originate from the addressed Chat.

## Invocation lifecycle

One tool call follows a deterministic lifecycle:

```text
streaming input
    → input validated
    → pending confirmation or running
    → completed, denied, cancelled, timed out, or failed
    → result committed to the addressed Turn
```

The call addresses an exact Host authority, client connection, Agent, Session,
Chat, Turn, tool descriptor revision, contributor, and optional target. The
client rejects a stale descriptor, unknown target, wrong contributor, invalid
schema, expired version, or mismatched Turn before execution.

Confirmation is scoped to one call and one validated input. Edited input is
validated again. A denial is a terminal tool result. Approval does not persist
as authority for another call unless a separate explicit permission policy
says so.

Cancellation is idempotent by call ID. A completed call cannot be reopened.
Late progress or results are rejected and reported without changing terminal
Turn state.

Tool calls that can mutate state or cause external effects carry stable
operation identity. After an uncertain disconnect, the Host reconciles that
call ID before replay. It never automatically repeats an external effect under
a new call ID.

## Readable-content Client Tool

Readable content is a common Client Tool contract implemented by a Feature-
owned extractor. Its input addresses an exact interaction target or submitted
content reference and includes an opaque cursor and requested bound. Its result
contains normalized readable chunks, source attribution, content version, next
cursor when more content exists, and exact truncation information.

The extractor owns source acquisition and parsing. Agent Host and Agent SDKs do
not scrape Browser pages or treat Article detail metadata as complete text. An
extractor does not execute scripts contained in the source. Unknown, changed,
expired, denied, or unsupported targets fail explicitly.

The same tool contract works over local and remote Hosts. A remote Host sends a
typed reverse request through the originating client connection; it does not
receive a client-local path or import the Feature implementation.

### Open Browser Article flow

```text
user opens an Article link from the addressed Chat
    → Editor Browser binds an exact Browser document target to that input
    → user asks about “this article” without attaching it
    → Host Turn carries the target metadata but no article snapshot
    → Agent invokes the readable-content Client Tool if it needs the body
    → Browser content extractor returns bounded text for that document
    → tool result becomes part of the canonical Turn
```

This flow is intentionally lazy. If the Agent does not invoke the tool, Comet
does not extract or publish the page body. If the user needs the page to be
guaranteed message context independent of tool choice, the user explicitly
adds a Browser or Article attachment instead.

## Mutation tools

Read targets and attachment content never imply mutation authority. An Editor
or Browser mutation uses a separately registered write or external-effect tool
with its own input schema, safety class, preview, permission request, and call
identity.

A tool may accept an attachment's target token or content reference as input,
but adding the attachment does not register, enable, or approve that tool.
Likewise, binding an interaction target does not attach its content.

## Attachments and Client Tools

| Concern | Attachment | Client Tool |
|---|---|---|
| Trigger | explicit Add to Chat | Agent tool call during an accepted Turn |
| Purpose | immutable message context | explicit read, mutation, or external operation |
| Content timing | resolved before Host acceptance | produced only when the call executes |
| Failure before Turn | blocks submission and preserves composer | not applicable |
| Permission | bounded content publication/read lease | per-call read, write, or external-effect policy |
| Persistence | normalized envelope stored with user message | call and result stored in Turn history |
| Retry | exact submitted content version | exact stored target/call semantics with effect reconciliation |

The complete attachment contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Connection loss and unavailable clients

Client-owned tools and targets declare their connection dependency. If the
originating client disconnects before a call starts, the call remains waiting
only when the Agent and Turn capability explicitly support that state;
otherwise it fails with a typed unavailable error. The Host never routes the
call to another client or substitutes a Host implementation.

After reconnection, the same logical client republishes descriptors and target
availability. The Host reconciles active call IDs and descriptor revisions
before resuming. A target whose exact version cannot be re-established remains
unavailable.

## Persistence and privacy

Canonical Turn history stores normalized tool identity, bounded input required
for audit and retry, confirmation outcome, bounded result, errors, and target
metadata. It does not persist live callbacks, credentials, permission tokens,
DOM state, service objects, or connection-local handles.

Tool inputs, outputs, and target metadata are untrusted and size-bounded.
Sensitive values use explicit redaction and persistence policy in the tool
schema. Logs do not copy raw credentials or unrestricted document bodies.

## Module layout

```text
src/cs/platform/agentHost/common/          tool, target, permission, and protocol contracts
src/cs/platform/agentHost/node/            Host tool orchestration and server-side execution
src/cs/workbench/contrib/chat/common/      addressed interaction-target model and public API
src/cs/sessions/contrib/providers/agentHost/browser/
                                           Client Tool routing for one Host connection
Feature-owning Workbench or Sessions contributions
                                           descriptors, targets, and implementations
```

Platform Agent Host defines no Workbench Feature tool implementation. The
shared Sessions provider routes common protocol values and consumes only public
Chat and Feature registration contracts.

## Adding a Client Tool

1. Define one stable namespaced tool ID, contributor ID, schemas, safety class,
   limits, and target requirements.
2. Implement it in the contribution that owns the public Feature service.
3. Register it through the client-side Host connection integration.
4. Validate exact target identity, descriptor revision, permission, input,
   output, timeout, and cancellation.
5. Add local and remote contract tests, including disconnect, stale targets,
   denial, cancellation, duplicate call IDs, and uncertain effects.
6. Do not add an Agent-ID branch, Feature import in Platform Agent Host, hidden
   local implementation, or catch-and-try-next route.

## Invariants

- Client Tools and attachments are independent common contracts.
- A request-scoped target carries identity, not content or permission.
- No tool invocation means no lazy content extraction or operation.
- Every call addresses one exact contributor, Turn, descriptor revision, and
  optional target.
- Tool calls and terminal results are ordered canonical Host state.
- Mutation and external effects require their own safety and confirmation
  policy.
- Local and remote Hosts use the same protocol operation.
- Missing contributors, clients, targets, versions, permissions, and
  capabilities fail explicitly; nothing falls back to another tool, client,
  target, or implementation.
