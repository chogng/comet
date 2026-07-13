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

The addressed Chat model owns pending composer attachments separately from the
submitted transcript. Article references, Chat transcript selections, Editor
selections, Browser context, text, and images enter the next request through
that attachment collection. Adding context to the composer never inserts a
synthetic user message into the transcript.

Checked Articles remain an explicit selection owned by the addressed Chat. A
download or export operation consumes an immutable selection snapshot without
submitting a request. Sending consumes a snapshot of the same selected Article
IDs as Article attachments. The composer visibly presents selected or attached
context so a later request never includes hidden context.

The Chat transcript renderer owns text selection inside rendered messages. It
exposes typed selectable regions carrying message identity and role; the list
widget does not recover ownership by matching CSS classes or walking unrelated
DOM. A completed selection is captured as ordered immutable message fragments
and added to the addressed composer as a Chat-selection attachment. Controls,
attachment chrome, and other non-content UI are not selectable context.

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
