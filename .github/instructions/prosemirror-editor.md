# ProseMirror Editor

This note records the current contract for the writing editor's structured ProseMirror document layer.

## Current scope

- The editor stores `citation`, `figure`, and `figure_ref` as structured nodes instead of plain text.
- Plain-text export, derived labels, and editor stats live in `src/ls/editor/common/writingEditorDocument.ts`.
- The browser surface is split by responsibility:
  - `src/ls/editor/browser/text/input.ts` owns composition, pending-sync, and focus-restore timing.
  - `src/ls/editor/browser/text/sync.ts` owns props-to-editor sync decisions.
  - `src/ls/editor/browser/text/editor.ts` owns ProseMirror wiring and toolbar integration.

## Regression checks

Run the targeted regression check with:

```bash
npm run test:editor
```

The test entry point is `src/ls/editor/browser/text/tests/editor.index.test.ts`.

The lightweight runner bundles the test entry with `esbuild` and executes it through Node's built-in `node:test` runner. DOM integration coverage uses `jsdom`, so we still avoid introducing a full browser test stack.

## What is covered

- Citation numbers are derived from first appearance order, not from the raw `citationIds` text.
- Figure references render against figure order and fall back to `?` when the target figure is missing.
- Figure insertion keeps a structured figure node, generates stable ids, and leaves a trailing paragraph so editing can continue naturally.
- Stable editing anchors are `blockId`-based text units, not visual line numbers.
- Logical line coordinates are computed inside each exported text unit and only track explicit line breaks.
- `input.ts` is covered as a standalone state machine for composition, pending sync, focus restore, and timer cleanup.
- `sync.ts` is covered as a standalone decision layer for stale props, placeholder-only updates, and model echo handling.
- `editor.ts` is covered in `jsdom` for DOM-level regressions around stale props during local edits, composition flush timing, placeholder refresh, and external document replacement semantics.

## Stable edit coordinates

- The long-term edit anchor is `blockId`.
- Exportable text units live in `src/ls/editor/common/writingEditorDocument.ts` via `collectWritingEditorTextUnits`.
- Model wrappers are available via `createWritingEditorDocumentModel` and `createWritingEditorTextModel`.
- A text unit maps one editable text-bearing node with a stable `blockId` to:
  - `kind`
  - normalized plain text
  - logical line offsets derived only from explicit `hard_break` content
- Monaco-style helpers are exposed per text unit: `validatePosition`, `validateRange`, `getOffsetAt`, and `getPositionAt`.
- Safe edit executors are exposed via `applyWritingEditorEdit` and `applyWritingEditorEdits`.
- The current executor only rewrites plain-text text units (`text` + `hard_break`). Structured inline nodes such as `citation` and `figure_ref` are rejected instead of being flattened.
- Visual line numbers are intentionally excluded because they change with viewport width, font metrics, and layout chrome.
- `figure` remains a structural block, but the editable caption surface is exposed through its `figcaption` text unit.

## Sync policy

- Stale props that arrive before the local model echo do not overwrite the current DOM/editor state.
- Placeholder-only changes update the existing editor state instead of rebuilding the full `EditorState`.
- Authoritative external document replacements still rebuild `EditorState` and clear undo/redo history.
  This is intentional: preserving the old history across a whole-document replace produced invalid undo behavior.

## What is not fully covered

- Native macOS IME candidate UI is still a manual smoke test.
- The manual checklist lives in `docs/editor-ime-smoke.md`.

## Next cleanup targets

- Keep `input.ts` as the only owner of composition/focus timing state.
- Keep `sync.ts` as the only owner of props-to-editor sync branching.
- Keep placeholder and other non-document updates away from full `EditorState` recreation.
- If we revisit full-document external sync later, the replacement path must either reset history explicitly or define a valid history-mapping strategy first.
