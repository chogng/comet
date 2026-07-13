---
description: Architecture rules for the single-conversation Chat contribution and its Sessions integration.
applyTo: "src/cs/workbench/contrib/chat/**"
---

# Chat contribution

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

## Composer attachments

The addressed Chat model owns one pending composer-attachment collection
separately from the submitted transcript. Browser, Article, PDF, File, Editor,
Chat-selection, text, and image features all add and remove attachments through
the same public `IChatService` attachment operations addressed by
`chatResource`. A feature does not mutate the Chat model directly or add a
feature-specific callback to the Chat widget.

Chat treats an attachment as an object registered under a stable attachment
type. The common envelope contains only identity, type, label, and bounded
serializable producer state. Chat does not enumerate Feature attachment kinds
or interpret producer state. The contribution that owns an attachment type
owns its validation, codec, presentation factory, send-time resolver, and
restoration rules. Adding a new attachment type does not change Chat services,
the Sessions provider, or existing attachment implementations.

Chat owns only generic collection behavior: addressed lifetime, ordering,
deduplication by attachment identity, add, remove, clear, immutable submission
snapshots, and request transaction rollback. A registered resolver receives its
own typed producer state, the submission context, and cancellation, and emits
one bounded Host message attachment. Missing or duplicate type registrations,
invalid state, size violations, denied access, and unsupported transport
capabilities fail explicitly. Resolution never tries another type or source.

Feature selection is not attachment state. Selecting Articles, Files, Chat
messages, or Editor content does not add anything to the composer. A
Feature-owned explicit Add to Chat action snapshots the selection and calls the
common attachment API. Download, export, delete, and other Feature actions
consume their own selection snapshots and never read or mutate Chat
attachments. Normal Chat submission sends only objects already present in the
composer attachment collection.

Adding context to the composer never inserts a synthetic user message into the
transcript. Accepted requests associate the submitted attachment snapshot with
the user turn so transcript rendering, history, retry, and restoration preserve
what the user actually sent.

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
objects. Request acceptance clears the submitted composer attachments
atomically, and request rollback restores the captured input state.

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
chat identity. Workbench Chat emits or invokes only its public chat-level
contracts; it does not call Sessions services or receive a product callback
aggregate.

Keep public model and service contracts in Chat's common API. Keep reusable
widgets and DOM implementation in Chat's browser modules. Sessions providers
may consume the public common API needed to connect a backend chat resource,
but must not import concrete Chat widgets.

The Sessions Part and services never import the Workbench Chat contribution
implementation. They depend on the Sessions-owned `IChatViewFactory` contract;
the higher Sessions Chat contribution owns the concrete integration. See the
[Sessions layer rules](../../src/cs/sessions/LAYERS.md).
