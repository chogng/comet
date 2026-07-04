---
description: Comet Studio styling guidelines — CSS selectors, styled DOM structure, DOM class prefixes, and styling conventions. Reference when writing or reviewing CSS and styled DOM code.
applyTo: "src/cs/**/*.{css,ts}"
---

# Styling Guidelines

## Class Prefixes

- Use `comet-` as the shared CSS and DOM class prefix for classes owned by Comet surfaces.
- Do not rename external, upstream, or third-party class contracts just to add a `comet-` prefix. Keep classes such as `monaco-*`, `codicon`, `codicon-*`, `ProseMirror`, third-party generated `pm-*`, icon-font bases such as `lx-icon`, and widget-internal classes that are part of another component's public DOM contract.
- Comet-authored classes rendered inside an upstream or third-party surface may still use a scoped Comet prefix, such as `comet-pm-*` for ProseMirror node views owned by Comet.
- Do not rename CSS classes that are passed through typed component, widget, decoration, or theme APIs unless the class is owned and rendered by the Comet call site being changed.
- When styling crosses a component boundary, prefer styling the Comet-owned container and only reference foreign classes when the upstream component exposes them as a stable contract.

## Selectors

- Prefer direct child combinators (`>`) when the DOM relationship is expected to be immediate.
- Use descendant selectors only when the target may intentionally appear at any nested depth.

```css
/* Preferred when .comet-panel-title is a direct child of .comet-sidebar */
.comet-workbench .comet-sidebar > .comet-panel-title > .comet-title-label h2

/* Avoid when each relationship is expected to be direct */
.comet-workbench .comet-sidebar .comet-panel-title .comet-title-label h2
```

## DOM Structure

- When CSS relies on direct child combinators (`>`), create the matching DOM as explicit direct parent-child relationships.
- Use local DOM helper APIs such as `append(parent, $('.comet-class'))` for styled structure.
- Do not add wrapper elements between styled nodes unless the CSS selector and class names are updated for the new structure.
- Put state classes on the element that owns the state.

## DOM Creation APIs

- Create real DOM nodes with upstream `$()` and `append()`.
- Do not add local `createElement(tagName, className, textContent)` helpers or DOM creation wrappers.
- Use `$('tag.comet-class')` for static classes and `$('tag', { class: className })` for dynamic classes.
- Do not use `{ className: ... }` for real DOM creation. Keep `className` only for existing component/widget/decoration APIs.

```typescript
const sidebar = append(container, $('.comet-sidebar'));
const title = append(sidebar, $('.comet-panel-title'));
const titleLabel = append(title, $('.comet-title-label'));
append(titleLabel, $('h2'));

const action = append(title, $('button.comet-panel-action'));
action.classList.toggle('is-active', isActive);

const row = append(sidebar, $('div', { class: rowClassName }));
```

```typescript
// Avoid.
const button = createElement('button', 'comet-action');
const row = $('div', { className: rowClassName });

// OK: widget option API.
const scrollable = new DomScrollableElement(content, { className: 'comet-scrollable' });
```

