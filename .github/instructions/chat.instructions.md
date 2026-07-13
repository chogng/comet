---
description: Architecture rules for the single-conversation Chat contribution, attachment producers, and Sessions integration.
applyTo: "{src/cs/workbench/contrib/chat/**,src/cs/workbench/contrib/files/**}"
---

# Chat contribution

Read `src/cs/sessions/ATTACHMENTS.md` before changing composer attachments,
attachment producers, content publication, or submission transactions. Read
`src/cs/sessions/CLIENT_TOOLS.md` before changing request-scoped interaction
targets or Client Tool integration.

Chat is a Workbench contribution for one addressed conversation. It owns the
conversation model, transcript, composer, attachments, voice interaction, and
per-turn actions for that chat resource.

Chat does not own:

- the global session or conversation collection;
- active-session or per-session active-chat selection;
- provider registration and routing;
- session workspace, runtime, lifecycle, recency, or persistence;
- session-level changes, tasks, terminals, groups, or navigation.

Chat does not accept a mutable product-wide context bag containing runtime,
provider, Editor, or shell callbacks. Shared dependencies use DI; state tied to
one chat is scoped to that addressed model or view.

When the product exposes per-request Tool selection, the addressed Chat input
owns only the visible policy and canonical Tool IDs. This state is separate
from attachments and interaction targets. Chat never copies Tool descriptors,
executor handles, or SDK objects. During submission preparation, Agent Host
resolves one immutable Tool-set revision from authoritative registries,
capabilities, targets, and policy and binds it to the submission ID. Host
acceptance revalidates and records that revision as the accepted Turn's exposed
Tool set.

## Composer attachments

The addressed Chat model owns one pending composer-attachment collection
separately from the submitted transcript. Browser, Article, PDF, File,
Directory, Editor, Chat-selection, text, and image features all add and remove
attachments through the same public `IChatService` attachment operations
addressed by `chatResource`. A feature does not mutate the Chat model directly
or add a feature-specific callback to the Chat widget.

Chat treats an attachment as an object registered under a stable attachment
type. The common envelope contains only attachment identity, type identity,
state-schema version, label, accessibility description, and bounded
serializable producer state. Chat does not enumerate Feature attachment kinds
or interpret producer state. The owning contribution provides validation,
serialization, presentation, send-time resolution, semantic identity, and
restoration. Adding a type does not change Chat services or Sessions routing.
The registry may dispatch by exact producer type ID, but core code never uses a
closed Feature-type switch or parses a resource URI to infer producer behavior.

Chat enforces uniqueness only by attachment identity. A producer owns semantic
identity and decides whether two Article, File, Directory, range, or page
references mean the same thing. Batch addition is atomic. A duplicate ID,
invalid envelope, or invalid producer state rejects the complete addition
rather than replacing an existing attachment implicitly.

Pending envelopes remain Workbench Chat draft state. They are not converted to
Host attachments or synchronized into Host draft messages. Persisted state is
upgraded by explicit storage migration; runtime codecs accept only the current
producer schema. Missing registration restores a removable unavailable item
that blocks submission, never another representation.

Chat owns only addressed lifetime, order, exact-ID deduplication, atomic batch
add, remove, clear, immutable revisions, and submission transactions. A
resolver receives its own typed state, submission context, and cancellation and
emits one bounded Host attachment. Invalid state, stale source versions,
denied access, missing registration, and unsupported capabilities fail
explicitly. Resolution never tries another type, source, or representation.

Feature selection is not attachment state. Selecting Articles, Files,
Directories, Chat messages, or Editor content does not add anything to the
composer. A Feature-owned explicit Add to Chat action snapshots the selection
and calls the common attachment API. Download, export, delete, and other
Feature actions consume their own selection snapshots and never read or mutate
Chat attachments. Normal Chat submission sends only objects already present in
the composer attachment collection.

File and Directory are separate registered attachment producers. A File
resolver binds one immutable blob version. A Directory resolver binds one
immutable, bounded content-tree manifest containing only the entries granted by
the captured producer state. Chat never treats a Directory as a File, expands
it into an inferred batch of File attachments, walks it, applies ignore rules,
or follows links. Those semantics, limits, and versioning belong to the
Directory producer and the content owner.

Adding context never inserts a synthetic user message. Host acceptance stores
the normalized immutable attachments with the user turn so rendering, history,
retry, and restoration preserve what the user sent.

## Submission lifecycle

Submission has a preparation phase distinct from an accepted Agent turn. Chat
captures one composer revision and keeps that revision read-only except for
cancellation while every registered resolver binds its source to an immutable
version. Generic payload limits and the addressed Agent and model descriptors'
explicit transport, structural shape, MIME, count, depth, entry, and byte
capabilities are validated before submission to Agent Host. Chat never infers
attachment support from Agent or model IDs, model families, or display names.

The Host submission uses one stable submission ID and payload digest. Host
acceptance atomically commits the user turn, normalized attachments, bound
interaction targets, and exposed Tool-set revision. Chat then consumes exactly
the captured revision. Lost acknowledgement is reconciled by ID and digest; the
same ID with different content is a conflict. The digest excludes leases and
connection-local handles but includes immutable content versions, ordered
attachment identity, target identity and version, requested Tool policy, and
the prepared Tool-set revision. The Host rejects stale attachment, Agent,
model, or Tool descriptors before commit.

Resolver failure, cancellation, or Host rejection before acceptance releases
all prepared content leases, leaves the composer unchanged, and creates no
transcript turn. SDK invocation, tool, cancellation, or runtime failure after
Host acceptance completes the already committed turn as failed or cancelled;
it does not restore the submitted composer or delete the user turn.

Retry and replay use the normalized attachments stored on the submitted Host
message. They never rerun a pending-attachment resolver against the current
Editor, File, Directory, page, or Article. If the exact submitted content
version can no longer be materialized, retry fails explicitly and the user
must attach a new version.

Attachments carry bounded user context and may include an exact immutable
content reference. They never carry an interaction target, Tool descriptor, or
executor binding. Agent and model selection, Tool registration and exposure,
Skills, MCP servers, commands, mutation permissions, and confirmation policy
are separate typed request fields and never enter the attachment registry.
Agent SDK translation reads an accepted content reference through the Host
content-resource protocol, not through a model Tool call.

The Chat transcript renderer owns text selection inside rendered messages. It
exposes typed selectable regions carrying message identity and role; the list
widget does not recover ownership by matching CSS classes or walking unrelated
DOM. When the user invokes Add to Chat, the current selection is captured as
ordered immutable message fragments and added to the addressed composer through
the common attachment API. Controls, attachment chrome, and other non-content
UI are not selectable context.

A Chat-selection attachment preserves the selected text and its source message
metadata for presentation and deduplication. It becomes bounded text context at
the send boundary; Agent Host does not receive DOM ranges or Chat renderer
objects.

## Interaction targets

The addressed Chat input owns visible request-scoped interaction targets
separately from attachments. A Feature explicitly binds an exact target to that
input; general submission never scans active Editors or invents a target from
global focus. Capturing a target records identity and version only. It does not
read content, create an attachment, register a Tool, or grant permission.

The immutable request snapshot includes bound targets so an Agent can address a
separately exposed Client Tool during the accepted Turn. A Client Tool is a
model-facing Tool whose executor is the exact contributing client. Binding a
target does not register or expose that Tool. When a Feature workflow promises
a target-backed operation, submission validates that a compatible Tool is in
the independently resolved Tool set or fails before acceptance. Content is
produced only when the model or Agent SDK emits the Tool call. Tool calls,
target persistence, effect reconciliation, and the Browser Article flow follow
`src/cs/sessions/CLIENT_TOOLS.md`.

Those responsibilities belong to the
[Sessions application](../../src/cs/sessions/SESSIONS.md).

## Sessions integration

The Sessions service layer defines `IChatViewFactory`.
`src/cs/sessions/contrib/chat/` implements and registers the concrete factory
using Chat's public model and widget APIs. Workbench Chat itself does not import
Sessions or contain Sessions-specific shell behavior.

The Sessions integration passes explicit session and chat context. Chat loads
the addressed chat resource; it does not infer a target from a globally active
conversation or maintain a parallel session selection.

The concrete Sessions Chat view binds Workbench Chat's chat-scoped input and
actions to typed Sessions management operations using that explicit session and
chat identity. Sending passes only that identity. The view never constructs a
parallel request object or copies composer attachments or interaction targets
into Sessions. The shared owning provider begins the addressed `IChatService`
submission transaction and receives its immutable generic request snapshot.
Workbench Chat emits or invokes only its public chat-level contracts; it does
not call Sessions services or receive a product callback aggregate.

Keep public model and service contracts in Chat's common API. Keep reusable
widgets and DOM implementation in Chat's browser modules. Sessions providers
may consume the public common API needed to connect a backend chat resource,
but must not import concrete Chat widgets.

The Sessions Part and services never import the Workbench Chat contribution
implementation. They depend on the Sessions-owned `IChatViewFactory` contract;
the higher Sessions Chat contribution owns the concrete integration. See the
[Sessions layer rules](../../src/cs/sessions/LAYERS.md).
