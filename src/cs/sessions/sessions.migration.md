# Sessions Part migration

## Purpose

This document tracks the one-time migration from the current
`src/cs/sessions/` boundary to the Sessions Part inside the Comet Agent
Workbench. It is not an architecture document and must be deleted with the old
directory when the migration is complete.

## Scope

This migration applies to all files under `src/cs/sessions/**` and to affected
call sites, entry points, styles, tests, and import rules changed specifically
to remove a dependency on that old boundary.

The final architecture is defined by:

- [`README.md`](../workbench/browser/parts/sessions/README.md)
- [`SESSIONS.md`](../workbench/browser/parts/sessions/SESSIONS.md)
- [`LAYOUT.md`](../workbench/browser/parts/sessions/LAYOUT.md)
- [`LAYERS.md`](../workbench/browser/parts/sessions/LAYERS.md)

## Current problem

The repository currently has a bidirectional ownership chain:

```text
cs/workbench
    → cs/sessions UI shell and Part wrappers
    → concrete cs/workbench Parts and services
```

`cs/workbench/browser/workbench.ts` imports session-owned shell views, while
those views import concrete Workbench Sidebar, Editor, statusbar, and layout
code. This makes Sessions appear to own the Workbench even though Comet has only
one Workbench product shell.

The current boundary was introduced after architecture documents copied the
upstream standalone Agents Window model. The old Workbench content shell was
then replaced by session-specific layout and CSS. The migration must restore
single ownership; it must not preserve the incorrect boundary through aliases,
wrappers, re-exports, adapters, or compatibility imports.

The upstream repository maintains both a traditional Workbench and a separate
Agents Window under `vs/sessions`. Its session domain model, provider contracts,
observable state flow, and documentation structure are useful references. Its
top-level application layer, entry points, duplicate shell, and Part layout are
not Comet's final architecture.

## Destination map

| Current source | Final owner |
|---|---|
| `src/cs/sessions/browser/parts/sessions/**` | `src/cs/workbench/browser/parts/sessions/**` |
| `src/cs/sessions/browser/parts/sidebar/**` | Existing `src/cs/workbench/browser/parts/sidebar/**` modules |
| `src/cs/sessions/browser/parts/editor/**` | Existing `src/cs/workbench/browser/parts/editor/**` modules |
| `src/cs/sessions/browser/workbenchContentPartViews.ts` | Workbench shell/content composition |
| `src/cs/sessions/browser/media/style.css` | Workbench shell/layout styling |
| `src/cs/sessions/browser/parts/media/sessionView.css` | Split by the DOM owner of each rule |
| `src/cs/sessions/browser/parts/auxiliarybar/**` | Existing Workbench auxiliary Part, or deletion when unused |

Do not move a file mechanically when it contains multiple owners. Split its
code and CSS directly among the final modules that render the corresponding
DOM.

## Required behavior baseline

Before changing ownership, record the intended Comet UI behavior and protect it
with focused tests:

- the Workbench renders one Sidebar, one Sessions Part, and one Editor Part;
- collapsing the Editor changes only layout visibility and preserves editor
  inputs and view state;
- opening Draft, PDF, or Browser content reveals the Editor through the editor
  service;
- the Sessions Part remains visible when the Editor is collapsed or expanded;
- titlebar actions stay in the column that owns them;
- sidebar visibility and saved sizes survive rerender and reload;
- existing chat input, send, model selection, and conversation actions keep
  working;
- settings and overlays do not replace or reparent unrelated Parts.

Use the UI state before the session-shell replacement as architecture evidence,
but keep intentional product changes made since then. Do not restore deleted
code blindly.

## Migration sequence

### 1. Restore Workbench shell ownership

- Make the Workbench create and compose the three sibling Parts directly.
- Move grid construction, Part visibility, sizes, and layout persistence into
  Workbench layout modules.
- Move shell CSS into Workbench-owned styles and scope it to Workbench DOM.
- Remove session-shell types from `workbench.ts` call sites in the same change.

At the end of this step, `workbench.ts` must not import a session application
shell or a session-owned layout controller.

### 2. Establish the Sessions Part

- Move the session view, header, titlebar, chat view, and Part root directly to
  `src/cs/workbench/browser/parts/sessions/`.
- Keep only session-owned DOM and styling in that directory.
- Inject public services required by the Part; do not pass the entire Workbench
  state through a large prop object.
- Keep the Part independent of concrete Sidebar and Editor implementations.

Update all affected imports to the final path and delete the old files in the
same change.

### 3. Return sibling code to its owner

- Merge sidebar-specific DOM and behavior into the existing Sidebar Part.
- Merge editor hosting and editor-specific CSS into the existing Editor Part.
- Return titlebar and statusbar behavior to their existing owners.
- Delete empty or duplicate Part wrappers instead of retaining parallel
  implementations.

No session module may import a concrete sibling Part after this step.

### 4. Introduce session domain services

- Define provider-agnostic session, chat, provider, and capability contracts in
  `src/cs/workbench/services/sessions/common/`.
- Implement shared registry, routing, lifecycle, and observable state in
  `src/cs/workbench/services/sessions/browser/`.
- Move backend-specific behavior into
  `src/cs/workbench/contrib/sessions/providers/<provider>/`.
- Register providers through the service contract and Workbench contribution
  entry points.

The Sessions Part consumes only the shared service contract. Provider
contributions never import UI.

### 5. Enforce the dependency graph

- Update the repository import-pattern ESLint configuration for the final
  locations in `LAYERS.md`.
- Ban imports from `cs/workbench/browser/parts/sessions` in session services and
  providers.
- Ban provider-contribution imports from the Sessions Part and service
  implementation.
- Ban all remaining `cs/sessions/**` imports.

### 6. Remove the transitional directory

- Confirm `rg "cs/sessions" src/cs` returns no source imports.
- Delete all remaining code and CSS under `src/cs/sessions/`.
- Delete this migration document with the directory.
- Keep the final architecture documents under
  `src/cs/workbench/browser/parts/sessions/`.

## Change requirements

Each migration change must:

- migrate affected call sites directly to the final interface;
- delete superseded code and CSS in the same change;
- preserve unrelated user changes;
- add or update focused tests for the ownership being moved;
- pass TypeScript, ESLint, relevant browser unit tests, and the Comet UI smoke
  test;
- compare behavior and ownership with the upstream workbench primitives where
  applicable, without copying the upstream two-shell product architecture.

## Completion criteria

The migration is complete only when:

- Comet has one Workbench shell and one layout owner;
- Sessions is a sibling Workbench Part beside Sidebar and Editor;
- session domain state is exposed through provider-agnostic Workbench services;
- providers depend on contracts and never on UI;
- no source file imports `cs/sessions/**`;
- no duplicate session shell, Sidebar, Editor, titlebar, statusbar, or layout
  implementation remains;
- the final dependency rules are enforced by ESLint;
- the required behavior baseline passes;
- `src/cs/sessions/` and this migration document are deleted.
