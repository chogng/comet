---
description: Comet source code organization — layers, target environments, dependency injection, and folder structure conventions. Reference when adding new modules, services, or contributions.
applyTo: src/cs/**
---

# Source Code Organization

Canonical reference: WAITING...

## Layers

The `src/cs/` core is partitioned into ordered layers — each may only import from layers below it:

1. **`base`** — General utilities and UI building blocks (no service dependencies)
2. **`platform`** — Service injection support and base services shared across layers
3. **`editor`** — Monaco Editor core (no `node` or `electron-*` dependencies)
4. **`workbench`** — Full VS Code workbench, panels, views, and framework
5. **`code`** — Desktop app entry point (Electron main, shared process, CLI)
6. **`server`** — Server app entry point for remote development
7. **`sessions`** — Agent Sessions window (may import from `workbench` and below; `workbench` must never import from `sessions`)

## Target Environments

Within each layer, code is organized by runtime environment:

| Folder | APIs Available | May Use |
|--------|---------------|---------|
| `common` | Basic JavaScript only | — |
| `browser` | Web/DOM APIs | `common` |
| `node` | Node.js APIs | `common` |
| `electron-browser` | Browser + limited Electron IPC | `common`, `browser` |
| `electron-utility` | Electron utility process | `common`, `node` |
| `electron-main` | Electron main process | `common`, `node`, `electron-utility` |

## Workbench Organization

- `cs/workbench/{common|browser|electron-browser}` — minimal workbench core
- `cs/workbench/api` — `vscode.d.ts` API provider
- `cs/workbench/services` — core services (not contrib-specific)
- `cs/workbench/contrib` — feature contributions

### Contribution Rules

- No dependency from outside `contrib/` into `contrib/`
- Each contribution has a single `.contribution.ts` entry point
- Contributions expose internal API from a single common file
- Cross-contribution dependencies use that common API — never reach into internals

## Entry Points

Only code referenced from entry point files is loaded:

- `workbench.common.main.ts` — shared dependencies
- `workbench.desktop.main.ts` — desktop-only
- `workbench.web.main.ts` — web-only

## Dependency Injection

Services are consumed via constructor injection with decorator identifiers:

```typescript
class MyComponent {
  constructor(@IMyService private readonly myService: IMyService) { }
}
```

Services are provided via `registerSingleton(IMyService, MyServiceImpl, InstantiationType.Delayed)`.
