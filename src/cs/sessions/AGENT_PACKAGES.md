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

One installed revision covers its complete immutable executable dependency
closure. Assets may be bundled in the package or fetched from manifest-declared
sources during the package operation, but every SDK, module, helper executable,
and native library is staged, verified, and recorded before activation. A
Session, Turn, authentication request, or runtime start never downloads or
replaces executable code.

Runtime placement is part of the distribution trust boundary. User-installed
packages always run as connected runtimes outside the Agent Host process. Only
a product-bundled runtime that Comet composition authorizes may implement
`IAgent` in process. A package signature establishes publisher and content
identity; it never grants in-process execution authority.

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
or register it. Their packages expose the Agent Runtime Protocol through a
connected runtime and never load third-party modules into the Agent Host
process.

The bundled Comet package is part of the product composition. Ordinary Agent
package operations cannot uninstall it or replace its revision; a Comet
product update updates that package. Its runtime may be embedded or a bundled
connected Comet Code runtime, but one Host composition binds exactly one form.
Both forms are product-bundled; an installed package cannot promote itself to
the embedded form.
See [Comet Agent architecture](COMET_AGENT.md).

Installation is scoped to the addressed Host authority and authenticated user
scope. Installing Claude on a local Host does not install it on a remote Host,
and a client never infers remote installation from its local files.
Remote package placement and server ownership are defined in
[Remote Agent Host architecture](REMOTE_AGENT_HOST.md).

## Identities and catalogs

Package lifecycle keeps these identities distinct:

| Identity | Meaning |
|---|---|
| Agent package ID | Stable product installation identity |
| Agent package revision | Exact version, target platform, manifest revision, and content digest |
| Agent ID | Stable behavior identity registered with Agent Host |
| Agent runtime registration revision | Exact activated runtime binding and its negotiated descriptor, configuration schemas, capabilities, resume schemas, and migration edges |
| Package operation ID | Retry-safe install, update, uninstall, Agent-data deletion, or Host-record purge operation |

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

Historical Session and Chat records nevertheless retain their owning package
ID and Agent ID as durable attribution. That attribution is not installed
state, but it prevents another package that later registers the same Agent ID
from receiving the retained resume state.

## Package manifest

Every package revision has one signed or otherwise product-authorized manifest
that declares at least:

- package ID, semantic version, manifest schema, and content digest;
- publisher identity, source identity, signature, and license metadata;
- supported operating systems, architectures, and other exact runtime targets;
- compatible Agent Runtime Protocol versions and transport limits;
- one connected Agent Runtime Protocol entry point for a user-installed
  package, or the product-authorized Comet endpoint form for the bundled
  package;
- the complete executable dependency closure, including exact source, target,
  content digest, and license identity for every separately fetched asset;
- the exact Agent IDs the runtime is authorized to register;
- required process, filesystem, network, secret, and Tool-executor privileges;
- durable data namespaces and package-owned cache namespaces;
- user-facing name, description, icon identity, and support metadata.

The manifest authorizes identities and execution resources; it does not replace
runtime negotiation. The activated runtime still publishes its exact Agent
descriptors, configuration-schema revisions, capability revisions, Tool Schema
Profiles, and resume-schema IDs through the Agent Runtime Port. Registration
fails when runtime claims exceed the manifest or Host policy.

The installable catalog and product composition assign the package's
distribution class. A manifest cannot declare itself product-bundled or
authorize an embedded entry point. Process, filesystem, network, secret, and
Tool-executor privileges for a user-installed package are enforced at its
connected-runtime process boundary.

User-visible Agent configuration uses the SDK-neutral schema and value contract
defined in [Agent Host architecture](AGENT_HOST.md). That configuration is
runtime negotiation and Host state, not package manifest authority. SDK types,
native protocol objects, package-private configuration, credentials, and
filesystem layout never enter the manifest-facing common Agent contract.
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
    → resolve and download the exact revision and complete declared executable
      dependency closure into operation-scoped staging
    → verify every digest, signature, archive structure, target, and permission
    → validate the connected entry point and Agent Runtime Protocol compatibility
    → start the staged connected runtime under operation-scoped authority and
      negotiate declared registrations in the staging transaction
    → validate every retained record attributed to this package and stage exact
      declared resume migrations where required
    → atomically commit installed record, runtime registrations, and migrated
      resume state
    → publish installed-package and Agent-catalog revisions
```

Initial installation normally has no retained records. Reinstallation after
uninstall does: every retained Session and Chat attributed to that package must
name an Agent in the staged registration and use a directly supported resume
schema or an exact declared migration edge. Otherwise installation fails with
the incompatible records unchanged and explicit. A user who intends to discard
them uses the separate Host-record purge while the package remains absent and
then retries installation; activation never silently strands or deletes them.

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
partial registration of a package, undeclared Agent IDs, an embedded entry
point outside product composition, or mixed runtime bindings fail the
activation transaction.

Activation also validates the runtime's declared configuration-schema
capabilities, exact Host-default schema revision, retained Host Agent defaults,
and retained Session configuration attributed to the package. Incompatible,
stale, or malformed configuration rejects activation without deleting,
coercing, or silently replacing the retained values.

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
remains authoritative. Once staging succeeds, the Host acquires one package
mutation gate over the union of Agent IDs declared by the installed and staged
revisions. The gate prevents new Session, Chat, Turn, authentication, and
runtime-lifecycle operations from entering any affected Agent while the Host:

```text
validated staged runtime
    → acquire the package-wide mutation gate
    → drain every non-terminal accepted Turn and lifecycle mutation for every
      affected Agent
    → checkpoint and release every materialized Session and Chat backing from
      the installed runtime
    → validate every retained resume state against the staged registrations
    → migrate unsupported states into operation-scoped staging when an exact
      migration edge is declared
    → atomically commit the installed record, every runtime registration, and
      every migrated resume state
    → dispose the previous runtime and publish catalog revisions
```

Resume migration is a first-class Agent Runtime Port operation. A staged Agent
declares exact source-schema and target-schema edges and receives one bounded
state at a time with the package operation ID, backing identity, source digest,
and target schema. It returns a new bounded opaque state without mutating the
installed runtime or authoritative Host record. Repeating the same operation,
backing identity, digest, and target returns the same result; conflicting input
is rejected. Migration may use staged package code but cannot invoke Tools,
change external provider state, or mutate Agent backing. Migration output
remains staged until the package commit.

If quiescing, release, validation, or migration fails, the staged revision and
migration output are discarded. The existing registration remains
authoritative and its released backing may materialize again from unchanged
state. After a successful commit, runtime failure does not switch back to the
previously installed revision.

A Comet product update replaces the bundled package through this same
package-wide activation transaction. Product update retains the previous Comet
endpoint and assets until the new installed record, registrations, and resume
states commit; bundled distribution does not bypass quiescing or resume
compatibility.

### Uninstall, Agent data, and retained Host records

Uninstall is an explicit destructive package operation. The Host reports the
Sessions and Chats that will become unavailable before confirmation, then
acquires the package-wide mutation gate. It admits no new runtime-bound
operation and waits for every affected Agent to have no non-terminal accepted
Turn or lifecycle mutation before release.

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
compatible revision of the same owning package is explicitly installed,
activates the same Agent ID, and supports or migrates the retained resume
schema.

Package uninstall, Agent-backed data deletion, and retained Host-record purge
are three separate operations:

- **Delete Agent data** requires the exact package revision to remain installed
  and activated. It reports every affected Session and Chat, acquires the
  package-wide mutation gate, drains their non-terminal Turns and lifecycle
  mutations, invokes their addressed Agents through the ordinary idempotent
  delete lifecycle, and removes each Host catalog entry only after backing
  deletion succeeds.
- **Uninstall** removes runtime registrations and executable assets but
  preserves Host catalog, normalized history, and bounded opaque resume state.
- **Purge retained Host records** is a Host-only destructive operation that is
  valid only after the package's installed record and runtime registrations are
  absent. It resolves records by their retained owning package ID and removes
  the selected Host catalog, normalized history, and opaque resume records
  without claiming that Agent, SDK, or provider backing was deleted.

A caller that requires both backing deletion and uninstall completes Delete
Agent data before Uninstall. Agent Host never reinstalls a package or launches
an unregistered runtime to reinterpret a later Host-record purge as backing
deletion. Removing cache or executables never masquerades as either data
operation.

Delete Agent data is a monotonic recorded batch rather than a rollbackable
transaction across external backing. Each resource commits only after its
Agent deletion succeeds. Retrying the same operation resumes incomplete
resources idempotently, and terminal success requires every addressed resource
to complete. Purge retained Host records is Host-owned and removes its complete
selected record set in one catalog transaction.

The bundled Comet package rejects uninstall and therefore never enters the
state required by retained Host-record purge. Delete Agent data may remove
Comet Sessions and their backing, but it never removes or replaces the
product's required installed record or Agent registration.

## Host connection contract

`IAgentHostConnection` exposes package catalog snapshots and explicit package
operations alongside, but separate from, Session and Agent operations. It
supports:

- listing installable offerings and their source/catalog revisions;
- listing exact installed package records and activation state;
- installing, updating, and uninstalling by stable operation ID;
- deleting Agent-backed package data while its exact runtime is activated;
- purging retained Host records after the package registration is removed;
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
dependency closures, operation outcomes, activation revisions, and granted
package privileges.
Package archives, executable assets, mutable cache, Agent-private durable data,
and Host canonical Session state use separate storage namespaces and cleanup
rules.

Activated runtime authority never includes changing its executable package
namespace. SDK or helper updates are new package revisions and use an explicit
install or update transaction; they are not runtime cache fills or first-use
materialization.

Archives and manifests are untrusted until verified. Extraction rejects path
escape, links outside the package root, undeclared executable entry points,
unexpected ownership or permissions, target mismatch, and content that does
not match the recorded digest. Secrets are resolved through typed credential
references and never copied into manifests, catalog snapshots, logs, or
package operation diagnostics.

Agent Host launches every user-installed runtime under a sandbox and authority
set derived from the verified manifest and Host policy. The process receives no
ambient Host service objects or credential environment. Filesystem and network
access are constrained to the granted scope, secrets remain typed references,
and Tool execution still crosses the canonical Tool Execution Port. A signed
runtime that requests denied authority does not start.

Package operations are idempotent by operation ID and payload digest. After an
uncertain install, update, uninstall, Agent-data deletion, or Host-record purge
result, the client reconciles that exact operation before issuing a different
mutation.

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
        └── product-bundled embedded Comet runtime, when selected by composition
```

Connected package assets live in Host-owned package storage rather than the
Sessions source tree. Sessions provider contributions only project package and
Agent state received through `IAgentHostConnection`; they do not import package
managers, SDKs, or runtime implementations.

## Adding an optional Agent package

1. Define a stable package ID and exact declared Agent IDs.
2. Publish a verified manifest and one connected runtime entry point.
3. Implement the Agent Runtime Protocol and join through
   `IAgentRuntimeConnection`; user-installed code never implements `IAgent`
   inside the Host process.
4. Publish SDK-neutral configuration schemas through the Agent Runtime Port.
   Keep SDK loading, native configuration types, provider conversion,
   credentials, and resume data inside that runtime.
5. Add explicit install, package-wide update, resume migration, activation,
   uninstall, Agent-data deletion, Host-record purge, and incompatible-resume
   tests for local and remote Hosts.
6. Do not add the package to the default installed set, auto-install it from a
   Session path, or register an Agent before the package transaction commits.

## Invariants

- Comet is the only bundled and default-installed Agent package.
- Every other Agent package is absent until the user explicitly installs it
  for the addressed Host and user scope.
- User-installed packages always execute as connected runtimes. Only a
  product-bundled Comet composition may register an embedded runtime.
- Package ID, Agent ID, runtime registration, and Session identity remain
  separate.
- SDKs are private dependencies, not product installation authority.
- Agent configuration schemas and values are Host protocol state negotiated
  with the runtime; they are not package manifest fields or SDK-native objects.
- Installable, installed, activated, authenticated, and materialized are
  distinct states.
- Activation commits only after the complete declared executable dependency
  closure is verified. Session creation, Turn execution, authentication, and
  runtime start never download, install, or replace SDK or executable assets.
- One package revision activates atomically and never publishes partial Agent
  registrations.
- Installation and update activate only when every retained record for that
  package is directly supported or migrated in the same commit. Incompatible
  records fail activation and are never silently stranded or deleted.
- Updates gate every Agent ID in the package, drain every non-terminal accepted
  Turn, checkpoint and release all materialized backing, and commit
  registrations and migrated resume state atomically. A runtime failure after
  committed activation never rolls back to the prior revision.
- Uninstall never deletes Session history or reassigns Sessions to another
  Agent implicitly.
- Agent-backed deletion requires an activated runtime. Host-record purge
  requires absent package registrations and never claims to delete Agent, SDK,
  or provider backing.
- Local and remote Hosts use the same package protocol, but each Host owns its
  own authoritative package state.
- Missing packages, incompatible targets, invalid signatures, unavailable
  runtimes, unsupported resume schemas, and denied privileges fail explicitly;
  nothing falls back to another source, revision, runtime form, or Agent.
