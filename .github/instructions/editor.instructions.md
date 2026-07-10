---
description: Architecture guidelines for the collapsible Editor Part and its Draft, PDF, and Browser editor inputs.
applyTo: "{src/cs/workbench/browser/parts/editor/**,src/cs/workbench/services/editor/**,src/cs/workbench/contrib/browserView/**}"
---

# Editor architecture

Comet's Editor differs from the upstream workbench sidebars and panels. It is a collapsible part that contains multiple typed editor inputs, so layout visibility and editor content must remain separate state dimensions.

```text
Editor Part
├─ layout: collapsed / expanded
└─ editor model
   ├─ DraftEditorInput
   ├─ PdfEditorInput
   └─ BrowserEditorInput
```

Collapsing the Editor changes only its layout. It must not close tabs, dispose editor inputs, change the active input, cancel work owned by an input, or reset view state. Expanding the Editor displays the active input unless a user action explicitly requests another input.

## Commands and state

Follow the upstream command pattern:

```text
Menu / toolbar / keybinding
  → command ID registered by Action2
  → Action2.run()
  → typed service or model mutation
  → layout and editor components consume the resulting state
```

Do not subscribe to command invocations. Commands express one-time intent; components subscribe to authoritative layout or editor state. Do not instantiate an `Action2` or call its `run()` method directly. Invoke its command ID through the command service when command routing is required.

Use commands for user-facing entry points shared by menus, toolbars, keybindings, or the command palette. Internal component coordination should call the typed service or model method directly.

## Toggle and deterministic operations

The generic Editor toggle command changes only the collapsed state:

```ts
layoutService.toggleEditorCollapsed();
```

This is appropriate for a user action because it intentionally reverses the current layout state. A workflow that requires the Editor to be visible must use a deterministic operation:

```ts
layoutService.setEditorCollapsed(false);
```

Do not call the toggle command to satisfy an open or reveal request. If the Editor is already expanded, toggling would collapse it.

Opening an editor for the user is a compound editor operation, not a layout toggle. The shared editor opening path must:

1. Resolve or reuse the requested typed editor input.
2. Add or reveal its tab and make it active.
3. Ensure the Editor Part is expanded.

The generic toggle action must not import or depend on any editor input implementation or product feature. A caller that needs to show specific content should contribute its own semantic command or call the editor opening service with the corresponding typed input.

## Typed editor inputs

Draft, PDF, and Browser content must enter the Editor through their typed inputs and the editor pane resolver. Do not add feature-specific rendering branches to the Editor Part and do not infer the desired input type from DOM state.

Opening one input type must preserve the other tabs. Activating a Browser input must not discard a Draft or PDF input, and collapsing or expanding the Editor must not replace the active input implicitly.

Use `reveal-or-open` when a resource may already have a tab. Resource identity, not the currently active tab or a page URL comparison, determines whether an existing input can be reused.

## Browser editor identity

A BrowserView URI maps to a `BrowserEditorInput`, which is then hosted as an Editor tab:

```text
BrowserView URI
  → BrowserEditorInput
  → Browser editor tab
  → Editor Part
```

The mapping is not `BrowserView → Editor Part`. The Editor Part is only the container and must remain unaware of BrowserView implementation details.

Opening or revealing an existing BrowserView resource must reuse the same `BrowserEditorInput` and BrowserView. It must not create another BrowserView or navigate the existing page again. Preserve the current URL, Cookie state, navigation state, and page state.

`BrowserViewUri.getId(resource)` is a BrowserView ID, not a CDP `targetId`. Editor code operates on the URI resource and must not import CDP types or expose CDP target identity.

## Opening resources from other components

The generic Editor layout and toggle action must not depend on callers that request an editor. Callers pass a typed input or resource through the normal editor opening boundary:

```text
typed input or resource
  → renderer semantic command or typed editor service call
  → resolve/reuse the matching editor input
  → reveal its tab
  → ensure Editor Part is expanded
```

The caller owns domain-specific selection and intent. The Editor must not subscribe to caller-specific state, guess which resource should be shown, or contain routing rules for a product feature.

## Ownership and lifecycle

- Collapsing the Editor does not transfer ownership or dispose any input.
- Closing a tab is distinct from collapsing the Editor and follows that input's normal close and disposal contract.
- Resource ownership and disposal must follow the resolved input's typed lifecycle contract.
