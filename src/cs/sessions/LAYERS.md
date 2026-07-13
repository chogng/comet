# Sessions layer rules

For application ownership and layout, see [README.md](README.md),
[SESSIONS.md](SESSIONS.md), [AGENT_HOST.md](AGENT_HOST.md),
[ATTACHMENTS.md](ATTACHMENTS.md), [CLIENT_TOOLS.md](CLIENT_TOOLS.md), and
[LAYOUT.md](LAYOUT.md).

## Source hierarchy

Sessions is an application layer above Workbench:

```text
code / server entry points
          ↓
       sessions
          ↓
       workbench
          ↓
        editor
          ↓
       platform
          ↓
         base
```

Imports follow this direction only. `cs/sessions` may consume public Workbench
core, service, and contribution APIs. No file under `cs/workbench`, `cs/editor`,
`cs/platform`, or `cs/base` imports `cs/sessions`.

Comet's product entry point starts the Sessions application. It does not start
a Workbench shell and then mount a Sessions shell inside it.

## Internal hierarchy

```text
Sessions entry points
├── contrib/<feature>
├── contrib/providers/<provider>
├── browser / electron-browser application shell
└── services
    └── common

All Sessions layers
    ↓
public Workbench APIs
```

### Platform Agent Host

**Location:** `src/cs/platform/agentHost/**`

Contains the environment-neutral Host protocol, Host connection contract,
Agent registry, normalized content-resource contracts, canonical Tool and
executor-binding contracts, Node Host runtime, and Agent SDK implementations.
As a Platform subsystem it may import only Base and Platform modules. It never
imports Editor, Workbench, Sessions, or Code.

Agent implementations register with the Host runtime through public Platform
contracts. They do not implement `ISessionsProvider`, import Workbench Chat, or
own local or remote transport.

### Sessions common

**Location:** `src/cs/sessions/common/**`

Contains application-wide identifiers, commands, context keys, sizes, and
provider-agnostic value contracts that are not owned by a service.

May import only lower `cs` layers and other Sessions common modules. It does
not import Sessions browser, services, contributions, or providers.

### Sessions services

**Location:**
`src/cs/sessions/services/<service>/{common,browser,node,electron-browser}/**`

Defines and implements session models, provider registry and management,
visible-session state, workspace/runtime association, terminals, groups,
references, title, configuration, passive Part bridges, layout policy
contracts, Chat view factories, and other application services.

Services may import Sessions common and public lower-layer Workbench APIs. They
do not import Sessions browser Parts, Sessions contributions, or provider
implementations. A service needed by a Part defines its interface in the
service layer; the Part implements or consumes that interface through DI. Such
an interface does not expose a concrete Part, view class, or DOM node.

### Sessions core shell

**Location:**

```text
src/cs/sessions/browser/**
src/cs/sessions/electron-browser/**
```

Owns application bootstrap, the root shell, layout, core Parts, and
platform-specific renderer integration. Core shell code may import Sessions
common and services plus public lower-layer Workbench APIs.

Core implements passive rendering contracts such as `ISessionsPartService`.
The view-facing service owns the authoritative visible-session arrangement and
drives the Part through that contract; the Part does not aggregate provider or
session state independently.

Core shell code does not import `src/cs/sessions/contrib/**`. Concrete feature
views are obtained through service contracts such as `IChatViewFactory`.

### Sessions Node runtime

**Location:** `src/cs/sessions/node/**`

Contains Sessions-owned Node runtime integration that is not a service or
provider contribution. It may import Sessions common and Node-compatible
service contracts but never browser or electron-browser modules.

### Sessions feature contributions

**Location:** `src/cs/sessions/contrib/<feature>/**`, excluding `providers/`.

Feature contributions add Chat integration, layout policy, changes, terminals,
tasks, lists, actions, editor behavior, onboarding, and other optional product
features.
They may import Sessions common, services, core public contracts, sibling
contribution public APIs, and public lower-layer Workbench APIs.

Feature contributions do not import provider implementations. Provider-specific
behavior is expressed through `ISessionsProvider`, capabilities, and shared
session contracts.

### Provider contributions

**Location:** `src/cs/sessions/contrib/providers/agentHost/**`

The shared Agent Host provider implements `ISessionsProvider` for one
`IAgentHostConnection` and registers through `ISessionsProvidersService`. It
may use public Sessions contracts and public Workbench Chat model contracts
needed to connect an addressed Chat resource.

Local and remote contributions in the same provider family supply connections
to the shared provider implementation. Agent SDKs do not register direct
Sessions providers.

Providers do not import core Part implementations, shell layout, or another
provider's internals. They never import `ChatWidget`, a concrete Chat view, or
an Agent implementation.

### Sessions entry points

```text
src/cs/sessions/sessions.common.main.ts
src/cs/sessions/sessions.desktop.main.ts
src/cs/sessions/sessions.web.main.ts
```

Entry points load Workbench foundation entry points first and then the required
Sessions services, feature contributions, and providers for that target. They
are the only Sessions modules that import contribution entry points for side
effects.

## Workbench integration

### Layout

Sessions owns `ISessionsLayoutService`, the complete product layout state, and
its concrete implementation. Sidebar visibility and sizes, Editor collapse,
shell grid placement, titlebars, and layout persistence do not belong to a
Workbench layout implementation.

The `ISessionsLayoutPolicy` contract lives in the Sessions service layer. Its
target-specific implementation is registered from a Sessions contribution and
consumed by `ISessionsLayoutService`. The policy is stateless and does not
import shell or Part implementations. Sessions core depends on the service
contracts and does not import the layout contribution. Exactly one policy is
registered for a product target.

Workbench may retain generic Part DOM registration and narrow host contracts.
For example, Workbench Editor requests deterministic reveal through an
editor-host contract implemented by the Sessions Editor Part. Workbench entry
points do not register a default product layout service.

### Chat

`src/cs/workbench/contrib/chat/**` owns reusable single-conversation models and
widgets. `src/cs/sessions/contrib/chat/**` owns the Sessions-specific Chat view
and registers the concrete `IChatViewFactory` implementation defined by the
Sessions service layer.

```text
Sessions Part → IChatViewFactory ← Sessions Chat contribution
                                      ↓
                            Workbench Chat contribution
```

Workbench Chat never imports Sessions. Sessions core never imports the concrete
Workbench `ChatWidget` or the Sessions Chat contribution.

### Editor

Workbench owns editor inputs, groups, resolvers, panes, registries, and generic
group presentation. Sessions owns the mounted Sessions Editor Part and its
application layout integration.

```text
Sessions Editor Part
    → hosts Workbench editor group presentation
        → group tabs and group-owned Pane host
```

Opening content uses `IEditorService`; session code does not route by inspecting
Editor DOM or concrete pane implementations.

Workbench exposes the real EditorParts/MainEditorPart construction extension
used by application composition. Comet registers one concrete EditorParts
implementation, and the concrete Sessions Editor Part extends the Workbench
MainEditorPart presentation base as the actual mounted Part. Sessions does not
wrap an already-created Workbench Editor Part or register a second editor group
service.

## Part ownership

The Sessions shell composes Sidebar, Sessions, and Editor Parts. A Part does not
import or manipulate a sibling Part. Cross-Part operations use services owned by
the shell or the target subsystem.

```text
Sessions shell
├── Sidebar Part
├── Sessions Part
└── Sessions Editor Part
```

## Forbidden dependency shapes

```text
workbench → sessions
editor / platform / base → sessions
Sessions core or services → Sessions contribution implementation
Sessions feature contribution → provider implementation
Sessions Part → concrete ChatWidget
provider → Sessions Part or shell layout
provider → sibling provider internals
Agent implementation → Workbench or Sessions
Platform Agent Host → Workbench or Sessions
local or remote connection → Agent implementation internals
one Part → sibling Part implementation or DOM
code entry point → both Workbench shell and Sessions shell
```

Fix violations at their call sites. Do not hide them behind wrappers, aliases,
re-exports, adapters, facades, compatibility modules, or fallback paths.

## Enforcement

`npm run valid-layers-check` parses source imports and enforces the layer
boundaries. Entry-point tests verify that Comet loads one Sessions shell and
that lower layers have no imports from `cs/sessions`.
