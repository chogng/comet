---
description: Architecture rules for BrowserView, browser automation, overlays, and Editor integration.
applyTo: "{src/cs/platform/browserView/**,src/cs/workbench/services/browserView/**,src/cs/workbench/contrib/browserView/**,src/cs/sessions/contrib/browserView/**}"
---

# BrowserView architecture

Read `src/cs/sessions/CLIENT_TOOLS.md` before changing Browser interaction
targets, Agent-readable content, or Client Tool integration. Read
`src/cs/sessions/ATTACHMENTS.md` before changing Browser attachments.

## Ownership

```text
BrowserSession
└── browser context, Cookie state, and page lifecycle

BrowserViewGroup
└── pages exposed to one CDP/Playwright session

BrowserView
└── one visible or background web page

PlaywrightSession
└── Agent automation connection, page routing, and lifecycle
```

`IBrowserViewService` owns BrowserView identity, creation, lookup, navigation,
and lifecycle. Playwright services own automation sessions and tracked-page
operations. A consumer does not create a parallel BrowserView registry,
Playwright facade, or page lifecycle.

BrowserView IDs and Playwright page IDs are product identities. They are not CDP
`targetId` values and are not inferred from URLs or DOM state.

Each BrowserView also exposes one main-frame document epoch. It changes on a
committed main-frame navigation and remains distinct from the stable
BrowserView and page identities. An interaction target binds BrowserView, page,
and document epoch without claiming that dynamic page content was snapshotted.

## Editor integration

A visible BrowserView enters Workbench Editor through its typed resource and
input:

```text
BrowserView URI
    → BrowserEditorInput
    → Browser EditorPane
    → Workbench editor group presentation
    → Sessions Editor Part
```

Opening or revealing the same resource reuses its `BrowserEditorInput` and
BrowserView. It does not create another page or navigate the existing page
again. Browser features open content through `IEditorService` and do not
manipulate the Sessions Editor Part directly.

## Typed page snapshots

`IPlaywrightService.captureSnapshot()` is the single typed platform boundary
for obtaining a complete main-frame page snapshot. It operates only on a page
tracked by the addressed Playwright session and returns a bounded immutable
value containing page identity, document epoch, URI, title, HTML, capture time,
and content digest.

URI, title, and HTML are captured atomically from one document execution
context. Navigation interruption, page closure, cancellation, readiness
failure, timeout, and size-limit failure are explicit errors. The operation
does not return stale content from a previous page and does not automatically
retry or fall back to another read path.

Callers may supply a generic readiness condition, timeout, size limit, and
`CancellationToken`. They never receive a raw Playwright Page. Snapshot HTML is
not logged or sent to telemetry, and detached parsing never executes embedded
scripts.

Do not add a parallel DOM Snapshot method to `IBrowserViewService`. Agent-facing
ARIA summaries remain a separate `IPlaywrightService` capability and are not a
replacement for the typed HTML snapshot.

## Chat context

Opening a BrowserView does not attach or extract its content. A navigation
originating from one addressed Chat may bind that exact document as a visible
request-scoped interaction target for the same Chat input. Other navigation
requires an explicit Use in Chat action to create the binding. General Chat
submission never infers a target from the globally active Editor.

An interaction target carries identity and document epoch only. Dynamic content
is read only when the model or Agent SDK emits a call to the separately exposed
readable-content Client Tool, and the resulting Tool output records its content
digest. An explicit Browser attachment instead publishes an immutable snapshot
during preparation; Agent SDK translation reads its content reference through
the Host content-resource protocol, not through a Tool call. Neither path
substitutes the other.

## Native overlay coordination

BrowserView content can be hosted by a native `WebContentsView`, which sits
outside the ordinary DOM stacking context. When a recognized shared DOM overlay
such as Context View, Settings, a dialog, or a notification overlaps it,
`BrowserOverlayManager` coordinates presentation:

```text
shared overlay becomes visible
    → BrowserOverlayManager detects overlap
    → native WebContentsView is temporarily hidden
    → screenshot or DOM placeholder preserves page presentation
    → shared overlay renders above the Browser region
```

The overlay manager owns this transition. Overlay consumers expose their stable
Comet overlay DOM contract and do not hide native views directly or infer
overlap by walking foreign component DOM. Closing the overlay restores the same
BrowserView and page state.

## Lifecycle invariants

- Owned background BrowserViews are disposed with their page session.
- Borrowed interactive BrowserViews remain user-owned and are not destroyed by
  a borrowing operation.
- Closing a borrowed page terminates the operation explicitly.
- Page tracking and remote/IPC registrations are disposed with their owning
  service or session.
- Cancellation prevents completed asynchronous work from publishing a stale
  result.
