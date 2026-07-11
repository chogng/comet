# Sessions Part

## Overview

The Sessions Part is the primary agent interaction surface in the Comet
Workbench. It presents session and chat state supplied by Workbench session
services and keeps backend-specific behavior behind provider contracts.

```text
Comet Workbench
├── Sidebar Part
├── Sessions Part
└── Editor Part
```

The Workbench owns the product shell and composes these sibling Parts. The
Sessions Part owns only its session and chat presentation.

## Documentation

| Document | Purpose |
|---|---|
| [SESSIONS.md](SESSIONS.md) | Domain model, services, providers, state flow, lifecycle, and interface rules |
| [LAYOUT.md](LAYOUT.md) | Workbench composition, Sessions Part structure, visibility, focus, and CSS ownership |
| [LAYERS.md](LAYERS.md) | Import directions and forbidden dependencies |

## Adding functionality

1. Put session and chat presentation in `browser/parts/sessions/`.
2. Put provider-agnostic contracts and orchestration in
   `services/sessions/`.
3. Put backend implementations in
   `contrib/sessions/providers/<provider>/`.
4. Register providers through the Workbench contribution entry points.
5. Update `SESSIONS.md` when changing the domain model, service ownership, or
   data flow.
6. Update `LAYOUT.md` when changing Part structure, focus, visibility, or CSS
   ownership.
7. Update `LAYERS.md` and the ESLint import rules together when changing module
   boundaries.
