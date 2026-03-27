# Comet Crate Layout

## Goal

This document defines the recommended Rust workspace structure for Comet.

The purpose is to:

- keep the number of top-level crates small
- split only on stable architectural boundaries
- avoid premature crate fragmentation
- keep provider and frontend concerns out of the core engine

## Recommended Workspace

Recommended top-level layout:

```text
comet/
  docs/
  comet-rs/
    protocol/
    config/
    core/
    comet-client/
    comet-api/
    app-server/
    tui/
```

## Core Decision

Top-level crates should represent stable system boundaries, not every internal capability.

That means:

- `protocol` is the shared language boundary
- `config` is the configuration loading and resolution boundary
- `core` is the orchestration engine boundary
- `comet-client` is the reusable transport client boundary
- `comet-api` is the external model adapter boundary
- `app-server` is the frontend transport boundary
- `tui` is the local frontend boundary

Capabilities such as tools, storage, memory, context, checkpointing, and safety should begin life as internal modules inside `core`.

## Dependency Principles

1. `protocol` should be the lowest shared layer.
2. `config` depends on `protocol`, not on `core`.
3. `core` depends on `protocol` and may depend on `config`.
4. `comet-client` depends on `protocol` and transport libraries, but not on `core`.
5. `comet-api` depends on `protocol`, provider-facing traits from `core`, and may depend on `comet-client`.
6. `app-server` depends on `protocol`, `core`, and may depend on `config` for startup or profile resolution.
7. `tui` depends on `protocol` and either `app-server`, `comet-client`, or `core`, depending on startup mode.
8. Provider SDKs and provider-specific transport code should stay behind `comet-api` plus `comet-client`, not leak into `core`.

## `protocol`

Purpose:

- define shared commands
- define shared events
- define shared domain types
- define transport-safe payloads

Should contain:

- `ClientCommand`
- `ServerEvent`
- command and event envelopes
- thread and session descriptors
- tool metadata types
- approval types
- checkpoint summary types

Should not contain:

- provider SDK types
- orchestration logic
- storage code
- tool implementations

## `core`

Purpose:

- own thread load and session lifecycle
- own turn lifecycle
- run the orchestrator loop
- own runtime state machine semantics
- coordinate providers, tools, safety, context, memory, checkpointing, and storage

Recommended internal modules:

- `orchestrator`
- `state_machine`
- `thread`
- `turn`
- `task`
- `tools`
- `safety`
- `context`
- `memory`
- `checkpoint`
- `storage`
- `providers`

Should contain:

- provider-facing traits
- tool trait and registry
- orchestration state
- replay coordination
- checkpoint coordination
- persistence interfaces or concrete MVP persistence

Should depend on:

- `protocol`

Should not depend on:

- TS frontend code
- HTTP framework details
- provider SDKs directly

### Why These Stay Inside `core`

`tools`, `storage`, `memory`, `context`, `checkpoint`, and `safety` are real subsystems, but they are still part of one tightly coupled engine.

They should remain internal `core` modules at first because:

- tool execution is tightly coupled to approval, checkpoint, and replay
- storage is domain storage for threads, turns, logs, and checkpoints
- memory is part of retrieval and context engineering
- checkpointing is part of mutation safety
- safety policy is part of runtime control flow

If one of these areas later needs an independently reusable API, it can be extracted from `core` after the boundary proves real.

## `config`

Purpose:

- locate config files
- parse and validate `config.toml`
- resolve provider profiles and model aliases
- merge built-in, user, workspace, session, and subagent overrides
- produce immutable resolved snapshots for runtime consumption

Should contain:

- config file discovery
- TOML schema types
- merge and precedence logic
- profile inheritance and include handling
- secret reference types
- resolved config snapshot types

Should depend on:

- `protocol`

Should not contain:

- runtime session state
- thread persistence logic
- provider HTTP clients
- frontend rendering code

## `comet-api`

Purpose:

- implement external model provider adapters
- translate provider-native protocols into Comet provider-facing traits
- own provider protocol semantics, not generic transport bootstrapping

Recommended internal modules:

- `openai`
- `anthropic`
- later additional providers

Should contain:

- request builders
- stream parsers
- provider event normalization
- tool call and continuation mapping
- provider error mapping
- provider-specific protocol translation logic
- provider endpoint paths and auth conventions
- provider request and response JSON shapes
- provider streaming event semantics and error-body parsing

Should depend on:

- `protocol`
- `core`
- `comet-client` when a shared transport helper is useful

Should not contain:

- TOML parsing
- config file discovery
- generic HTTP, SSE, WebSocket, or retry client abstractions shared across boundaries
- frontend logic
- app-server transport code
- durable thread or session management

## `comet-client`

Purpose:

- provide reusable transport clients and stream helpers
- isolate HTTP, SSE, WebSocket, auth header, retry, and connection lifecycle mechanics
- keep transport concerns reusable across provider adapters and frontend-facing Rust clients

Should contain:

- HTTP client setup
- SSE frame parsing
- WebSocket or IPC client helpers later if needed
- retry and timeout policy helpers
- auth and header injection helpers where the concern is transport-level rather than provider-semantic

Boundary rule:

- if a helper can be shared across OpenAI, Anthropic, and future providers, it belongs in `comet-client`
- if a helper knows a provider endpoint, provider auth convention, provider JSON field, or provider event type, it belongs in `comet-api/<provider>`

See also:

- [Provider Boundary Rules](./provider-boundary-rules.md)

Should depend on:

- `protocol` only when transport helpers need shared envelope types

Should not contain:

- provider protocol mapping
- runtime orchestration logic
- frontend rendering logic
- app-server route handling

## `app-server`

Purpose:

- expose Comet over HTTP, SSE, WebSocket, or local IPC

Should contain:

- route handlers
- transport adapters
- request validation
- thread event subscriptions
- optional live session attachment management

Should depend on:

- `protocol`
- `core`

Should not contain:

- orchestration policy
- provider SDK usage
- tool execution logic

## `tui`

Purpose:

- provide the local Rust terminal frontend

Should contain:

- terminal UI state
- event rendering
- input composition
- local bootstrapping or app-server client usage through `comet-client`

Should depend on:

- `protocol`
- `comet-client`, `app-server`, or `core` for intentionally local-only startup

It should not own orchestration logic.

## Recommended `core` Module Shape

Suggested layout:

```text
comet-rs/core/
  src/
    lib.rs
    orchestrator/
    state_machine/
    thread/
    turn/
    task/
    tools/
    safety/
    context/
    memory/
    checkpoint/
    storage/
    providers/
```

## Recommended Dependency Graph

Suggested shape:

```text
protocol
   ^
   |
 core <---- comet-api <---- comet-client
   ^
   |
app-server
   ^
   |
  tui
```

## Traits To Stabilize Early

The following interfaces should be defined early and kept stable:

- provider adapter trait
- tool trait
- event sink or event publisher trait
- storage append and replay interface
- checkpoint restore interface

Stabilizing these early prevents churn inside `core`.

## MVP Build Order

Recommended order:

1. `protocol`
2. `core`
3. `comet-api`
4. `app-server`
5. `tui`

Within `core`, recommended internal build order:

1. domain objects
2. state machine
3. tool trait and registry
4. safety policy
5. checkpoint flow
6. storage and replay
7. context and memory
8. orchestrator loop

## Anti-Patterns To Avoid

1. `protocol` depending on `core` or provider code
2. `comet-api` leaking provider-native events into client-facing protocol
3. `comet-api` growing into a generic transport utility crate
4. `app-server` owning orchestration logic
5. splitting every subsystem into a top-level crate before the boundaries are stable
6. circular dependencies between `core` internals and provider adapters
7. treating `storage` or `memory` as generic infrastructure before the Comet domain model is stable

## Core Invariant

If a top-level crate can change implementation without forcing the rest of the system to learn a new language, that crate boundary is probably correct.
