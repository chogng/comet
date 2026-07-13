# Tool architecture

## Overview

A Tool is Comet's canonical model-facing function contract. It describes one
capability independently from the Agent SDK that exposes it and independently
from the process or connection that executes it.

```text
Tool contribution registers canonical semantics and one executor
    → Agent Host prepares an exact Tool-set revision for a Turn
    → addressed Agent Tool Port projects that Tool set into its SDK
    → model or Agent SDK emits an SDK-specific call
    → Agent Tool Port normalizes it into one canonical Tool call
    → Agent Host validates and routes the call to its exact executor
    → canonical Tool result returns through the Agent Tool Port
    → Agent SDK resumes the model Turn
```

The canonical Tool contract is the common base for Host Tools, Agent Tools,
MCP Tools, and Client Tools. SDK projection and execution location are separate
dimensions.

## Terms

| Term | Meaning |
|---|---|
| Tool descriptor | Versioned canonical capability semantics, schemas, policy, and limits |
| Tool registration | One descriptor revision bound to one exact typed executor identity |
| Tool-set revision | Host-issued immutable snapshot of exact registrations exposed to one accepted Turn |
| Tool call | One normalized model-facing invocation with stable canonical identity and bounded input |
| Tool result | One terminal success, denial, cancellation, timeout, or failure for the same call |
| Agent Tool Port | SDK-specific boundary that projects canonical Tool sets and results into one Agent SDK and normalizes SDK calls |
| Client Tool | A Tool registration whose executor kind is `client` |
| Client Tool Execution Port | SDK-neutral client connection boundary that publishes registrations and carries canonical calls and results for exact client executors |

The Agent Tool Port is not a Tool executor. A Client Tool is not an Agent Tool
Port. The Agent Tool Port converts canonical and SDK protocols; a Client Tool
identifies client execution ownership; the Client Tool Execution Port carries
the canonical call to that executor.

These are independent axes. The addressed Agent selects one Agent Tool Port;
the accepted Tool registration selects one executor. Adding an Agent SDK does
not change canonical Tool descriptors or executor implementations. Adding a
Tool or executor does not add SDK-format conversion outside Agent Tool Ports.

## Tool and Client Tool boundary

A Tool answers:

- what capability the model can call;
- what input and output mean;
- which safety, permission, target, and limit rules apply;
- which exact registration and revision the Turn exposes.

A Client Tool additionally answers:

- which logical Comet client contributed the implementation;
- how Agent Host sends the normalized call to that client;
- how the client reconciles execution across disconnect and reconnect.

Client-specific registration, interaction targets, reverse execution, and
Feature ownership are defined in [Client Tool architecture](CLIENT_TOOLS.md).

## Canonical Tool contract

### Descriptor

A Tool descriptor contains only SDK-neutral semantics:

- stable namespaced Tool ID and contributor ID;
- canonical function name, display name, and bounded model description;
- versioned input and output schemas;
- read, write, or external-effect safety classification;
- confirmation and editable-input policy;
- optional interaction-target requirements;
- input, output, content, timeout, and concurrency limits;
- descriptor revision.

SDK package types, callbacks, tool objects, Zod instances, MCP server objects,
provider event payloads, and SDK call handles never enter the descriptor.
Provider-specific metadata remains inside the Agent implementation. A semantic
requirement shared across Agents is promoted into the canonical contract rather
than carried as an opaque SDK option.

### Registration and executor

A registration binds one descriptor revision to one exact executor identity.
The executor binding is canonical routing data, not part of the model-facing
descriptor. It is a tagged route with one of four kinds:

| Executor kind | Exact execution owner |
|---|---|
| `client` | one connected logical Comet client contributor |
| `host` | one Agent Host implementation |
| `agent` | the addressed Agent implementation |
| `mcp` | one registered MCP server and Tool identity |

Executor kind and exact identity belong to the registration. Translating a
Client Tool through an SDK-private MCP bridge does not change its executor to
`mcp`; an SDK mechanism never changes canonical ownership.

Duplicate registration identities, conflicting definitions for the same Tool
ID and revision, incompatible schema profiles, and invalid executor bindings
are rejected atomically. Same-named registrations never shadow one another.
Routing always uses the exact registration stored in the accepted Tool-set
revision.

## Comet Tool Schema Profile

Tool input and output use a versioned Comet Tool Schema Profile. The profile is
a bounded, transport-neutral schema language over canonical protocol values
with explicit schema capabilities. It is not defined as whatever the currently
selected SDK happens to accept.

A descriptor declares its schema profile and required schema features. An
Agent descriptor declares the profiles and features its Tool Port can preserve,
along with name, description, schema, input, output, and content limits. Tool
set preparation validates the exact intersection for the selected Agent and
model.

Projection must preserve validation semantics. An Agent Tool Port never:

- removes a required field;
- widens or narrows a type silently;
- drops an unsupported constraint;
- truncates a description, schema, input, or output to satisfy an SDK limit;
- converts structured output into untyped text unless the canonical descriptor
  explicitly declares that representation;
- retries with another schema profile.

If an SDK needs JSON Schema, Zod, an MCP schema, or another native form, its
Agent Tool Port performs that exact projection. A Tool that cannot be
represented without loss is rejected before Host acceptance.

## Tool-set preparation and exposure

Registration, executor availability, policy selection, preparation, exposure,
and invocation are distinct states.

Workbench Chat may own visible per-request Tool policy and canonical Tool IDs.
It never owns descriptors, SDK aliases, or executor handles. During submission
preparation, Agent Host resolves that policy against:

- authoritative Tool registrations and descriptor revisions;
- exact executor availability;
- Agent and model Tool capabilities;
- schema-profile compatibility;
- bound interaction targets;
- product and permission policy.

The result is one immutable prepared Tool-set revision bound to the submission
ID, Host authority, Agent and model descriptor revisions, targets, and exact
registrations. Preparation is idempotent for the same input. Reusing the same
submission ID with different input is a conflict.

Host acceptance revalidates the prepared revision and records it as the Turn's
exposed Tool set. A stale registration, target, capability, or executor rejects
submission before acceptance. Agent Host never silently resolves a newer Tool
set under the same submission ID.

Every model-visible generic Tool appears in the canonical snapshot. An Agent
descriptor declares whether its SDK supports an exact per-Turn set, requires
private SDK rebinding or restart, or exposes a fixed set. A fixed SDK Tool must
still have a canonical descriptor and registration. Policy that the Agent
cannot enforce fails explicitly.

SDK-reserved control primitives such as user input, permission, or elicitation
map to their dedicated Host contracts when those are their product semantics.
An SDK event or field named `tool` does not make such a control request a
canonical Tool.

## Agent Tool Port

Each `IAgent` implementation owns its Agent Tool Port. It is a mandatory
internal boundary of that Agent implementation, not a product-wide registry or
a compatibility route. Agent SDK types remain on the SDK side of the port.

Its Host-facing surface is canonical in both directions:

| Direction | Canonical value |
|---|---|
| Host to port | prepared or accepted Tool-set revision, call cancellation, and terminal Tool results |
| Port to Host | projection capability, normalized Tool calls, progress, and SDK-originated cancellation |

SDK descriptors, callbacks, call handles, and result objects exist only behind
that surface. The port may be structured differently inside each Agent, but it
must preserve these common semantics.

The port owns:

- lossless projection from a canonical Tool-set revision into the SDK's native
  function, dynamic Tool, fixed Tool, or private MCP surface;
- deterministic SDK-visible aliases that satisfy that SDK's name rules;
- a bijective mapping between those aliases and exact canonical registrations;
- SDK Tool installation, rebind, restart, and lifetime mechanics;
- normalization of SDK call identity, name, input, progress, and cancellation;
- conversion of canonical Tool results back into the matching SDK call;
- SDK-specific structured-output and error encoding;
- truthful capability and schema-profile reporting.

The port does not own:

- canonical Tool identity or registration;
- product Tool-selection policy;
- executor selection or fallback routing;
- Feature implementation;
- confirmation authority;
- canonical Tool-call state or persistence.

An SDK-visible alias is private to one Agent and Tool-set revision. Agent Host
never routes by a bare SDK name. The port resolves the alias through its exact
bijective mapping before emitting the canonical Tool call. If the mapping is
missing or ambiguous, the call fails without trying another Tool.

The same port boundary applies to every executor kind. Host, Agent, MCP, and
Client Tools do not each implement their own SDK conversion layer.

## Function-call lifecycle

One canonical call follows this lifecycle:

```text
Agent SDK emits SDK call identity, alias, and input
    → Agent Tool Port resolves the exact registration
    → Agent Tool Port emits canonical call identity and input
    → Agent Host validates Turn, Tool set, descriptor, schema, and target
    → pending confirmation or running
    → exact executor performs the operation
    → Agent Host validates result schema, status, and bounds
    → completed, denied, cancelled, timed out, or failed
    → canonical result commits to the addressed Turn
    → Agent Tool Port returns the result to the matching SDK call
```

The canonical call addresses one Host authority, Agent, Session, Chat, Turn,
Tool-set revision, Tool ID, descriptor revision, registration, executor, call
ID, and optional target. The Host never reconstructs these identities from an
SDK alias or display name.

Confirmation is scoped to one call and one validated input. Edited input is
validated again. Cancellation is idempotent by canonical call ID. Late progress
or results cannot reopen a terminal call or terminal Turn.

Calls that mutate state or cause external effects carry a stable operation
identity. After uncertain execution, Agent Host reconciles the exact operation
before any retry. It never repeats an effect under a new identity or routes it
to another executor.

## Operations that are not Tools

The following use dedicated contracts rather than the canonical Tool registry:

| Operation | Contract |
|---|---|
| Resolve and submit immutable attachment context | attachment and submission protocol |
| Read a submitted attachment content reference | content-resource protocol |
| Ask the user for structured input | addressed Turn input request |
| Confirm a Tool call | addressed Tool permission request |
| Synchronize descriptors, state, targets, or capabilities | Agent Host connection protocol |
| Open an Editor, navigate a Browser, download, or export | Feature service or command |

An SDK may encode one of these through a private callback or reserved Tool-like
mechanism. The Agent implementation still maps it to the owning Host contract.
SDK encoding does not decide product semantics.

## Persistence and privacy

Canonical Turn history stores Tool ID, descriptor and Tool-set revisions,
executor attribution, bounded auditable input, confirmation outcome, terminal
result, errors, and target metadata. SDK aliases, SDK Tool objects, callbacks,
credentials, connection-local handles, and provider event payloads remain
private and are not canonical history.

Tool schemas, inputs, outputs, and target metadata are untrusted and bounded.
Sensitive values use explicit redaction and persistence policy. Logs never copy
raw credentials or unrestricted content.

## Module layout

```text
src/cs/platform/agentHost/common/          canonical Tool descriptors, schema
                                           profiles, registrations, Tool sets,
                                           calls, results, permissions, and
                                           executor contracts
src/cs/platform/agentHost/node/agents/     Agent implementations and their
                                           SDK-specific Agent Tool Ports
src/cs/platform/agentHost/node/            Tool-set preparation, canonical call
                                           state, routing, and reconciliation
```

Client Tool contributions and their execution protocol are defined in
[Client Tool architecture](CLIENT_TOOLS.md). No Feature contribution imports an
Agent SDK to describe or execute a Tool.

## Adding a Tool

1. Define one stable namespaced Tool ID, descriptor revision, schema profile,
   input and output schemas, safety policy, and limits.
2. Register one exact typed executor implementation from its owning subsystem.
3. Ensure every intended Agent Tool Port can project the descriptor without
   loss and declares the required capability.
4. Add Tool-set preparation, schema, alias, call, result, permission,
   cancellation, and reconciliation tests.
5. Add SDK projection contract tests for every supported Agent.
6. Do not add Agent-ID routing branches, SDK objects to common contracts,
   name-based shadowing, lossy schema conversion, or another execution route.

## Invariants

- Tool semantics, SDK projection, and execution location are separate.
- Every model-visible generic Tool belongs to one accepted canonical Tool-set
  revision.
- Every SDK call maps bijectively to one exact canonical Tool registration.
- Every Agent SDK difference is contained by its Agent Tool Port.
- Every Tool executor receives and returns only canonical call and result data.
- A Client Tool is a Tool with a `client` executor, not an SDK conversion port.
- SDK aliases and private bridge mechanisms never change canonical identity or
  executor ownership.
- Unsupported schema or Tool-set projection fails before Host acceptance.
- Missing Tools, registrations, mappings, targets, executors, permissions, and
  capabilities fail explicitly; nothing falls back to another path.
