# Sessions dependency rules

For domain ownership and layout, see [SESSIONS.md](SESSIONS.md) and
[LAYOUT.md](LAYOUT.md).

## Product layers

Sessions are part of `cs/workbench`:

```text
code / server entry points
          ↓
workbench
          ↓
editor
          ↓
platform
          ↓
base
```

## Session module graph

```text
Workbench shell
    → Sessions Part
        → ISessionsService
            → ISessionsManagementService
                → ISessionsProvidersService
                    ← provider contributions
```

Editor operations branch from session UI or services through public editor
service contracts. Workbench layout operations branch through the public layout
owner. Neither path imports a concrete sibling Part.

## Rules by module

### Workbench shell

**Location:** `src/cs/workbench/browser/workbench.ts` and Workbench layout
modules.

May import Part entry points and public Workbench service contracts. It owns
Part composition, placement, visibility, sizing, and lifecycle.

Must not import provider implementations or own backend-specific session state.

### Sessions Part

**Location:** `src/cs/workbench/browser/parts/sessions/**`

May import:

- `cs/base/**`;
- `cs/platform/**`;
- provider-agnostic editor and Workbench service contracts;
- `cs/workbench/services/sessions/**`;
- shared chat widgets through their public Workbench API.

Must not import:

- concrete Sidebar or Editor Part implementations;
- Workbench shell or layout implementations;
- provider contributions;
- provider-specific types or backend clients.

### Session services

**Location:** `src/cs/workbench/services/sessions/{common,browser}/**`

`common/` defines session, chat, capability, provider, and service contracts.
`browser/` implements the provider registry, management model, and view-facing
service.

May import lower layers and public Workbench service contracts appropriate to
the runtime environment.

Must not import:

- Workbench Part implementations;
- Workbench shell or layout implementations;
- provider contributions;
- provider-specific models.

The view-facing service may request layout or editor operations only through
their public service contracts.

### Provider contributions

**Location:** `src/cs/workbench/contrib/sessionProviders/<provider>/**`

Providers may import session contracts, Workbench contribution APIs, and their
own backend dependencies. Providers register with
`ISessionsProvidersService`.

Providers must not import Sessions, Sidebar, or Editor Part implementations;
Workbench shell/layout implementations; or another provider's internals.

### Sibling Parts

Sidebar, Sessions, and Editor are siblings. They do not import each other's
concrete implementations or DOM contracts. Cross-Part operations use the
owning service:

- open or reveal content through `IEditorService`;
- change Part visibility through the Workbench layout owner;
- navigate sessions through `ISessionsService`.

## Contribution boundary

Code outside `contrib/` does not import provider contributions. Provider
contributions register themselves through public service contracts and
Workbench entry points.

```text
Sessions Part / session services ──✕──▶ provider contribution
provider contribution ──✕──▶ Part implementation
```

Symbols needed by shared consumers belong in
`cs/workbench/services/sessions/common/`, not in a provider folder.

## Forbidden dependency shapes

```text
workbench shell → session shell → workbench Parts
Sessions Part → concrete Editor Part
Sessions Part → concrete Sidebar Part
Sessions Part → provider contribution
session service → Workbench Part
provider → UI or Workbench layout
provider → sibling provider internals
```

Fix these shapes at their call sites. Do not hide them behind wrappers, aliases,
re-exports, adapters, or compatibility layers.
