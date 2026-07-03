# `src/ls/workbench` Structure Notes

This workbench now has a top-level `contrib/` directory for workbench-level integrations.
The codebase is still small enough that feature-local registrations can stay close to the module they wire up.

## Current responsibilities

- `workbench.*.main.ts`
  - Entry points.
  - Import shared bootstrapping, platform bootstrapping, and top-level styles.
- `browser/workbench.ts`, `browser/layout.ts`
  - Workbench core state, layout state, and imperative shell composition.
- `browser/parts/**`
  - UI parts and local part state.
- `services/**`
  - Cross-part services, registries, routing, and settings.
- `common/**`
  - Shared helpers used across environments.
- `contrib/**`
  - Contribution entry points grouped by feature or by workbench-wide ownership.
- `*.contribution.ts`
  - Feature registration and workbench lifecycle wiring.

## What counts as a contribution

A file belongs to the contribution layer when its main job is to attach a feature to the workbench lifecycle,
usually by doing one of the following:

- registering a provider
- connecting a platform capability into the browser workbench
- creating a disposable startup hook that should be started and stopped with the workbench

A file does not belong to the contribution layer when it mainly owns state, rendering, or domain logic.

## Existing contribution points

- [`workbench.common.main.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/workbench/workbench.common.main.ts)
  - Shared entry that imports feature registrations and starts workbench contributions.
- [`common/contributions.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/workbench/common/contributions.ts)
  - Contribution runtime for registering, starting, and disposing workbench-scoped contributions.
- [`workbench.desktop.main.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/workbench/workbench.desktop.main.ts)
  - Desktop entry that registers native workbench services and imports desktop-only feature registrations.

## Files that already have contribution-like behavior

These files are acceptable where they are today, but they are the first candidates to move if we later create a
dedicated contribution area:

- [`contrib/webContentView/webContentView.contribution.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/workbench/contrib/webContentView/webContentView.contribution.ts)
  - Owns web content view host lifecycle wiring for the shared native content surface.
- [`contrib/window/window.contribution.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/workbench/contrib/window/window.contribution.ts)
  - Registers the desktop window controls provider as a side effect.

## Practical rule for new code

- If the file mainly exports `registerXxx(...)` or `createXxxContribution()`, name it `*.contribution.ts`.
- If the file mainly holds state, service logic, or UI, keep it outside the contribution layer.
- Keep contribution files close to the feature while the count stays small.
- Move a contribution into `workbench/contrib/<feature>` when its integration entry point should be part of the
  shared contribution structure.

## Platform And Native Access

- Treat [`platform.ts`](/Users/lance/Desktop/Literature-Studio/src/ls/base/common/platform.ts) as the single source of truth for runtime and OS detection.
- Treat [`window.ts`](/Users/lance/Desktop/Literature-Studio/src/ls/platform/window/common/window.ts) as the place for window chrome policy derived from platform facts.
- Treat [`nativeHostMainService.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/platform/native/electron-main/nativeHostMainService.ts) as the Electron main-process owner for native capabilities.
- Treat [`nativeHostServiceProxy.ts`](/c:/Users/lanxi/Desktop/Literature-Studio/src/ls/platform/native/electron-sandbox/nativeHostServiceProxy.ts) as the sandbox renderer proxy only.
- Do not add new `window.electronAPI` access inside workbench UI, models, or contributions. Route new bridge usage through the native layer first.
