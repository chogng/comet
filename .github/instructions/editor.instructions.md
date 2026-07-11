---
description: Architecture guidelines for the reusable Workbench editor framework and the Sessions Editor Part.
applyTo: "{src/cs/workbench/common/editor/**,src/cs/workbench/browser/parts/editor/**,src/cs/workbench/services/editor/**,src/cs/workbench/contrib/draftEditor/**,src/cs/workbench/contrib/pdfEditor/**,src/cs/workbench/contrib/browserView/**,src/cs/sessions/browser/parts/editor/**}"
---

# Editor architecture

Comet's Editor uses separate owners for opening, resource resolution, group
state, pane selection, rendering, and application layout. Workbench owns the
reusable editor framework. The Sessions application owns the mounted,
collapsible Sessions Editor Part for typed Draft, PDF, and Browser editors.

```text
Sessions layout owner
└─ Sessions Editor Part: collapsed / expanded

IEditorService
└─ open/reveal orchestration
   ├─ IEditorResolverService: untyped resource → typed EditorInput
   └─ IEditorGroupsService / EditorGroupModel
      ├─ groups, tabs, active input, persistence, and input lifecycle
      └─ editor group presentation
         ├─ EditorPane registry: EditorInput → pane descriptor
         └─ EditorPane: DOM, layout, focus, and view state
```

The dependency direction is `Sessions Editor Part → Workbench Editor`.
Workbench Editor never imports Sessions. When editor services need the mounted
editor to become visible, they call a narrow editor-host contract owned by
Workbench Editor. The Sessions Editor Part implements that contract and uses
the Sessions layout service to reveal its slot.

The Sessions Editor Part does not own the group model merely because it renders
it. Collapsing the Editor changes only its layout. It must not close tabs, dispose
editor inputs, change the active input, cancel work owned by an input, or reset
view state. Expanding the Editor displays the active input unless a user action
explicitly requests another input.

## Construction and registration

Workbench Editor exposes the real EditorParts/MainEditorPart construction
extension used by application composition. Comet registers exactly one
`IEditorGroupsService` implementation, and that implementation creates the
Sessions Editor Part directly through the Workbench construction path.

Do not instantiate a generic Workbench Editor Part and wrap or forward it from
Sessions. Do not register parallel Workbench and Sessions editor-group services.
The concrete Sessions Editor Part extends the Workbench MainEditorPart
presentation base, is the actual mounted Part, and directly owns its application
chrome and layout integration.

## Resolution and rendering

Opening an untyped resource and opening an existing typed input share the same
path after input resolution:

```text
resource or typed EditorInput
  → IEditorService.openEditor(...)
  → IEditorResolverService resolves only untyped resources
  → IEditorGroupsService opens, reuses, and activates the typed input
  → Sessions Editor Part hosts the Workbench editor group presentation
  → group presentation obtains the matching pane descriptor
  → create or reuse EditorPane
  → apply the input, options, context, and cancellation to the pane
  → mount the pane in the group-owned Pane host
  → request deterministic Editor reveal from the Sessions layout owner
```

Resolver priority, glob matching, resource support, and an explicit override
belong to the untyped resource-to-input stage. Input-to-pane matching is a
separate registry operation. When multiple panes support one input, resolve the
choice through an explicit input-to-pane preference contract. Do not reuse
resource resolver priorities or capabilities as pane-selection policy.

## Commands and state

Follow the command pattern:

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

The Editor toggle command changes only the collapsed state:

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
3. Ensure the Sessions Editor Part is expanded.

The generic toggle action must not import or depend on any editor input implementation or product feature. A caller that needs to show specific content should contribute its own semantic command or call the editor opening service with the corresponding typed input.

## Typed editor inputs

Draft, PDF, and Browser content must enter the Editor through their typed inputs
and the editor pane resolver. Do not add feature-specific rendering branches to
the Sessions Editor Part and do not infer the desired input type from DOM state.

An `EditorInput` owns content identity, resource information, dirty/save/revert
behavior, model resolution, and its lifecycle contract. Group and tab
persistence use the registered editor input serializer; serialization is not an
implicit responsibility of the Sessions Editor Part or Pane.

An `EditorPane` owns concrete UI creation, rendering, focus, layout, and view
state for accepted inputs. It does not own the tab or the durable identity of
the input it currently displays.

Opening one input type must preserve the other tabs. Activating a Browser input must not discard a Draft or PDF input, and collapsing or expanding the Editor must not replace the active input implicitly.

Use `reveal-or-open` when a resource may already have a tab. Resource identity, not the currently active tab or a page URL comparison, determines whether an existing input can be reused.

## Browser editor identity

A BrowserView URI maps to a `BrowserEditorInput`, which is then hosted as an Editor tab:

```text
BrowserView URI
  → BrowserEditorInput
  → Browser editor tab
  → Sessions Editor Part
```

The mapping is not `BrowserView → Sessions Editor Part`. The Part is only the
application container and must remain unaware of BrowserView implementation
details.

Opening or revealing an existing BrowserView resource must reuse the same `BrowserEditorInput` and BrowserView. It must not create another BrowserView or navigate the existing page again. Preserve the current URL, Cookie state, navigation state, and page state.

`BrowserViewUri.getId(resource)` is a BrowserView ID, not a CDP `targetId`. Editor code operates on the URI resource and must not import CDP types or expose CDP target identity.

## Opening resources from other components

The generic Editor layout and toggle action must not depend on callers that request an editor. Callers pass a typed input or resource through the normal editor opening boundary:

```text
typed input or resource
  → renderer semantic command or typed editor service call
  → resolve/reuse the matching editor input
  → reveal its tab
  → ensure Sessions Editor Part is expanded
```

The caller owns domain-specific selection and intent. The Editor must not subscribe to caller-specific state, guess which resource should be shown, or contain routing rules for a product feature.

## Ownership and lifecycle

- Collapsing the Editor does not transfer ownership or dispose any input.
- Closing a tab is distinct from collapsing the Editor and follows that input's normal close and disposal contract.
- Resource ownership and disposal must follow the resolved input's typed lifecycle contract.
