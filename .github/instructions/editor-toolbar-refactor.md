# Editor Toolbar Refactor

## Goal

Unify the editor toolbar around a single workbench-level toolbar slot:

- `topbar`: tabs and editor-group actions
- `toolbar`: active-tab toolbar
- `content`: active pane content

The toolbar slot is owned by the editor frame, not by individual pane DOM trees.

## Current Problems

1. Browser and PDF toolbar UI already mount through the workbench toolbar slot.
2. Draft toolbar still lives inside the ProseMirror surface DOM.
3. The resulting structure is inconsistent:
   - browser/pdf use frame-level toolbar mounting
   - draft uses pane-local toolbar mounting
4. `editorBrowserToolbarView` is browser-first but currently also handles PDF placeholder mode.

## Target Architecture

### Stable frame structure

The editor frame keeps three stable rows:

- `editor-topbar`
- `editor-toolbar`
- `editor-content`

### Toolbar ownership

The `editor-toolbar` row is the only place where active-tab toolbars render.

- draft tab => draft toolbar
- browser tab => browser toolbar
- pdf tab => pdf toolbar

### Pane contract

Editor panes can optionally expose a toolbar element:

- draft pane exposes its formatting toolbar
- panes without their own toolbar return `null`

### Toolbar host behavior

The workbench toolbar host is responsible for:

- mounting the active toolbar element into `.editor-toolbar`
- hiding `.editor-toolbar` when the active tab has no toolbar or when toolbar display is disabled
- keeping toolbar layout and chrome consistent across modes

## Migration Plan

1. Add an optional toolbar API to editor panes.
2. Move draft toolbar ownership out of `ProseMirrorEditor` content layout and expose it to the workbench host.
3. Keep browser/pdf toolbar rendering in the workbench layer, but mount them through the same toolbar host path used by draft.
4. Update tests so draft tabs assert the toolbar is visible in `.editor-toolbar`.

## Acceptance Criteria

1. Draft, browser, and PDF tabs all render their toolbar through `.editor-frame > .editor-toolbar`.
2. `ProseMirrorEditor` content no longer renders the draft toolbar inside `.pm-editor-surface`.
3. Draft toolbar styling still renders correctly after being moved to the shared toolbar slot.
4. Existing browser toolbar interactions still work.
5. Targeted editor and workbench toolbar tests pass.
