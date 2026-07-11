# Editor architecture migration

## Purpose

This document tracks the one-time migration from Comet's current parallel
Editor implementation to the target Editor ownership and rendering model. The
permanent architecture rules are defined in
`.github/instructions/editor.instructions.md`.

Delete this document when the migration is complete.

## Scope

This migration applies to:

```text
src/cs/workbench/common/editor/**
src/cs/workbench/browser/parts/editor/**
src/cs/workbench/services/editor/**
src/cs/workbench/contrib/draftEditor/**
src/cs/workbench/contrib/pdfEditor/**
src/cs/workbench/contrib/browserView/**
src/cs/sessions/browser/parts/editor/**
```

## Current problem

Comet currently implements Editor concepts through a separate set of simplified
contracts and presentation helpers:

```text
IEditorService
    → IEditorResolverService
    → IEditorGroupsService / EditorGroupModel
    → EditorPartController
    → EditorGroupView
        → module-local EditorPane descriptor array
        → EditorPane
```

The broad responsibilities are sound, but several boundaries differ from the
established Editor architecture:

- pane descriptors are held in a module-local array rather than the EditorPane
  registry contract;
- `EditorGroupView` combines group presentation, pane lookup, pane instance
  management, input cancellation, mounting, and view-state coordination;
- typed editor contributions use Comet-specific descriptor factories and
  closure-based `setInput` routing;
- the local Pane contract does not carry the complete input options and open
  context through the normal input application boundary;
- documentation can accidentally treat resource resolution priority as pane
  selection priority or assign group state to the Editor Part;
- `SessionEditorPartView` is a thin wrapper around Workbench group
  presentation while Sessions-specific layout remains in Workbench modules,
  obscuring the final application-to-foundation dependency direction.

Do not preserve these differences through renamed declarations or forwarding
layers. A migrated responsibility replaces the current implementation and all
affected call sites directly.

The shell and source-layer inversion is tracked by
`src/cs/sessions/sessions.migration.md`. Editor migration keeps reusable editor
models and registries in Workbench while moving only the mounted product Part
and Sessions layout integration to the Sessions application.

## Reference architecture

Compare the current upstream implementation before each migration step:

```text
../vscode/src/vs/workbench/services/editor/browser/editorService.ts
../vscode/src/vs/workbench/services/editor/browser/editorResolverService.ts
../vscode/src/vs/workbench/browser/parts/editor/editorGroupView.ts
../vscode/src/vs/workbench/browser/parts/editor/editorParts.ts
../vscode/src/vs/workbench/browser/parts/editor/editorPanes.ts
../vscode/src/vs/workbench/browser/parts/editor/editorPane.ts
../vscode/src/vs/workbench/browser/editor.ts
../vscode/src/vs/workbench/services/editor/common/editorPaneService.ts
../vscode/src/vs/sessions/browser/parts/editorParts.ts
../vscode/src/vs/sessions/browser/parts/editorPart.ts
```

The reference establishes responsibilities, not Comet product composition.
Workbench remains the reusable Editor foundation. The top-level Sessions
application owns Comet's mounted, collapsible Editor Part, titlebar and toolbar
presentation, and layout integration for Draft, PDF, and Browser editor types.

One distinction is mandatory: upstream `IEditorPaneService` reports Pane
instantiation state and events. It does not select an EditorPane for an input.
Pane selection belongs to the group-owned Pane host querying the EditorPane
registry. Do not create a service with the same name and a different role.

## Target ownership

```text
IEditorService
    public open/reveal orchestration

IEditorResolverService
    untyped resource → typed EditorInput

IEditorGroupsService / EditorGroupModel
    groups, tabs, active input, ordering, persistence, and input lifecycle

EditorInput
    content identity, resource, dirty/save/revert, model resolution, and lifecycle

EditorPaneRegistry
    typed EditorInput → deferred EditorPane descriptor

group-owned Pane host
    Pane selection, instantiation, reuse, visibility, input application, and cancellation

EditorPane
    concrete DOM, focus, layout, options, open context, and view state

Sessions Editor Part
    mounted group placement, outer chrome, focus, and application layout integration

Workbench EditorParts construction extension
    creates the one concrete main Editor Part selected by application composition

Sessions layout owner
    collapsed state, visibility, size, and deterministic reveal
```

Resource-to-input resolution and input-to-pane resolution remain separate.
Resolver glob, support, override, and priority rules never select a Pane. Pane
ambiguity is resolved through an explicit preference contract on the typed
input.

## Behavior to preserve

- Comet has one Sessions product shell and one mounted Sessions Editor Part.
- Collapsing the Editor changes layout only.
- Draft, PDF, and Browser inputs remain open across collapse and expansion.
- Opening content through `IEditorService` deterministically reveals the Editor.
- Existing input identity, dirty state, close confirmation, serialization, and
  view-state restoration continue to work.
- Reopening a matching Browser resource reuses its `BrowserEditorInput` and
  BrowserView without navigating or recreating the page.
- Editor titlebar, toolbar, status, focus, and layout behavior remain owned by
  the Sessions Editor presentation layer.

## Migration sequence

### 1. Protect current behavior

Add or update focused tests for typed and untyped opens, group reuse, active tab
changes, serialization, Pane reuse, cancellation, view state, collapse, and
BrowserView identity before replacing ownership boundaries.

### 2. Align the core contracts

Align `EditorInput`, `IEditorService`, `IEditorResolverService`,
`IEditorGroupsService`, and the group model with the target responsibilities.
Migrate every affected call site in the same change. Do not retain parallel old
interfaces.

### 3. Establish the EditorPane registry and group-owned Pane host

Replace the module-local descriptor array with the target EditorPane registry
and deferred Pane descriptor contract. Move Pane lookup, instantiation, reuse,
visibility, input application, cancellation, and error propagation into the
group-owned Pane host.

Delete the old registry helpers and the corresponding Pane-management branches
from `EditorGroupView` once their call sites use the target boundary.

### 4. Migrate typed editor contributions

Migrate Draft, PDF, and Browser contributions directly to the target input
resolver and EditorPane registration contracts. Pass editor options, open
context, and cancellation through the normal Pane input boundary. Delete the
old descriptor factories and registrations in the same change.

### 5. Establish the Sessions Editor Part as the presentation owner

Keep group and input state in Workbench Editor services and models. The
Sessions Editor Part directly hosts the Workbench group presentation and owns
only outer titlebar, application toolbar/status, group placement, focus, and
Sessions layout integration. Workbench group presentation owns group tabs, its
Pane host, and Pane view state.

Expose a real Workbench EditorParts/MainEditorPart construction extension and
register exactly one concrete EditorParts implementation for Comet. That
implementation creates the concrete Sessions MainEditorPart subclass directly.
Delete the existing `SessionEditorPartView` wrapper; do not retain it around a
separately created Workbench Part and do not register parallel editor group
services.

Keep collapsed state and deterministic reveal in the Sessions layout owner,
reached from Workbench Editor through a narrow editor-host contract implemented
by the Sessions Editor Part. Workbench Editor must not import Sessions. Neither
the Part nor a Pane may create a second source of group or layout state.

### 6. Remove the parallel implementation

Delete every superseded contract, registry, descriptor, helper, and test
fixture. Confirm that no compatibility import, alias, forwarding service, or
fallback path remains.

## Completion criteria

- Untyped resources resolve to typed inputs before entering the group model.
- Typed inputs bypass resource resolution and enter the same group path.
- Editor groups are the only owners of tabs, active input, ordering, and input
  lifecycle.
- A group-owned Pane host queries the EditorPane registry and manages Pane
  instances.
- Resolver priority is not used for Pane selection.
- `IEditorPaneService`, if present, has only its instantiation-observation role.
- Draft, PDF, and Browser contributions use the target registration contracts.
- Editor options, open context, and cancellation reach the Pane input boundary.
- The Sessions Editor Part does not own duplicate group, input, or layout
  state.
- The mounted Editor Part lives in Sessions and imports Workbench Editor through
  public contracts; Workbench does not import Sessions.
- The thin `SessionEditorPartView` forwarding wrapper is gone; the final
  Sessions Editor Part owns real presentation and layout responsibilities.
- Application composition registers one editor-group service and creates the
  mounted Sessions Editor Part through the Workbench construction extension.
- Collapsing the Editor preserves inputs, active state, and view state.
- Browser editor resource reuse preserves the BrowserView and page state.
- No parallel registry, compatibility layer, wrapper, alias, adapter, facade,
  re-export, or fallback behavior remains.
- Relevant unit tests, TypeScript, ESLint, and the Comet UI smoke test pass.
- This document is deleted.
