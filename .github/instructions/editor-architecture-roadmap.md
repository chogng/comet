# Editor Architecture Roadmap

## Purpose

This document defines the long-term editor architecture for the writing workbench once we need all of the following:

- input identity beyond raw tab objects
- pane resolution through a stable registry
- group-level persistence
- view state restore

The goal is to align with upstream workbench editor concepts without copying the entire upstream implementation into this repository.

## Why This Exists

The current editor stack already has useful building blocks:

- `src/ls/workbench/browser/parts/editor/editorModel.ts` stores explicit editor groups, one active group id, and serialized view-state entries.
- `src/ls/workbench/browser/parts/editor/panes/editorPaneRegistry.ts` resolves `draft`, `browser`, and `pdf` panes through descriptor-owned `acceptsInput` rules.
- `src/ls/workbench/browser/parts/editor/editorStorage.ts` persists serialized group inputs, draft payload by input id, active group id, and serialized view-state entries.
- `src/ls/workbench/browser/webContentSurfaceState.ts` keeps browser/pdf content on one shared content surface.

That is enough for a solid single-visible-group editor surface, but it is still not a full workbench editor model because:

- draft tabs still mix input identity and live document payload in one object
- runtime behavior is still single-visible-group even though persistence is now group-shaped
- browser view state currently restores `url + scroll`, not full history cursor semantics
- inactive browser/pdf tabs must not keep hidden live webviews around indefinitely

## Target Shape

The long-term model should separate the editor stack into six layers:

1. `EditorInput`
2. editor descriptor registry
3. editor pane lifecycle
4. editor group state
5. editor view state store
6. workspace persistence

```text
workspace
  -> groups
    -> active editor input
    -> descriptor chooses pane
      -> pane mounts surface
      -> pane saves/restores view state

storage
  -> serialized inputs
  -> serialized group state
  -> serialized view state entries
```

## Layer Contracts

### 1. EditorInput

`EditorInput` is the identity model for what is open.

It should answer:

- what resource is being opened
- how equality is determined
- how it serializes into storage
- whether it is dirty
- how it can be saved, reverted, or reloaded

Recommended local shape:

```ts
type EditorInput =
  | DraftEditorInput
  | BrowserEditorInput
  | PdfEditorInput;

type EditorInputBase = {
  inputId: string;
  kind: 'draft' | 'browser' | 'pdf';
  resourceKey: string;
  title: string;
  description?: string;
};
```

Rules:

- `inputId` is the stable open-entry id for tabs and groups.
- `resourceKey` is the stable identity for dedupe and persisted view state.
- Live editor payload must not be the only identity source.
- Serialization must not depend on DOM state.

### 2. Editor Descriptor Registry

The registry maps an input to the pane that can render it.

It should answer:

- which pane handles this input
- whether the pane can reuse an existing renderer
- which view state shape belongs to that pane
- which persistence key namespace the pane uses

Recommended local direction:

```ts
type EditorPaneDescriptor<TInput extends EditorInput, TContext, TPane> = {
  paneId: string;
  acceptsInput: (input: EditorInput) => input is TInput;
  resolvePane: (input: TInput, context: TContext) => {
    paneKey: string;
    createPane: () => TPane;
  };
};
```

Rules:

- `EditorGroupView` should ask the registry to resolve the active input.
- Resolution must not depend on CSS class names or DOM structure.
- The descriptor owns pane selection semantics, not the layout frame.

### 3. Editor Pane Lifecycle

Each concrete pane owns mode-specific rendering and mode-specific view state, but not workspace orchestration.

Recommended local direction:

```ts
abstract class EditorPane<TInput extends EditorInput, TViewState> {
  abstract getElement(): HTMLElement;
  abstract setInput(input: TInput): void;
  abstract layout(size: { width: number; height: number }): void;
  abstract focus(): void;
  abstract clearInput(): void;
  abstract getViewState(): TViewState | undefined;
  abstract restoreViewState(state: TViewState | undefined): void;
  abstract dispose(): void;
}
```

Rules:

- panes do not own outer frame rows or slot placement
- panes do not persist directly to storage
- panes expose serializable view state only
- panes may own one scroll root, but the outer frame still owns top-level height distribution

### 4. Editor Group State

A group is the unit that owns:

- open input ids
- active input id
- MRU order
- pane lifecycle coordination for the currently visible input
- group-specific view state entries

Minimum target model:

```ts
type EditorGroupState = {
  groupId: string;
  inputIds: string[];
  activeInputId: string | null;
  mruInputIds: string[];
};
```

Rules:

- group state must be independent from view state payload
- the same `resourceKey` may exist in more than one group
- each group may restore a different view state for the same resource

### 5. Editor View State Store

View state is not the input and not the tab strip.

It should restore the user’s visual/editor position inside the pane:

- draft: selection, anchor block, scroll position, maybe collapsed UI state
- pdf: page, zoom, scroll offsets, sidebar mode
- browser: url, history cursor if available, scroll position

Recommended persistence key:

```text
{ groupId } + { paneId } + { resourceKey }
```

Rules:

- store only serializable state
- keep pane-specific payloads isolated by `paneId`
- never derive persisted view state from layout classes or DOM order

### 6. Workspace Persistence

Workspace persistence owns durable serialization:

- registered/open inputs
- groups
- active group
- per-group MRU
- view state entries

It should not own transient DOM references or live pane instances.

## Current To Target Mapping

### Current lightweight equivalents

- `WritingWorkspaceTab` is acting as a combined tab model plus lightweight editor input.
- `resolveEditorPane()` is acting as a lightweight descriptor registry.
- `DraftEditorPane`, `ContentEditorPane`, and `PdfEditorPane` are acting as lightweight panes.
- `WritingEditorStorage` is acting as workspace persistence.

### Current status

Already implemented locally:

- a stable `EditorInput`-style model under `src/ls/workbench/browser/editorInput.ts`
- a descriptor-based pane registry under `src/ls/workbench/browser/parts/editor/panes/editorPaneRegistry.ts`
- a local `EditorPane` base class with pane-specific `getViewState()` and `restoreViewState()`
- durable workspace group state via persisted `groups + activeGroupId`
- model-level group-aware open/reveal/reuse behavior inside `src/ls/workbench/browser/parts/editor/editorModel.ts`
- persisted view-state entries keyed by `{ groupId, paneId, resourceKey }`
- real draft, pdf, and browser scroll-state restore across tab switches
- runtime pane switching currently recreates inactive pane instances instead of caching them in memory

### Current gaps

- no runtime multi-group UI yet
- no visible group-management affordance even though the model can now target groups explicitly
- no persisted pane instance cache or runtime multi-group open/reveal orchestration
- no full browser history/session restore
- the shared browser/pdf surface requires extra care because one live surface is reused across multiple inputs

## Shared Surface Guidance

The current shared content surface is acceptable short-term for browser/pdf, but it must not remain an implicit state carrier once view-state restore matters.

Required rule:

- before switching away from a content input, snapshot view state from the current surface
- when switching back, restore from the stored snapshot for `{ groupId, paneId, resourceKey }`
- when the shared surface only exposes async bridge access, keep a sync cache for the group store and backfill it with an async capture on switch/dispose
- inactive content tabs should release their live `webview`/surface instance after capture instead of remaining hidden in memory
- target release must wait for any pending pane view-state capture for that tab to settle, then re-check that the tab did not become active again before disposing the live surface

Long-term recommendation:

- keep one shared content surface only if restore fidelity is good enough
- if browser or pdf requires stronger isolation, graduate that mode to dedicated per-input surfaces

The decision should be driven by restore correctness, not by naming or DOM convenience.

## Migration Phases

### Phase 1: formalize inputs

Deliverables:

- add a local `EditorInput` model
- separate input identity from live tab payload
- migrate storage serialization to input-based records

Expected file touch points:

- `src/ls/workbench/browser/parts/editor/editorModel.ts`
- `src/ls/workbench/browser/parts/editor/editorStorage.ts`
- new local input contract file under `src/ls/workbench/browser/parts/editor/`

### Phase 2: formalize pane contracts

Deliverables:

- add a local abstract `EditorPane`
- replace the loose `EditorPaneRenderer` shape with typed pane contracts
- move pane resolution to descriptor objects

Expected file touch points:

- `src/ls/workbench/browser/parts/editor/panes/editorPaneRegistry.ts`
- `src/ls/workbench/browser/parts/editor/panes/draftEditorPane.ts`
- `src/ls/workbench/browser/parts/editor/panes/contentEditorPane.ts`
- `src/ls/workbench/browser/parts/editor/panes/pdfEditorPane.ts`
- `src/ls/workbench/browser/parts/editor/editorGroupView.ts`

### Phase 3: add view state restore

Deliverables:

- add a local `EditorViewStateStore`
- teach each pane to expose and restore serializable state
- persist state on input switch, close, dispose, and shutdown

Expected file touch points:

- new local view-state store file under `src/ls/workbench/browser/parts/editor/`
- pane implementations
- `EditorGroupView`
- storage layer

### Phase 4: add group-level persistence

Deliverables:

- introduce durable `groupId`
- persist per-group open inputs, active input, and MRU order
- key view state by group

Expected file touch points:

- workspace model
- storage layer
- editor part/group orchestration

### Phase 5: expand to multi-group behavior

Deliverables:

- support the same resource in multiple groups
- keep group-specific view state independent
- add group-aware open/reveal/reuse logic

This is the phase where upstream editor concepts become most relevant.

## Non-Goals

- Do not move layout constants into TypeScript just to support persistence.
- Do not make panes responsible for frame slot layout.
- Do not persist raw DOM nodes, selections, or element references.
- Do not let CSS classes become state keys.

## Implementation Notes

- `frame -> pane -> surface` remains the correct DOM hierarchy.
- State/lifecycle architecture sits beside layout architecture, not inside it.
- Use local abstractions first. Only adopt upstream classes directly if this repository also adopts upstream editor-group services and input services.

## Review Checklist

- Does the input have a stable identity separate from live DOM state?
- Is pane selection driven by descriptors instead of a hard-coded `switch` in the view?
- Can each pane save and restore serializable view state?
- Can the same resource restore differently in different groups?
- Is workspace persistence storing durable model state rather than UI implementation details?
