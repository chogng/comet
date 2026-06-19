# Knowledge Base Tree Architecture

This document records the current stopping point for the knowledge base tree refactor and the next planned steps.

## Current State

The left-side knowledge base tree is now split into layered modules:

- `src/ls/workbench/contrib/knowledgeBase/common/libraryTreeModel.ts`
  - Pure tree model, indexes, selection payload, drag payload
- `src/ls/workbench/contrib/knowledgeBase/browser/views/libraryDataSource.ts`
  - Produces root/children from `librarySnapshot`
- `src/ls/workbench/contrib/knowledgeBase/browser/views/libraryDelegate.ts`
  - Tree indentation strategy
- `src/ls/workbench/contrib/knowledgeBase/browser/views/libraryRenderer.ts`
  - Folder/document row rendering
- `src/ls/workbench/contrib/knowledgeBase/browser/views/libraryDragAndDrop.ts`
  - Drag source payload wiring
- `src/ls/workbench/contrib/knowledgeBase/browser/views/libraryViewer.ts`
  - Viewer composition layer
- `src/ls/base/browser/ui/tree/simpleTree.ts`
  - Minimal reusable tree container
- `src/ls/base/browser/ui/tree/dataTree.ts`
  - Data-source based tree wrapper
- `src/ls/base/browser/ui/tree/indexTree.ts`
  - Location-based tree wrapper with splice-oriented updates
- `src/ls/base/browser/ui/tree/objectTree.ts`
  - Object-tree wrapper for in-memory trees
- `src/ls/base/browser/ui/tree/asyncDataTree.ts`
  - Async data-source tree wrapper
- `src/ls/base/browser/ui/tree/treeTypes.ts`
  - Shared tree contracts

`primarybar` no longer owns tree rendering logic. It only hosts the knowledge base view.

## What Is Implemented

- Tree model extraction into `common`
- View / viewer / data source / renderer / drag-and-drop split
- Minimal reusable tree container
- `IndexTree / DataTree / ObjectTree / AsyncDataTree` foundation layer
- Single-selection state
- Keyboard navigation:
  - `ArrowUp`
  - `ArrowDown`
  - `ArrowLeft`
  - `ArrowRight`
  - `Enter`
  - `Space`
- Typeahead
- Focus management with roving `tabindex`
- Selection/focus passthrough on `DataTree` / `AsyncDataTree`
- Basic `IndexTree.splice(location, ...)` support for future incremental tree updates

## What Is Not Implemented Yet

- Drop targets in `agentbar`
- Drop targets in editor area
- Multi-selection
- Virtualization
- Rich tree accessibility beyond basic roles/focus/selection
- Generic tree theming API
- Async loading/error UI polish beyond state plumbing
- Upstream-grade `IndexTreeModel` diff/filter/event pipeline

## Why Drop Target Work Is Deferred

The drag source payload is already standardized through `libraryTreeModel.ts`, but no receiving surface is wired yet.

Planned consumers:

- `agentbar`
  - Drop a library item into conversation context as a reference
- editor area
  - Drop a library item to open a document/PDF/detail surface

This work is intentionally postponed so the base tree interaction model can stabilize first.

## Planned Next Steps

1. Stabilize `SimpleTree`
2. Add explicit selection callbacks from `SimpleTree` into feature views
3. Add optional tree item icons / open behavior for documents
4. Wire `agentbar` drop target to consume `application/vnd.literature-studio.library-documents`
5. Wire editor-area drop target to consume the same payload

## Design Constraint

Future drag consumers must use the shared payload from `libraryTreeModel.ts` rather than inventing feature-local drag formats.
