---
description: Comet Studio styling guidelines — CSS selectors, styled DOM structure, DOM class prefixes, and styling conventions. Reference when writing or reviewing CSS and styled DOM code.
applyTo: "src/cs/**/*.{css,ts}"
---

# Styling Guidelines

## Class Prefixes

- Use `comet-` as the shared CSS and DOM class prefix across Comet surfaces.

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

```typescript
const sidebar = append(container, $('.comet-sidebar'));
const title = append(sidebar, $('.comet-panel-title'));
const titleLabel = append(title, $('.comet-title-label'));
append(titleLabel, $('h2'));
```

