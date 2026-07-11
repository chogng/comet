# Editor architecture migration

## Purpose

This document tracks the one-time migration from Comet's current parallel
Editor implementation to the target Editor ownership and rendering model. The
permanent architecture rules are defined in
`.github/instructions/editor.instructions.md`.

Delete this document and
`.github/instructions/editor-migration.instructions.md` when the migration is
complete.

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
  selection priority or assign group state to the Editor Part.

Do not preserve these differences through renamed declarations or forwarding
layers. A migrated responsibility replaces the current implementation and all
affected call sites directly.

## Reference architecture

Compare the current upstream implementation before each migration step:

```text
../vscode/src/vs/workbench/services/editor/browser/editorService.ts
../vscode/src/vs/workbench/services/editor/browser/editorResolverService.ts
../vscode/src/vs/workbench/browser/parts/editor/editorGroupView.ts
../vscode/src/vs/workbench/browser/parts/editor/editorPanes.ts
../vscode/src/vs/workbench/browser/parts/editor/editorPane.ts
../vscode/src/vs/workbench/browser/editor.ts
../vscode/src/vs/workbench/services/editor/common/editorPaneService.ts
```

The reference establishes responsibilities, not Comet product composition.
Comet retains one Workbench, its collapsible Editor layout, its titlebar and
toolbar presentation, and its Draft, PDF, and Browser editor types.

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

Editor Part
    group presentation, titlebar, toolbar, status, and Workbench layout integration

Workbench layout owner
    collapsed state, visibility, size, and deterministic reveal
```

Resource-to-input resolution and input-to-pane resolution remain separate.
Resolver glob, support, override, and priority rules never select a Pane. Pane
ambiguity is resolved through an explicit preference contract on the typed
input.

## Behavior to preserve

- Comet has one Workbench and one Editor Part.
- Collapsing the Editor changes layout only.
- Draft, PDF, and Browser inputs remain open across collapse and expansion.
- Opening content through `IEditorService` deterministically reveals the Editor.
- Existing input identity, dirty state, close confirmation, serialization, and
  view-state restoration continue to work.
- Reopening a matching Browser resource reuses its `BrowserEditorInput` and
  BrowserView without navigating or recreating the page.
- Editor titlebar, toolbar, status, focus, and layout behavior remain owned by
  the Editor presentation layer.

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

### 5. Reduce the Editor Part to presentation ownership

Keep group and input state in Editor group services and models. The Editor Part
observes group state and owns only titlebar, tabs presentation, toolbar, status,
Pane hosting, focus, view state, and layout integration.

Keep collapsed state and deterministic reveal in the Workbench layout owner.
Neither the Part nor a Pane may create a second source of group or layout state.

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
- The Editor Part does not own duplicate group, input, or layout state.
- Collapsing the Editor preserves inputs, active state, and view state.
- Browser editor resource reuse preserves the BrowserView and page state.
- No parallel registry, compatibility layer, wrapper, alias, adapter, facade,
  re-export, or fallback behavior remains.
- Relevant unit tests, TypeScript, ESLint, and the Comet UI smoke test pass.
- This document and `editor-migration.instructions.md` are deleted.
