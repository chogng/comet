# Agent package architecture

## Overview

An Agent package is the Host-owned installation and activation unit for one or
more Agent runtimes. It is distinct from an Agent SDK:

- an Agent package has product identity, version, integrity, permissions,
  runtime entry points, and declared Agent IDs;
- an Agent runtime implements Agent behavior behind `IAgent` or the Agent
  Runtime Protocol;
- an Agent SDK is a package-private implementation dependency used by that
  runtime.

Users install Agent packages, not unqualified SDK directories. A package may
contain an SDK, a native executable, JavaScript modules, or other private
runtime assets without changing the common Agent, Session, Chat, Turn, Tool,
or attachment contracts.

Package lifecycle is owned by the addressed Agent Host. Sessions and Workbench
Chat consume only activated Agent registrations and never download, inspect,
or load Agent packages.

## Default distribution

Every supported Comet Host composition includes exactly one bundled Agent
package by default:

| Package ID | Agent ID | Distribution | Initial state |
|---|---|---|---|
| `comet` | `comet` | bundled with Comet | installed and activated |

Copilot, Claude, Codex, and every other SDK-backed Agent are user-installed
packages. They are absent by default. Listing an installable package, showing
it in an Agent marketplace, or knowing its Agent ID does not install, activate,
or register it.

The bundled Comet package is part of the product composition. Ordinary Agent
package operations cannot uninstall it or replace its revision; a Comet
product update updates that package. Its runtime may be embedded or a bundled
connected Comet Code runtime, but one Host composition binds exactly one form.
See [Comet Agent architecture](COMET_AGENT.md).

Installation is scoped to the addressed Host authority and authenticated user
scope. Installing Claude on a local Host does not install it on a remote Host,
and a client never infers remote installation from its local files.

## Identities and catalogs

Package lifecycle keeps these identities distinct:

| Identity | Meaning |
|---|---|
| Agent package ID | Stable product installation identity |
| Agent package revision | Exact version, target platform, manifest revision, and content digest |
| Agent ID | Stable behavior identity registered with Agent Host |
| Agent runtime registration revision | Exact activated runtime binding and its negotiated descriptor, capabilities, and resume schemas |
| Package operation ID | Retry-safe install, update, uninstall, or data-deletion operation |

Package ID and Agent ID occupy different namespaces even when both are
`comet`, `claude`, or `codex`. A package manifest declares a finite non-empty
set of Agent IDs that its runtime may register. One package may intentionally
publish more than one Agent, but it may not register undeclared IDs. The Comet,
Copilot, Claude, and Codex packages each publish one Agent ID.

Agent Host maintains three separate catalogs:

1. The **installable package catalog** describes package revisions that the
   current user may explicitly install from configured trusted sources.
2. The **installed package catalog** records the exact verified revisions
   committed for this Host and user scope.
3. The **Agent runtime registry** binds declared Agent IDs to exact activated
   package or bundled-composition revisions.

Only the installed catalog is installation authority. Only the Agent runtime
registry is execution authority. The installable catalog is advisory and may
change without changing either authoritative catalog.

Agent runtime registration and runtime materialization are also distinct. An
activated registration may keep its backing released until a Session needs it.
Starting or reconnecting that exact backing does not reinstall the package or
create another registration revision.

Code never treats the following as proof of installation or activation:

- a package name in product configuration;
- an SDK directory, binary, environment variable, or cache sentinel;
- a discoverable Agent ID or display name;
- credentials for an SDK or model provider;
- a Session that historically belonged to that Agent.

## Package manifest

Every package revision has one signed or otherwise product-authorized manifest
that declares at least:

- package ID, semantic version, manifest schema, and content digest;
- publisher identity, source identity, signature, and license metadata;
- supported operating systems, architectures, and other exact runtime targets;
- compatible Agent Runtime Protocol versions and transport limits;
- one embedded or connected runtime entry-point form;
- the exact Agent IDs the runtime is authorized to register;
- required process, filesystem, network, secret, and Tool-executor privileges;
- durable data namespaces and package-owned cache namespaces;
- user-facing name, description, icon identity, and support metadata.

The manifest authorizes identities and execution resources; it does not replace
runtime negotiation. The activated runtime still publishes its exact Agent
descriptors, capability revisions, Tool Schema Profiles, and resume-schema IDs
through the Agent Runtime Port. Registration fails when runtime claims exceed
the manifest or Host policy.

SDK types, native protocol objects, package-private configuration, credentials,
and filesystem layout never enter the manifest-facing common Agent contract.
Package extraction paths are Host implementation details and are never used as
Session or Agent identity.

## Lifecycle

### Discovery

Package discovery returns versioned, source-attributed offerings and their
compatibility status. It performs no download, extraction, activation, Agent
registration, authentication, or Session creation.

An Agent selection surface may present installed Agents and a separate install
action for installable packages. An installable-but-absent entry is never
presented as an executable Agent selection. The UI must not submit a Session
create operation and reinterpret a missing Agent error as permission to install.

### Install

Installation begins only from an explicit user package operation addressing
one Host authority, package offering, source, and requested revision. Before
moving bytes, the Host resolves and records the exact package revision and
content digest under a stable package operation ID.

```text
explicit user install
    → Host validates authority, policy, source, target, and manifest
    → download exact revision into operation-scoped staging
    → verify digest, signature, archive structure, and permissions
    → validate entry point and Agent Runtime Protocol compatibility
    → start or load the staged runtime under operation-scoped authority and
      negotiate declared registrations in the staging transaction
    → atomically commit installed record and runtime registrations
    → publish installed-package and Agent-catalog revisions
```

Staging is not installed state. A failed or cancelled operation removes its
staged resources and publishes no installed record or Agent registration. Its
runtime handshake cannot enter the active Agent catalog before commit. A
source, target, package, or activation failure terminates that exact operation;
the Host does not try another package, version, mirror, runtime form, or Agent.

Session creation, Chat creation, send, restore, Agent discovery, authentication,
and model selection never initiate installation. Addressing an absent optional
Agent fails with a typed not-installed or not-registered result.

### Activation and materialization

Activation binds every declared Agent ID to the exact committed package
revision and one Agent runtime registration revision. Duplicate Agent IDs,
partial registration of a package, undeclared Agent IDs, or mixed embedded and
connected bindings fail the activation transaction.

Installation does not authenticate the user to an Agent SDK or model provider.
The runtime must be able to negotiate its descriptor and truthful
authentication-required state without those provider credentials. Credential
acquisition is an Agent authentication operation after activation. Likewise,
activation does not require every Session backing to remain resident; Agent
materialization and release follow the ordinary Host lifecycle.

### Update

An update is an explicit user operation or follows a separately authorized
package-update policy. It is never triggered by Session or Turn activity.

The Host stages and validates the new revision while the current revision
remains authoritative. Activation waits until the affected Agent has no active
Turn or lifecycle mutation. The staged runtime must support every resume schema
needed by retained Session and Chat backing, or an explicit Agent-owned state
migration must complete before activation.

The installed record and all affected runtime registrations change in one
atomic commit. If validation or migration fails, the new revision was never
installed and the existing registration remains unchanged. After a successful
commit, runtime failure does not switch back to the previously installed
revision.

### Uninstall and data deletion

Uninstall is an explicit destructive package operation. The Host rejects it
while the package owns an active Turn or lifecycle mutation and reports the
Sessions and Chats that will become unavailable before confirmation.

```text
explicit user uninstall
    → validate exact installed package revision and impact
    → release package runtime backing
    → atomically remove its Agent registrations and installed record
    → remove package executables and package cache
    → preserve Host catalog, normalized history, and opaque resume state
```

Existing Sessions are not reassigned to Comet or another installed Agent. They
remain in an explicit unavailable state and may materialize again only after a
compatible package revision is explicitly installed and activated.

Package uninstall and Agent data deletion are separate operations. Uninstall
preserves Host history and bounded opaque resume data by default. Deleting the
package's durable Agent data requires a second explicit operation that reports
the affected Sessions and uses their ordinary delete semantics. Removing cache
or executables never masquerades as deleting Session history.

The bundled Comet package rejects uninstall and package-data deletion that
would remove the product's required Agent registration.

## Host connection contract

`IAgentHostConnection` exposes package catalog snapshots and explicit package
operations alongside, but separate from, Session and Agent operations. It
supports:

- listing installable offerings and their source/catalog revisions;
- listing exact installed package records and activation state;
- installing, updating, and uninstalling by stable operation ID;
- subscribing to bounded progress and terminal operation results;
- reconciling uncertain results after connection loss;
- reporting package impact, compatibility, policy, and typed failures.

The addressed Host performs download, verification, storage, launch, and
activation. A product client does not download a local archive and send a path
to a remote Host. Package progress is protocol operation state, not a Chat Turn
or model-facing Tool call.

Agent package authorization, product-client transport authentication, runtime
registration authentication, and SDK or model-provider credentials are
separate scopes. Approval in one scope grants no authority in another.

## Persistence and security

Installed records persist exact manifests, digests, source identities,
operation outcomes, activation revisions, and granted package privileges.
Package archives, executable assets, mutable cache, Agent-private durable data,
and Host canonical Session state use separate storage namespaces and cleanup
rules.

Archives and manifests are untrusted until verified. Extraction rejects path
escape, links outside the package root, undeclared executable entry points,
unexpected ownership or permissions, target mismatch, and content that does
not match the recorded digest. Secrets are resolved through typed credential
references and never copied into manifests, catalog snapshots, logs, or
package operation diagnostics.

Package operations are idempotent by operation ID and payload digest. After an
uncertain install, update, or uninstall result, the client reconciles that
exact operation before issuing a different mutation.

## Module layout

```text
src/cs/platform/agentHost/
├── common/
│   └── package identities, manifests, catalogs, operations, state, and errors
└── node/
    ├── packages/
    │   └── discovery, staging, verification, storage, activation, and cleanup
    ├── runtime/
    │   └── generic connected-runtime negotiation and lifecycle
    └── agents/comet/
        └── optional embedded implementation of the bundled Comet runtime
```

Connected package assets live in Host-owned package storage rather than the
Sessions source tree. Sessions provider contributions only project package and
Agent state received through `IAgentHostConnection`; they do not import package
managers, SDKs, or runtime implementations.

## Adding an optional Agent package

1. Define a stable package ID and exact declared Agent IDs.
2. Publish a verified manifest and one runtime entry-point form.
3. Implement `IAgent` for an embedded runtime or the Agent Runtime Protocol for
   a connected runtime.
4. Keep SDK loading, native types, provider conversion, credentials, and resume
   data inside that runtime.
5. Add explicit install, update, activation, uninstall, data-retention, and
   incompatible-resume tests for local and remote Hosts.
6. Do not add the package to the default installed set, auto-install it from a
   Session path, or register an Agent before the package transaction commits.

## Invariants

- Comet is the only bundled and default-installed Agent package.
- Every other Agent package is absent until the user explicitly installs it
  for the addressed Host and user scope.
- Package ID, Agent ID, runtime registration, and Session identity remain
  separate.
- SDKs are private dependencies, not product installation authority.
- Installable, installed, activated, authenticated, and materialized are
  distinct states.
- Session creation and Turn execution never download or install a package.
- One package revision activates atomically and never publishes partial Agent
  registrations.
- Updates never switch revision during an active Turn, and a runtime failure
  after committed activation never rolls back to the prior revision.
- Uninstall never deletes Session history or reassigns Sessions to another
  Agent implicitly.
- Local and remote Hosts use the same package protocol, but each Host owns its
  own authoritative package state.
- Missing packages, incompatible targets, invalid signatures, unavailable
  runtimes, unsupported resume schemas, and denied privileges fail explicitly;
  nothing falls back to another source, revision, runtime form, or Agent.
