# Sessions Layer Rules

This document describes the import layering rules for `src/cs/sessions/`, enforced by the `local/code-import-patterns` ESLint rule.

The sessions layer sits above `cs/workbench` in the VS Code source code hierarchy. For the broader VS Code layer rules (base → platform → editor → workbench → sessions), see `.github/instructions/source-code-organization.instructions.md`.

## Layer Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  Entry Points                                       │
│  sessions.common.main.ts / .desktop.main.ts /       │
│  .web.main.ts / .web.main.internal.ts               │
│  (can import everything below)                      │
└──────────────────────┬──────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────────┐
│ contrib/*  │  │ contrib/   │  │                │
│ (chat,     │  │ providers/ │  │  services/*    │
│  sessions, │  │ (agentHost,│  │                │
│  changes,  │  │  copilot,  │  │                │
│  ...)      │  │  remote)   │  │                │
└─────┬──────┘  └─────┬──────┘  └───────┬────────┘
      │               │                │
      │               │                │
      ▼               ▼                ▼
┌─────────────────────────────────────────────────────┐
│  sessions/~  (core: browser/, common/, electron-browser/) │
└─────────────────────────────────────────────────────┘
```

## Rules by Target

### `sessions/~` — Sessions Core

**Path:** `src/cs/sessions/{browser,common,electron-browser}/**`

The foundational layer. It may import from the sessions **services** layer, but not from any `contrib/` code above it.

**Can import from:**
- `cs/base/~`, `cs/base/parts/*/~`
- `cs/platform/*/~`
- `cs/editor/~`, `cs/editor/contrib/*/~`
- `cs/workbench/~`, `cs/workbench/browser/**`, `cs/workbench/services/*/~`
- `cs/sessions/~` (self), `cs/sessions/services/*/~`

> **Note:** The desktop bootstrap entry `src/cs/sessions/electron-browser/sessions.ts` has its own, **more restrictive** rule: it may import only `cs/base/~`, `cs/base/parts/*/~`, `cs/platform/*/~`, `cs/sessions/~`, and `cs/sessions/sessions.desktop.main.js`.

**Cannot import from:**
- ❌ `cs/sessions/contrib/*` — no contrib dependencies
- ❌ `cs/sessions/contrib/providers/*` — no provider dependencies

---

### `sessions/services/*/~` — Sessions Services

**Path:** `src/cs/sessions/services/*/{browser,common}/**`

Service layer sits alongside core. Provides shared service interfaces and implementations.

**Can import from:**
- Everything `sessions/~` can import (**except** `cs/workbench/browser/**`, which is not granted to services), plus:
- `cs/sessions/services/*/~` (sibling services)
- `cs/workbench/contrib/*/~`

**Cannot import from:**
- ❌ `cs/sessions/contrib/*` — no contrib dependencies
- ❌ `cs/sessions/contrib/providers/*` — no provider dependencies

---

### `sessions/contrib/*/~` — Contributions (non-provider)

**Path:** `src/cs/sessions/contrib/*/{browser,common}/**` (excluding `contrib/providers/`)

Feature contributions like `chat`, `sessions`, `changes`, `terminal`, etc.

**Can import from:**
- Everything `sessions/services/*/~` can import, plus:
- `cs/sessions/contrib/*/~` (sibling contributions)

**Cannot import from:**
- ❌ `cs/sessions/contrib/providers/*/~` — **providers are isolated from non-provider contribs**

---

### `sessions/contrib/providers/*/~` — Session Providers

**Path:** `src/cs/sessions/contrib/providers/*/{browser,common}/**`

Provider implementations (`agentHost`, `cometChatSessions`, `remoteAgentHost`). These are the compute backends that register with `ISessionsProvidersService`.

**Can import from:**
- Everything `sessions/contrib/*/~` can import, plus:
- `cs/sessions/contrib/providers/*/~` (sibling providers)

This is the **most permissive** contrib layer — providers can reach into non-provider contribs and sibling providers, but not vice versa.

---

### Entry Points

| File | Layer | Notes |
|------|-------|-------|
| `sessions.common.main.ts` | `browser` | Shared contributions for all platforms |
| `sessions.desktop.main.ts` | `electron-browser` | Desktop-specific, imports `sessions.common.main.js` |
| `sessions.web.main.ts` | `browser` | Web-specific, imports `sessions.common.main.js` |
| `sessions.web.main.internal.ts` | `browser` | Internal web variant, imports `sessions.web.main.js` |

Entry points can import from all sessions layers: `sessions/~`, `services/*/~`, `contrib/*/~`, and `contrib/providers/*/~`.

---

## Key Constraint

```
contrib/*  ──✕──▶  contrib/providers/*
```

Non-provider contributions **must not** import from provider code. If a provider exposes a symbol needed by non-provider code, that symbol should be extracted to a shared location (`cs/sessions/services/`, `cs/sessions/common/`, or a shared contrib module).

Providers **can** import from non-provider contributions and from sibling providers.
