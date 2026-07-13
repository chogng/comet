# Interaction target architecture

## Overview

An interaction target is a request-scoped reference to a resource that an
exposed Tool may address. It preserves the relationship between one Chat input
and a Feature-owned Browser document, Editor model, Article, PDF, or other live
resource without copying that resource into Chat state.

```text
explicit Feature interaction addresses one Chat input
    → Feature publishes exact target identity and version
    → Chat displays and captures the target with the request snapshot
    → Agent Host validates it with the prepared Tool-set revision
    → accepted Turn records the same target identity
    → content or effects occur only if the model invokes a compatible Tool
```

Targets are independent from attachments, Tool registrations, Tool selection,
permissions, and executor routing.

## Target contract

An interaction target contains only bounded identity and presentation data:

- opaque target ID and owner contributor ID;
- target type and schema version;
- exact resource identity and resource or document epoch;
- bounded display metadata;
- owner authority and availability scope;
- target revision or expiration data required for validation.

A target contains no document body, file bytes, DOM object, service instance,
callback, Tool descriptor, executor handle, SDK object, content lease,
executable code, or permission approval.

Possessing a target does not:

- register or expose a Tool;
- add immutable message context;
- authorize a read, mutation, or external effect;
- choose a Tool executor;
- make a globally active Editor or Browser part of a request.

## Ownership

### Feature contribution

The contribution that owns the resource defines the target type, publishes
exact identities and versions, validates current availability, and implements
compatible Tool operations through its public Feature service.

### Workbench Chat

Workbench Chat owns the visible request-scoped target collection for one
addressed input. It captures targets in the immutable request snapshot and
never resolves their content or infers them from global focus.

### Agent Host

Agent Host validates target identity, version, owner, availability, and
compatibility with exact Tool registrations. It records accepted targets with
the Turn and passes only bounded target metadata to the addressed Agent.

Agent Host does not inspect Browser DOM, Editor models, Article records, or PDF
state to reconstruct a target.

## Binding lifecycle

A Feature binds a target only through an explicit addressed interaction. The
interaction must identify the target Chat input and exact Feature resource.

Examples include:

- opening an Article link that originated in one Chat;
- choosing Use in Chat from an Editor or Browser;
- selecting a live resource through an addressed Chat control.

Opening, focusing, or navigating a resource without an addressed Chat
relationship creates no implicit target. General submission never scans the
active Editor, active Browser, mounted Part, DOM, or selection state.

Ordinary send captures the exact target identity and epoch visible in the
addressed input. Host preparation fails when a workflow promises a
target-backed operation but no compatible Tool registration or valid target
exists. It never substitutes a newer target, active resource, attachment, or
Tool.

Once Host accepts the Turn, later navigation or resource mutation does not
change the recorded target. A Tool call either validates the accepted epoch or
returns a typed stale or unavailable result.

## Relationship to Tools

A Tool descriptor may declare compatible target types. A Tool call that
requires a target addresses one exact accepted target ID. Agent Host validates:

- the target belongs to the addressed Turn;
- its type and schema version match the descriptor;
- the registration's executor is authorized to operate on that owner;
- its exact resource epoch is still available;
- the call has independent permission for the requested operation.

Targets do not travel through an executor-specific Tool type. A target-backed
Tool may execute in Host, an Agent, an MCP server, or a connected client when
its exact registration and authority allow it.

Tool descriptors, Tool-set preparation, calls, results, and executor routing
are defined in [Tool architecture](TOOLS.md).

## Relationship to attachments

| Concern | Attachment | Interaction target |
|---|---|---|
| User intent | include content in the message | make a live resource addressable |
| Captured value | immutable content version or reference | resource identity and epoch only |
| Content availability | required before Host acceptance | obtained only by a later Tool call |
| Model dependency | context is present regardless of Tool choice | model must invoke a compatible Tool |
| Permission | publication and read lease | no permission by itself |
| Persistence | stored with the user message | bounded target identity stored with the Turn |

Adding an attachment does not bind a live target. Binding a target does not
create or publish attachment content. A workflow needing both uses both
contracts explicitly.

The complete attachment contract is defined in
[Attachment architecture](ATTACHMENTS.md).

## Readable-content Tool

Readable content is an ordinary canonical Tool implemented by a Feature-owned
extractor. Its descriptor requires compatible target types. Its input addresses
one exact target and contains a cursor and requested bound. Its result contains:

- normalized readable chunks;
- source attribution;
- the exact content version or digest read;
- the next cursor when more content exists;
- explicit truncation and limit information.

The extractor owns acquisition and parsing. Agent Host and Agent
implementations do not scrape Browser pages or treat Article metadata as
complete content. The extractor does not execute scripts contained in the
source. Unknown, changed, expired, denied, or unsupported targets fail
explicitly.

The same extraction service may support immutable attachment publication and
target-backed Tool execution. Sharing an implementation service does not merge
their identities, lifetimes, permissions, persistence, or failure semantics.

## Browser Article flow

```text
user opens an Article link from the addressed Chat
    → Editor Browser binds one exact document target to that Chat input
    → user asks about the opened article without attaching it
    → accepted Turn contains the target and a compatible Tool registration
    → addressed Agent exposes the canonical readable-content Tool
    → model calls it if complete content is needed
    → Tool Execution Port routes to the exact registered extractor
    → extractor reads that exact document epoch and returns bounded content
    → canonical result returns to the model and enters Turn history
```

No Tool call means no lazy extraction. If content must be guaranteed message
context independently from model choice, the user explicitly adds a Browser or
Article attachment instead.

## Mutation and external effects

An interaction target grants no mutation authority. A mutation uses a separate
Tool registration with write or external-effect classification, validated
input, preview where applicable, per-call confirmation, and stable operation
identity.

Edited confirmation input is validated again. After uncertain execution or
disconnect, Agent Host reconciles the exact call and operation before retry. It
never repeats an effect under a new identity or routes it to another executor.

## Connection loss and expiration

Targets declare their owner and availability dependency. If that owner becomes
unavailable, the target remains recorded but cannot be invoked. Reconnection
may restore availability only for the same logical owner and exact resource
epoch. A new client, Browser document, Editor model, or equivalent URI does not
silently replace the accepted target.

Target expiration is explicit. Expiration never causes resolution against the
currently active Feature state.

## Persistence and privacy

Canonical history stores bounded target identity, type, owner attribution,
resource version or epoch, display metadata, and typed failure information. It
does not store live callbacks, DOM state, service objects, credentials,
connection-local handles, or unrestricted resource content.

Target metadata is untrusted and size-bounded. Feature contracts define
redaction and persistence policy. Logs never copy raw credentials or complete
document bodies.

## Module layout

```text
src/cs/platform/agentHost/common/          normalized target protocol values
                                           and validation contracts
src/cs/workbench/contrib/chat/common/      addressed request-scoped target
                                           collection and public Chat API
Feature-owning Workbench or Sessions contributions
                                           target descriptors, publication,
                                           validation, and operations
```

Platform Agent Host defines no Feature target implementation. Sessions core
does not inspect target kinds.

## Adding an interaction target

1. Define one stable target type, schema version, owner identity, resource
   identity, version or epoch, limits, and persistence policy.
2. Publish it from the Feature that owns the resource through an explicit
   addressed Chat interaction.
3. Define compatible canonical Tool descriptors independently.
4. Validate exact Turn binding, target version, executor authority, permission,
   cancellation, and expiration.
5. Add local and remote tests for binding, stale versions, disconnect,
   cancellation, missing Tools, and unavailable executors.
6. Do not infer targets from focus, DOM, URI equality, active Editors, active
   Browsers, attachments, or Tool names.

## Invariants

- A target carries identity and version, not content or executable behavior.
- Target binding, Tool registration, Tool exposure, permission, and invocation
  are separate states.
- A target never selects or creates a Tool executor.
- No model Tool call means no target-backed content extraction or effect.
- Attachments and targets never substitute for one another.
- Every Tool call addresses one exact target accepted with its Turn.
- Missing owners, versions, Tools, registrations, permissions, or executors
  fail explicitly; nothing falls back to current Feature state.
