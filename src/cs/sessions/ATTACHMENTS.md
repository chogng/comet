# Attachment architecture

## Overview

Attachments are Comet's common path for adding bounded user-selected context to
one addressed Chat request. The same path carries Browser, Article, PDF, File,
Directory, Editor, Chat-selection, text, and image context without adding a
Feature-specific request route to Sessions, Agent Host, or an Agent.

```text
Feature source
    → pending attachment in one addressed composer
    → immutable composer revision
    → producer-resolved Host attachment
    → committed user turn
    → addressed Agent runtime input
```

An attachment is context, not an action. It does not select an Agent or model,
register a tool, enable a skill or MCP server, grant mutation authority, or
approve a permission request. Those are separate typed request fields and
runtime contracts. Reading or materializing an accepted attachment through the
Host content service is message translation, not a model function call.
Canonical Tool, Agent-integration, and executor-routing rules are defined in
[Tool architecture](TOOLS.md). Request-scoped resource identity is defined in
[Interaction target architecture](INTERACTION_TARGETS.md).

## Attachment states

The attachment lifecycle has four distinct states:

| State | Owner | Meaning |
|---|---|---|
| Feature selection | Feature | Items selected for a Feature action such as download, export, or Add to Chat |
| Pending attachment | Workbench Chat | A registered, removable object in one addressed composer |
| Prepared attachment | submission transaction | A resolved immutable version and staged content lease that has not been accepted by the Host |
| Submitted attachment | Agent Host | The normalized attachment stored with one committed user message |

Feature selection is never inferred as pending attachment state. Opening an
Editor, navigating a Browser, selecting an Article checkbox, selecting files,
or changing the active page does not change a composer. Only an explicit
Feature Add to Chat action calls the attachment API.

Download, export, delete, and similar Feature actions consume their own
selection snapshot. They neither create attachments nor read an attachment
snapshot. If the user has not explicitly attached an item, Chat performs no
attachment capture or content publication for that item.

## Ownership

### Workbench Chat

`IChatService` owns the pending collection addressed by `chatResource`. Its
common attachment API owns:

- ordered add, atomic batch add, remove, and clear operations;
- exact attachment-ID uniqueness;
- composer persistence and restoration;
- immutable composer revisions;
- preparation cancellation and submission transactions;
- consumption of exactly the accepted composer revision.

Chat does not enumerate Feature kinds, inspect Feature state, walk a Directory,
extract an Article, read an Editor, or choose another representation when the
declared one is unsupported.

### Attachment producer

The contribution that owns an attachment type registers:

- its stable type ID and current producer-state schema version;
- producer-state validation and serialization;
- semantic identity and attachment-ID construction;
- composer and transcript presentation;
- send-time resolution into one normalized Host attachment;
- restoration and explicit unavailable-state diagnostics.

Producer state is bounded serializable data. It contains no DOM node, widget,
service instance, callback, live SDK object, or process-local resource handle.
Browser presentation registration is separate from common state and resolver
registration so common Chat and Host contracts remain environment-neutral.

The registry rejects duplicate type IDs. Runtime registrations accept only the
current producer-state schema. A persisted schema change is handled by one
explicit storage migration; runtime codecs do not accept multiple historical
shapes.

### Sessions and Agent Host

Sessions management routes only the addressed Session and Chat. It does not
define another attachment union or carry Feature payloads. The shared
`AgentHostSessionsProvider` begins the addressed Chat submission, dispatches
each captured envelope to its registered resolver, and submits only normalized
attachments.

Agent Host validates, stores, and routes normalized attachments. It does not
import Workbench Features or execute producer extraction logic. The addressed
Agent runtime converts the common content carrier and bounded model metadata
into its execution-engine request without routing on a Comet Feature type.

## Pending composer contract

A pending attachment envelope contains only:

- a stable attachment ID;
- a stable producer type ID;
- the producer-state schema version;
- a user-facing label and accessibility description;
- bounded serializable producer state.

Collection order is user-visible and is preserved in the captured revision,
payload digest, submitted message, and transcript. Chat rejects a duplicate
attachment ID instead of replacing the existing object. The producer decides
semantic identity: for example, whether two ranges from one File are distinct
or whether the same Article can appear twice.

Atomic batch add validates every envelope, producer registration, state value,
ID, and collection limit before changing the composer. Any invalid item rejects
the whole batch. Removing and re-adding an item is the explicit way to replace
its pending state.

Pending attachments remain Workbench draft state and never become Host draft
messages. Restored state with a missing producer registration is represented as
a removable unavailable attachment and blocks submission. It is not decoded as
generic text or handed to another producer.

## Normalized Host attachment

The Agent Host protocol carries one versioned generic envelope. It contains:

- attachment ID and producer type ID for round-trip identity;
- bounded display metadata;
- one bounded normalized model representation conforming to the Host protocol;
- zero or one content carrier;
- immutable content version and digest where content exists;
- bounded namespaced metadata needed for transcript restoration or SDK
  attribution.

The producer supplies a value in the common model-representation schema rather
than an arbitrary SDK object. The producer type ID is not a capability switch.
Agent and model support is validated against the representation, carrier,
structural shape, media type, encoding, count, and size constraints. Unknown
Host attachment-envelope versions fail protocol validation. They are not
confused with producer-state versions.

Stable type IDs and URI-shaped resource identities are valid protocol
mechanisms.
The producer registry dispatches a pending envelope by its exact producer type,
and an opaque content reference may use a versioned protocol URI. What core
code never does is switch over a closed list of Feature types, parse a URI
scheme to infer content semantics or ownership, or choose Agent behavior from
either value. The normalized representation declares semantics and the typed
owner field determines content-resource routing.

A content carrier is one of:

```text
inline
├── media type and encoding
├── bounded immutable data
└── content version and digest

reference
├── opaque content reference
├── owner: Host or originating client
├── shape: blob or tree
├── media information and declared bounds
└── immutable content version and digest
```

`blob` and `tree` are transport structures, not Feature identities. A blob
supports bounded offset and length reads. A tree supports paged reads of its
immutable manifest and bounded reads of an exact manifest entry.

Labels, source titles, filenames, media declarations, and producer metadata are
untrusted input. The Host bounds them, validates declared encodings and sizes,
and never treats them as protocol commands or executable code. Content
renderers escape untrusted presentation data. Content extraction does not
execute scripts contained in captured pages or documents.

## Content ownership and leases

A durable content reference identifies one immutable content version. A read
lease is ephemeral authority to access or materialize that version. The two are
never the same field.

During preparation, a producer publishes or locates the exact version under the
submission staging identity and returns a staged lease. The payload digest
covers the durable reference, version, and digest but excludes the lease token,
connection generation, and process-local handle.

On Host acceptance, the staged lease is bound to the exact Host connection,
Session, Chat, turn, attachment, source version, and declared lifetime. A
pre-acceptance failure releases every staged lease. A submitted message stores
the durable reference and never stores a live lease token.

Host-owned content remains readable after the originating client disconnects.
Client-owned content requires the originating client to rematerialize a lease
for the exact stored version. Retry and restoration never authorize the latest
source version in place of the submitted version. If the exact version is no
longer available, the operation fails and requires a new attachment.

A remote Host never receives a client-local `file` URI as a readable Host path.
If an Agent runtime's execution engine requires filesystem paths, the runtime
asks the Host content service to materialize the referenced blob or tree
version inside Host-owned storage. The materialized path is scoped to that Host
and lease and does not become a new source identity.
The Remote Server and Remote Tunnel placement routes and reverse
client-resource direction are defined in
[Remote Agent Host architecture](REMOTE_AGENT_HOST.md).

### Content-resource protocol

The Host content service exposes the typed resource operations required to
translate a normalized attachment into Agent input. It can open an exact
reference, read bounded blob ranges, page a tree manifest, read an exact tree
entry, materialize a Host-owned copy, and release the resulting lease. Every
operation addresses the stored content version and owning Host or client; it
never resolves a current Feature selection or current resource version.

For a client-owned reference, the Host routes a bounded content-resource
request through the exact originating client connection. This reverse request
is transport for already accepted message context. It is not published in the
Tool set, does not create a Tool call or Tool result, and does not require the
model to choose an operation. The Agent runtime uses it while mapping the
normalized attachment to the execution representation declared by the
effective Agent and model capabilities.

A connected Agent runtime issues the same content-resource operation through
the Agent Runtime Protocol. Agent Host remains the resource authority and, when
necessary, routes the bounded read to the exact originating client. The
connected runtime never receives a client connection handle or a second
attachment protocol.

A Feature extraction service may implement both immutable attachment
publication and a target-backed readable-content Tool. The protocols remain
separate: publication and content-resource reads preserve the submitted
attachment version, while the Tool reads an interaction target in response to
a model-issued call. Sharing the extraction service does not merge their
identity, authority, lifetime, persistence, or failure semantics.

## Capability and limit validation

Agent descriptors declare attachment protocol capabilities. Model descriptors
refine them. The effective descriptor explicitly covers:

- supported carriers and `blob` or `tree` structural shapes;
- supported media types and encodings;
- attachment count and inline metadata limits;
- per-item and total byte limits;
- blob read bounds;
- tree depth, entry count, per-entry, and total-byte limits;
- whether client-owned content can remain available for background execution.

The descriptor has a revision. Preparation records that revision and the Host
revalidates it immediately before accepting the turn. A stale revision,
unsupported carrier, unsupported shape or media type, or exceeded limit blocks
submission. Support is never inferred from Agent ID, model ID, family name,
display name, SDK package, or Host placement.

An Agent never silently drops an attachment, truncates it outside a declared
producer contract, stringifies an unreadable reference, flattens a tree into a
prompt, expands a Directory into inferred File attachments, extracts a PDF as
text, or retries with another representation.

Content access occurs through the Host content service during Agent runtime
input translation or materialization. Its availability and limits are
attachment carrier capabilities, not Tool descriptors. Preparation validates the exact
content-resource owner, protocol capability, lifetime, and bounds before Host
acceptance. An accepted attachment never depends on a readable-content Tool or
on the model deciding to issue a function call.

## Submission transaction

Submission uses one stable submission ID and payload digest:

```text
capture one addressed composer revision
    → resolve every attachment and bind its exact content version
    → Host validates targets and prepares the exact Tool-set revision
    → validate and digest the complete common request snapshot
    → submit normalized prompt, attachments, targets, and Tool-set revision
    → Host atomically commits the user turn
    → Chat consumes the captured composer revision
```

The captured revision is read-only except for cancellation while preparation is
active. The digest covers the canonical prompt, non-executable request
configuration, Agent and model selection, Agent runtime registration revision,
request-scoped interaction target identities and versions, requested Tool
policy, prepared Tool-set revision, ordered attachment identities, producer
type IDs, model representations, carriers, structural shapes, media
information, and immutable content versions or digests. It excludes ephemeral
lease tokens and connection-local handles.

The prepared Tool-set revision is an immutable Host value bound to the
submission ID, Host authority, Agent runtime registration revision, Agent and
model descriptor revisions, exact targets, and executor registrations. Host
acceptance revalidates it. If it is stale, the Host rejects the submission
without substituting a later Tool set; a new preparation revision requires a
new submission ID and payload digest.

The Host returns the already committed turn when the same submission ID and
digest are repeated. Reusing an ID with a different digest is a conflict. This
makes acknowledgement loss and reconnect recovery deterministic.

| Failure point | Result |
|---|---|
| producer validation or resolution | staged leases are released; composer is preserved; no turn exists |
| capability or limit validation | staged leases are released; composer is preserved; no turn exists |
| Host rejection before acceptance | staged leases are released; composer is preserved; no turn exists |
| connection loss before acknowledgement | reconcile by submission ID and digest before any resend |
| Agent runtime, Tool, or execution-engine failure after acceptance | committed user turn remains and reaches a failed or cancelled terminal state |

Retry and replay use the normalized attachments stored with the submitted Host
message. They never rerun a pending producer against current Feature state.

### Initial Turn of a new Session

Preparation for a product Session draft uses the selected Host authority,
Agent runtime registration revision, Agent and model descriptor revisions,
requested Tool policy, prepared Tool-set revision, submission ID, and
create-operation ID before a Host Session exists. The Host create operation
reserves canonical Session, ordinary Chat, Turn, and attachment identities
without publishing them, binds staged content to those identities, and then
atomically commits the Session catalog entry, Chat catalog entry, user message,
normalized attachments, interaction targets, and exposed Tool-set revision.

Preparation, content binding, Agent backing creation, or Host validation failure
before that commit releases staged leases and provisional backing, preserves the
product draft and composer, and publishes no empty Host Session. Agent runtime
execution begins only after commit; later failure is the terminal state of the
already committed initial Turn.

## Producer contracts

### Text and Chat selection

A text attachment captures exact bounded text when the Add to Chat action runs.
A Chat-selection attachment captures ordered immutable fragments with source
Chat, message identity, role, and selected text. DOM ranges, CSS classes,
renderer objects, controls, and attachment chrome do not enter producer state.

The Chat transcript renderer owns selectable content regions and constructs the
fragments directly. It does not recover selection ownership by walking across
Part boundaries or matching foreign DOM classes.

### Image

An image attachment binds exact immutable bytes, a validated media type,
dimensions, byte length, and digest. Presentation metadata never substitutes
for missing bytes. Unsupported image media or size fails before acceptance.

### Editor document and selection

An Editor-document attachment names one document and captured document version.
Resolution publishes that exact in-memory version, including unsaved content
when the Editor owns it. If the version is unavailable or changed before it can
be bound, preparation fails.

An Editor-selection attachment captures exact selected text, source identity,
document version, and range at Add to Chat time. It is a separate producer from
a full Editor document. Normal submission never harvests the active Editor.

### Browser page

A Browser-page attachment records the explicitly addressed page and main-frame
document epoch. During preparation its Feature-owned extractor captures and
publishes bounded readable content with an immutable content version and
digest. Opening a link in an Editor Browser, focusing a Browser, or navigating
the active page does not attach it. If the addressed document epoch or
extractor is unavailable, preparation fails instead of using the currently
active page.

Live Browser interaction is a separately registered and exposed Tool with its
own target, permission, and confirmation policy. A Browser attachment may carry
an exact content reference, but it does not bind an interaction target or
register, expose, or enable a Tool.

An Editor Browser can instead bind an exact request-scoped interaction target
to the addressed Chat input. That target carries no page body and creates no
attachment or snapshot. Content is extracted only if the model or Agent
emits a call to the registered readable-content Tool. This lazy flow and its
target rules are defined in
[Interaction target architecture](INTERACTION_TARGETS.md).

### Article

An Article attachment preserves stable Article identity, normalized metadata,
and a version-addressed content reference for the complete readable content.
`ArticleDetail`, list-card text, and abstracts are not substitutes for the
complete article body. The Feature-owned extractor provides bounded complete
readable content or preparation fails.

Article checkbox selection is independent of attachments. Download and export
operate on their own selection snapshot. An explicit Add Selected Articles to
Chat action creates an atomic attachment batch; a summarize action composes
that explicit add with ordinary Chat submission.

### PDF document and selection

A PDF-document attachment resolves to the exact immutable PDF blob with
`application/pdf` media. A PDF-selection attachment captures exact selected
text with source document version and page/range attribution. They are separate
producer types. A model without PDF support rejects a PDF-document attachment;
the system does not silently extract text as an alternative.

### File and Directory

A File attachment resolves to one immutable `blob` version. It grants no access
to the containing directory or later file versions. A File-selection producer,
when present, captures an exact bounded range separately from a full File.

A Directory attachment resolves to one immutable `tree` manifest. The manifest
contains only captured entries and records normalized relative paths, entry
kinds, media information, byte sizes, and content versions or digests. The
Directory producer owns explicit enumeration, exclusion, depth, and
symbolic-link policy. Resolution fails without publishing a partial manifest if
an entry changes while the version is being bound.

Tree manifests reject absolute child paths and parent traversal. A resolver
never follows a symbolic link outside the attached root. The Host can list or
read only entries named by the committed manifest. A Directory attachment is
not a live recursive filesystem grant and does not include later or excluded
entries.

## Persistence and restoration

Pending composer persistence stores the generic envelope and current producer
state. Submitted Host history stores the normalized envelope, immutable content
identity, and bounded transcript metadata. It does not store Feature selection,
active Editor state, active Browser state, or an ephemeral read lease.

Restoration preserves identity, order, availability, and the distinction
between pending and submitted state. A missing producer renderer leaves an
explicit unavailable presentation; it does not reinterpret the attachment as
another kind. A missing client-owned content version can still be displayed
from stored metadata, but reading or retrying it fails explicitly.

## Module layout

Generic attachment infrastructure and Feature producers have separate owners:

```text
src/cs/workbench/contrib/chat/
├── common/                  addressed composer model, public API, registry contracts
└── browser/                 generic attachment and transcript presentation

src/cs/workbench/contrib/fetch/          Article producer and readable-content publication
src/cs/workbench/contrib/pdfEditor/      PDF document and PDF-selection producers
src/cs/workbench/contrib/draftEditor/    Editor document and Editor-selection producers
src/cs/workbench/contrib/files/          File, File-selection, and Directory producers
src/cs/sessions/contrib/browserView/     Browser-page producer and interaction target
```

Text, image, and Chat-selection producers live with Workbench Chat because Chat
owns those source models. Each other producer lives with the contribution that
owns its source semantics and consumes only Chat's public common API. Platform
Agent Host contains only normalized attachment, content-reference, lease, and
resource protocol contracts; it contains no Feature producer.

## Adding an attachment type

1. Define one stable producer type ID and one current bounded state schema.
2. Define semantic identity and deterministic attachment-ID rules.
3. Register common validation, serialization, presentation, restoration, and
   one send-time resolver from the owning Feature contribution.
4. Choose one canonical normalized representation and declare its carrier,
   shape, media, version, digest, and bounds.
5. Implement exact-version publication and lease cleanup for both local and
   remote Hosts.
6. Add tests for atomic batch addition, restoration, cancellation, stale
   sources, descriptor changes, limits, acknowledgement loss, retry, and
   unavailable content.
7. Do not change Sessions routing, add a provider request branch, or add an
   Agent-ID or model-name special case.

## Invariants

- No explicit Add to Chat action means no attachment and no content snapshot.
- Feature selection and Feature actions remain independent of Chat attachment
  state.
- Pending composer state never crosses the Host boundary.
- Every submitted attachment is immutable, version-addressed, and stored with
  its user message.
- Every producer uses the same addressed Chat API and the same normalized Host
  envelope.
- Unsupported or unavailable content blocks submission visibly; nothing is
  silently omitted, converted, or retried as another representation.
- Durable content references and ephemeral read leases remain separate.
- Submitted content references are read through the content-resource protocol,
  never through an implicit Tool call.
- Connected Agent runtimes issue the same content-resource operations through
  the Agent Runtime Protocol and never receive originating client handles.
- Client-local paths never masquerade as remote Host paths.
- Retry uses the submitted version and never reads current Feature state as a
  substitute.
- Attachments grant context reads only. Tools and mutation permissions remain
  separate contracts.
