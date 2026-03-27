# Comet Orchestration Model

## Goal

This document defines Comet's orchestration model after comparing:

- Cursor's foreground agent and background agent behavior
- Codex's harness, thread, turn, and approval model

The purpose is to answer one practical question:

What should Comet copy, and what should it deliberately not copy?

## Short Answer

Comet should not copy either Cursor or Codex wholesale.

Comet should use:

- Cursor's foreground orchestration patterns for speed and interaction feel
- Codex's durable harness patterns for state, approvals, replay, and lifecycle

That means Comet should have:

- one durable orchestration core
- two execution shapes

Those two execution shapes are:

1. foreground local agent
2. background durable agent

## Source Basis

This decision is based on:

- local Cursor research documents under `docs/research/cursor/agent`
- official Cursor docs for planning, agent mode, and background agents
- local Codex docs and app-server protocol design in `codex-rs`

Important local references:

- `cursor-agent-protocol.md`
- `cursor-agent-tool-scheduling-thinking.md`
- `cursor-agent-field-map.md`
- `cursor-agent-context-orchestration.md`
- `codex-rs/docs/protocol_v1.md`
- `codex-rs/app-server/README.md`

## Cursor's Real Orchestration Shape

Cursor is not just "a fast UI".

Its orchestration has at least two different shapes.

### 1. Foreground Agent

Foreground agent behavior is optimized for:

- fast first feedback
- rich IDE context injection
- aggressive local tool execution
- interactive multi-step editing

The observed protocol shape is:

- large request envelope
- bidi stream
- server-driven tool requests
- client-side tool execution
- tool result reinjection into the same stream
- optional planning/subagent/task fields

Key observed properties:

- `StreamUnifiedChatRequest` is large and context-heavy
- tool execution is modeled with `ClientSideToolV2Call` and `ClientSideToolV2Result`
- reliability is explicit with `idempotency_key`, `seqno`, and `seqno_ack`
- task/subagent flows are protocolized
- retrieval output is serialized into request fields, not hidden in prompt text

This is a protocol-centered orchestration design.

### 2. Background Agent

Cursor also has a background execution shape.

This shape is optimized for:

- long-running work
- detached execution
- remote or isolated execution environments
- asynchronous task completion

This is not just "the same foreground agent but slower".

It is a different product behavior:

- durable task identity
- delayed completion
- resumable observation
- explicit lifecycle around long-running work

## Codex's Real Orchestration Shape

Codex is not just "a slower agent".

Its orchestration is more explicit about:

- threads
- turns
- items
- approvals
- interruption
- replay and persistence
- app-server transport

Important properties from local Codex docs:

- one thread owns multiple turns
- one turn is the unit of active execution
- approvals suspend execution explicitly
- turns can be resumed or forked
- app-server is a durable control surface, not just a thin proxy

This is a harness-centered orchestration design.

## What Comet Should Learn From Cursor

Comet should directly learn these things from Cursor.

### Rich Request Assembly

Foreground speed depends heavily on preparing a strong request envelope up front.

Comet should preserve and keep expanding:

- `ContextPackage`
- `ConversationSummary`
- `ToolPermissionContext`
- planning hints
- ranked retrieval context
- diagnostics
- recent edits
- repository and environment info

This already aligns with [protocol.md](/Users/lance/Desktop/comet/docs/protocol.md).

### Tool Call Round-Tripping In Stream

Cursor gets a lot of interaction quality from a tight loop:

1. model requests tool
2. local executor runs it
3. result is reinjected immediately
4. model continues without rebuilding a new outer workflow

Comet should preserve this interaction model in its provider-facing protocol and runtime loop.

### Reliability Envelope

Foreground streaming must be resumable and replayable.

Comet should keep:

- `ReliableClientEnvelope`
- `ReliableServerEnvelope`
- `idempotencyKey`
- `seqno`
- `seqnoAck`

These should not be treated as optional polish.

### Task And Subagent Protocol

Cursor is correct that subagents and async tasks should not stay implicit forever.

Comet should promote task and subagent lifecycle into protocol once the core loop is stable.

## What Comet Should Learn From Codex

Comet should directly learn these things from Codex.

### Durable Core Lifecycle

Comet should keep an explicit durable model:

- thread identity as the durable owner
- session identity as the live operational handle
- turn identity
- event log
- checkpoint lifecycle
- interruption semantics
- replay semantics

Cursor's protocol is strong, but Codex's lifecycle semantics are clearer.

### Approval And Safety As First-Class Runtime State

Codex is correct that approval, sandboxing, and interruption belong to the runtime control plane.

Comet should not push these concerns into the frontend.

They should stay owned by Rust runtime state and durable event history.

### Thread/Turn Separation

Codex's separation between long-lived thread and active turn is useful.

Comet should keep:

- durable conversation container
- one active execution unit at a time per foreground session
- explicit branching or fork semantics later

### App-Server Style Durable Control Plane

Comet should eventually expose a durable app-server-style API for:

- starting or resuming work
- streaming events
- approvals
- file operations
- background task management

This is especially important if Comet later supports:

- TUI
- IDE
- web client
- background worker

## What Comet Should Not Copy Blindly

### Do Not Copy Cursor's Entire Request Surface Immediately

Cursor's request schema is much larger than what Comet needs initially.

Copy categories, not every field.

### Do Not Copy Codex's Foreground Interaction Feel As-Is

Codex's durable harness is useful, but by itself it does not guarantee Cursor-like responsiveness.

Foreground responsiveness needs separate optimization.

### Do Not Split Product Semantics Across Two Different Internal Languages

Comet should still use one internal protocol.

Foreground and background modes should share:

- command language
- event language
- tool ABI
- approval semantics

## The Comet Model

Comet should adopt this model:

### One Durable Core

Rust runtime owns:

- state machine
- approvals
- sandbox policy
- tool dispatch
- provider interaction
- event log
- replay
- checkpointing

### Two Execution Shapes

#### Foreground Local Agent

Optimized for:

- low latency
- IDE or TUI interaction
- aggressive local context gathering
- frequent visible status updates
- quick patch preview

This shape should feel closer to Cursor.

#### Background Durable Agent

Optimized for:

- long-running execution
- detached progress
- resumability
- durable event history
- explicit task lifecycle

This shape should feel closer to Codex app-server plus Cursor background agents.

## Concrete Implications For Comet Protocol

The current protocol direction is still correct, but it needs to be interpreted this way:

- `ClientCommand` and `ServerEvent` are the shared control surface
- `ProviderTurnRequest` is the rich foreground model-facing envelope
- `Reliable*Envelope` supports resumable streaming
- later task/subagent protocol should support background execution

This means [protocol.md](/Users/lance/Desktop/comet/docs/protocol.md) is directionally correct, but it should be read as supporting both foreground and background orchestration, not just one chat loop.

## Concrete Implications For Comet Runtime

The current runtime skeleton is not complete enough yet.

The runtime must eventually separate:

- durable control plane
- foreground hot path
- background execution path

Suggested runtime components:

1. `SessionManager`
2. `TurnExecutor`
3. `ProviderAdapter`
4. `EventSink`
5. `ApprovalManager`
6. `CheckpointManager`
7. `BackgroundTaskManager`

The important point is:

foreground and background execution should share the same durable semantics even if their latency strategies differ.

## Decision

Comet should not be described as:

- "Codex-style orchestration"
- "Cursor-style orchestration"

Comet should be described as:

- Cursor-style foreground orchestration
- Codex-style durable control plane
- one shared internal protocol and runtime semantics

That is the intended architecture.

## Immediate Next Steps

1. Keep `protocol` as the canonical internal language.
2. Expand `core` from a stub into a real turn executor.
3. Add an `app-server` crate for durable control-plane APIs.
4. Add one provider adapter path inside `comet-api`, likely OpenAI first.
5. Add task and subagent lifecycle only after the main foreground loop works.
