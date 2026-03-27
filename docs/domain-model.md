# Comet Domain Model

## Goal

This document defines Comet's core domain objects and their relationships.

It exists to answer a different question than the protocol or architecture docs.

- `architecture.md` explains system layers
- `protocol.md` explains wire payloads
- `runtime-state-machine.md` explains execution phases
- this document explains what the system's core objects mean

Without this layer, the same terms will drift across:

- protocol fields
- runtime code
- app-server APIs
- persistence
- UI rendering

## Scope

This document defines the meaning of:

- session
- thread
- turn
- item
- task
- subagent
- tool call
- patch
- approval
- checkpoint
- verification run

It also classifies each object as primarily:

- durable
- transient
- or mixed

## Design Principles

1. Domain objects should be defined independently of transport.
2. Durable objects should have stable ids.
3. Transient execution phases should not be confused with durable business objects.
4. UI concepts should be derived from domain objects, not replace them.
5. Foreground and background execution should share the same semantic model where possible.

## The Short Version

Comet should use the following mental model:

- a `thread` is the durable conversation container
- a `turn` is one unit of user-visible interaction within a thread
- a `task` is an execution unit that performs work for a turn or background job
- an `item` is a durable record inside a turn
- a `session` is a loaded runtime instance bound to a thread

That means:

- `thread` is the durable history object
- `session` is the live runtime handle
- `turn` is the durable interaction step
- `task` is the runtime execution unit

## Core Objects

## `Thread`

### Definition

A `thread` is the durable conversation container for one line of work.

It owns:

- identity
- metadata
- ordered turns
- durable history
- branch or fork lineage later if needed

### Why Comet Needs It

Comet should support:

- resume
- replay
- branching later
- multiple frontends observing the same history

Those goals require a durable conversation object.

### Durability

`Thread` is durable.

### Suggested fields

- `threadId`
- creation time
- last updated time
- cwd
- model/provider defaults
- current status summary
- optional title or preview

## `Session`

### Definition

A `session` is a loaded runtime instance bound to one thread.

It is the in-memory execution context that owns:

- loaded configuration
- active turn if any
- open provider stream if any
- loaded working set
- in-memory caches
- live approval wait state

### Relationship to `Thread`

A session is not the same thing as a thread.

A thread can exist durably without being loaded.
A session exists only while the runtime has loaded that thread for active work.

Recommended relationship:

- one thread may have zero or one active local session in the first version
- later, multiple observing clients may attach to the same session

### Durability

`Session` is primarily transient.

Its identity may be durable for operational purposes, but its main purpose is live runtime state.

## `Turn`

### Definition

A `turn` is one user-visible interaction step inside a thread.

A turn usually begins when:

- the user submits new input
- the system starts a background continuation that should appear as a distinct interaction step

A turn usually ends when:

- the agent produces a final visible answer
- the turn is interrupted
- the turn fails

### What a Turn Owns

A turn owns:

- user input for that interaction
- agent-visible execution history for that interaction
- generated items
- final status
- token or usage summary later if needed

### Why Turn Is Not Task

A turn is a product-visible unit.
A task is an execution unit.

One turn usually has one primary task in foreground mode, but they are not the same concept.

### Durability

`Turn` is durable.

## `Item`

### Definition

An `item` is a durable record that belongs to one turn.

Items are the pieces that make up what happened during the turn.

Examples:

- user message
- agent message
- reasoning block
- tool call record
- tool result record
- patch proposal
- approval request
- approval decision
- verification result

### Why This Object Matters

The system should not persist only "raw event stream forever" and hope the UI infers structure.

Turns need durable structured content that can be re-read later.

### Durability

`Item` is durable.

### Important distinction

Not every event becomes an item.

Some events are operational only.

Example:

- stream chunk deltas are useful for UI streaming
- final agent message item is the durable conversational record

## `Task`

### Definition

A `task` is an execution unit that performs work on behalf of the system.

Examples:

- the main foreground execution for a turn
- a background run detached from immediate UI attention
- a delegated subagent execution
- a verification task later if explicitly modeled separately

### Why This Object Exists

Comet needs a concept that captures runtime execution without overloading `turn`.

This matters because:

- a background run may outlive immediate foreground interaction
- subagents may run independently
- one turn may eventually coordinate more than one execution unit

### Relationship to `Turn`

Recommended first model:

- a foreground turn has one primary task
- later, a turn may spawn child tasks or subagent tasks

### Durability

`Task` is mixed.

Its operational state is transient, but its identity and final outcome should become durable when task lifecycle is product-visible.

## `Subagent`

### Definition

A `subagent` is a specialized child execution unit created by a parent task.

It should not be treated as "just another tool call".

It is closer to:

- a delegated task
- with its own lifecycle
- and its own result surface

### Relationship to `Task`

Recommended model:

- every subagent is implemented as a specialized task
- not every task is a subagent

This lets Comet share task infrastructure while still exposing subagent-specific semantics.

### Durability

`Subagent` is mixed.

Its live execution state is transient, but its lifecycle and result may be durable if surfaced in product UX.

## `ToolCall`

### Definition

A `tool call` is one request for a tool to perform a concrete action.

It includes:

- tool identity
- input
- call id
- execution metadata
- result or failure

### Why It Is Not A Task

A tool call is narrower than a task.

A task may contain:

- many tool calls
- provider interaction
- planning
- verification

A tool call is only one action inside that execution.

### Durability

`ToolCall` is mixed.

The full live stream may be transient, but the request/result record should usually become durable as an item.

## `Patch`

### Definition

A `patch` is a proposed or applied workspace mutation artifact.

It is not identical to a tool call.

A patch may be:

- produced by a tool
- proposed by runtime synthesis
- reviewed before application
- linked to checkpoint and approval state

### Why It Needs Its Own Object

Comet wants:

- patch review
- patch approval
- patch application
- rollback links

Those are product semantics, not just tool execution details.

### Durability

`Patch` is durable.

## `Approval`

### Definition

An `approval` is a durable decision point for a gated action.

It should capture:

- what action was blocked
- why it required approval
- who or what made the decision
- what decision was made
- when it was made

### Why It Is Not Just An Event

Approval is not merely "a prompt shown to the user".

It is a recoverable control object.

That matters for:

- reconnect
- replay
- audit
- background execution

### Durability

`Approval` is durable.

## `Checkpoint`

### Definition

A `checkpoint` is a recoverability object that captures enough state to restore workspace changes safely.

In the first version it is primarily about workspace mutation rollback.

### What It Owns

- checkpoint id
- owning thread and turn
- reason
- affected files
- restore data
- origin linkage to patch or tool call

### Durability

`Checkpoint` is durable.

## `VerificationRun`

### Definition

A `verification run` is a distinct record of validation work performed after or during a turn.

Examples:

- targeted test run
- lint run
- build
- syntax check

### Why It Needs Its Own Object

Verification should not be flattened into generic tool output if the product wants to show:

- what was verified
- whether it passed
- what command or checker ran
- which patch it validated

### Durability

`VerificationRun` is durable once surfaced in UI or used for audit.

## Relationships

The recommended object relationship graph is:

```text
thread
  -> turns
  -> checkpoints

session
  -> loaded thread
  -> active task?

turn
  -> items
  -> primary task
  -> approvals
  -> patches
  -> verification runs

task
  -> tool calls
  -> child subagents?

patch
  -> checkpoint
  -> approval?

approval
  -> target object
    -> tool call
    -> patch
    -> subagent action
```

## Foreground vs Background Semantics

These objects should be shared across foreground and background modes:

- thread
- turn
- item
- approval
- checkpoint
- patch

These objects may differ in lifecycle behavior across modes:

- session
- task
- subagent

That means Comet should not create a separate domain language for background work.

It should reuse the same domain objects with different runtime policies.

## What Is Durable vs Transient

### Durable by default

- thread
- turn
- item
- patch
- approval
- checkpoint
- verification run

### Transient by default

- session
- stream chunk
- in-flight provider connection
- in-memory retrieval cache

### Mixed

- task
- subagent
- tool call

Mixed objects have both:

- transient execution state
- durable summary or result state

## Naming Decisions

The following naming choices are recommended.

### Prefer `thread` over `session` for durable conversation history

`session` should refer to live runtime state.

### Prefer `turn` over `task` for user-visible interaction unit

`turn` is what the user sees in conversation history.

### Keep `task` for runtime execution units

This leaves room for:

- background tasks
- child tasks
- delegated tasks

### Treat `item` as the durable content atom

This keeps event streams and durable records separate.

## Consequences For Other Docs

This document implies the following interpretations.

### For `protocol.md`

- `ClientCommand` and `ServerEvent` should map to domain objects, not invent new unnamed concepts
- future task and subagent protocol should reuse this terminology

### For `runtime-state-machine.md`

- the state machine acts on sessions, turns, and tasks
- state phases should not be mistaken for domain objects

### For `app-server-api.md`

- thread lifecycle APIs should be the primary durable API surface
- session metadata can remain an operational wrapper around loaded threads

### For `checkpoint-and-rollback.md`

- checkpoint is a first-class durable object linked to turns and patches

## Immediate Recommendation

Use this domain model going forward:

1. durable conversation container: `Thread`
2. live loaded runtime handle: `Session`
3. user-visible interaction step: `Turn`
4. durable content atom: `Item`
5. execution unit: `Task`
6. delegated execution unit: `Subagent`
7. recoverability object: `Checkpoint`
8. gated decision object: `Approval`
9. mutation artifact: `Patch`
10. validation artifact: `VerificationRun`
