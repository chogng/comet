# Comet Architecture

## Goal

Comet is a Rust-first agent product for coding workflows.

Rust owns the runtime, orchestration, tool execution, safety, state, and persistence.
TypeScript is used only for frontend clients that render state and send user commands.

The architecture is designed to:

- support multiple model providers without leaking provider-specific protocol into the core
- support multiple clients including TUI, web, and IDE shells
- keep tool execution and safety decisions inside Rust
- make thread history replayable and auditable
- make loaded sessions resumable when safe

## Domain Alignment

Comet should separate durable conversation state from live runtime state.

- `thread` is the durable conversation container and persistence owner
- `session` is the live loaded runtime handle bound to one thread
- `turn` is the durable user-visible interaction step inside a thread

This means:

- storage and replay center on `thread`
- transport and foreground control may still target `session`
- the runtime loads a thread into a session for active work

## Design Principles

1. Keep provider protocol at the edge.
2. Keep one internal runtime protocol for the whole product.
3. Keep tool execution behind a stable ABI.
4. Make safety and approval first-class, not bolt-ons.
5. Treat orchestration as a state machine, not as a chat loop.
6. Make event logging and replay part of the core design.

## High-Level System

```text
                +----------------------+
                |   TS Frontend UI     |
                | web / desktop / IDE  |
                +----------+-----------+
                           |
                           | commands + event stream
                           v
                +----------------------+
                |  Rust App Server     |
                | API / session edge   |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |    Rust Core Engine  |
                |  thread-backed core  |
                +----+-----+-----+-----+
                     |     |     |
                     |     |     |
                     v     v     v
               +----------------------------------+
               | tools / safety / context / memory|
               | checkpoint / storage             |
               +----------------------------------+
                     |             |
                     v             v
               +-------------------------+
               | FS / Git / Exec / Index |
               | MCP / Web / Memory      |
               +-------------------------+
                     ^
                     |
               +-----+-------------------+
               | comet-client transport  |
               | HTTP / SSE / WS / IPC   |
               +-----+-------------------+
                     ^
                     |
               +-----+-------------------+
               | comet-api adapters      |
               | OpenAI / Anthropic /    |
               | local / future adapters |
               +-------------------------+
```

## Layer Breakdown

### 1. Client Layer

The client layer is responsible for presentation and user interaction only.

Examples:

- Rust TUI client
- TypeScript web frontend
- TypeScript desktop shell
- IDE extension frontend

Responsibilities:

- render messages, deltas, tool status, plans, approvals, diffs, checkpoints
- collect user input
- send commands to the app server
- subscribe to runtime events
- derive stable approval and patch view models from runtime events rather than inventing frontend-only business logic

Non-responsibilities:

- tool execution
- provider protocol handling
- patch application
- approval policy decisions
- runtime orchestration

### 2. App Server Layer

The app server is the boundary between clients and the runtime.

Responsibilities:

- expose command submission APIs
- expose event streaming APIs
- expose thread read APIs backed by the shared runtime `ThreadReadModel`
- manage session creation, attach, and client subscriptions
- authenticate or identify frontend clients if needed
- translate transport concerns into runtime calls

Recommended transports:

- WebSocket for bidirectional clients
- SSE for event streaming
- HTTP POST for one-shot commands

The app server must stay thin. It should not own orchestration logic.

### 3. Runtime Core

The runtime core is the heart of the product.

Main responsibilities:

- load threads into live sessions
- create turns and tasks within those sessions
- maintain orchestration state
- decide what context to gather
- call model providers through adapters
- receive tool requests from providers
- apply policy and approval checks
- dispatch tool execution
- emit canonical runtime events
- checkpoint important state transitions
- write durable thread records and optional operational session records

Important invariant:

All internal subsystems communicate through Comet's internal protocol, not provider-native protocol.

### 4. Provider Adapter Layer

Provider adapters translate between external model APIs and Comet's internal runtime protocol.

Examples:

- OpenAI Responses adapter
- Anthropic adapter
- local model adapter
- future compatibility adapters

Responsibilities:

- convert runtime requests into provider requests
- stream provider deltas into internal events
- normalize provider tool calls into internal tool-call requests
- convert tool results back into provider-compatible continuation payloads

Provider adapters are the only place where provider-specific shapes should appear.
They should not become the shared home for generic HTTP, SSE, or reconnect logic if that logic is reusable across adapters.

### 4a. Transport Client Layer

Comet should add a dedicated transport client layer for reusable connection mechanics.

Recommended crate:

- `comet-rs/comet-client`

Responsibilities:

- own reusable HTTP client setup
- own SSE and future WebSocket or IPC client helpers
- own generic retry, timeout, and connection lifecycle helpers
- keep transport concerns separate from provider protocol translation

Strict boundary:

- `comet-client` owns transport mechanics only: HTTP client behavior, SSE parsing, retry, timeout, connection lifecycle, and generic header helpers
- `comet-api/<provider>` owns provider API concerns: endpoint paths, auth conventions, request and response JSON shapes, streaming event semantics, error-body parsing, and mapping into Comet internal protocol

See also:

- [Provider Boundary Rules](./provider-boundary-rules.md)

This keeps the architectural split clean:

- `comet-api` is protocol adaptation
- `comet-client` is transport execution
- `app-server` is server-side transport exposure

### 5. Tool Execution Layer

The tool layer provides a stable interface for the runtime to execute actions.

Core tool families:

- filesystem tools
- search tools
- patch tools
- command execution tools
- git tools
- web tools
- MCP tools
- planning and memory tools

Responsibilities:

- validate tool input
- execute within the selected sandbox
- stream progress when relevant
- produce structured result objects
- expose enough metadata for approval, auditing, and replay

### 6. Safety Layer

Safety is a dedicated subsystem, not a feature hidden inside tool code.

Responsibilities:

- evaluate approval policy
- classify risky tool calls
- enforce sandbox policy
- control write scope
- gate network access
- manage rollback and checkpoint restore

Recommended initial policies:

- `read-only`
- `workspace-write`
- `danger-full-access`

Recommended approval modes:

- `always`
- `on-request`
- `never`
- per-tool overrides

### 7. Context Engine

The context engine manages retrieval and prompt packing.

Responsibilities:

- maintain working set
- manage retrieval triggers
- gather lexical, symbolic, and semantic context
- deduplicate already-seen chunks
- enforce context budget
- package relevant state for the provider adapter

The context engine should be explicit and inspectable. It must not be buried in prompt text alone.

### 8. Persistence Layer

Persistence stores the durable state needed to resume, replay, and inspect threads, and enough operational metadata to rehydrate sessions when needed.

Recommended stored artifacts:

- thread metadata
- turn and item records
- append-only event log
- checkpoints
- patch history
- tool call history
- context decisions
- memory/index metadata
- optional operational session metadata

## Loaded Session Lifecycle

```text
create or load thread
-> attach or create session for thread
-> accept user turn
-> update orchestration state
-> retrieve and pack context
-> call provider
-> receive deltas or tool requests
-> evaluate safety policy
-> execute tool
-> emit tool results
-> continue provider loop
-> propose/apply patch
-> verify
-> checkpoint
-> complete turn and keep thread durable
-> await next turn or unload session
```

## Recommended Rust Workspace

```text
comet/
  docs/
  comet-rs/
    protocol/
    core/
    comet-client/
    comet-api/
    app-server/
    tui/
```

## Crate Responsibilities

### `protocol`

Defines internal commands, events, shared value types, and transport-safe payloads.

### `core`

Owns loaded sessions, turn processing, orchestration state, and the runtime loop over thread-backed work.

### `app-server`

Exposes runtime functionality to frontend clients over network or local IPC.

### `comet-api`

Implements provider-specific protocol adapters such as OpenAI and Anthropic over the provider-facing traits from `core`.

It may depend on `comet-client` for transport helpers, but it should remain the owner of provider semantics rather than reusable transport machinery.

### `comet-client`

Implements reusable transport clients and stream helpers used by provider adapters or local Rust clients.

### `tui`

Implements the Rust terminal frontend.

## Recommended MVP Scope

The first version should aim for a terminal-first agent, not a full Cursor clone.

MVP core features:

- single foreground session over one loaded thread
- one provider adapter
- tool execution loop
- approval requests
- patch proposal and application
- checkpoint before write
- basic verification
- event streaming

MVP tools:

- `list_dir`
- `read_file`
- `grep`
- `search_symbol`
- `edit_file`
- `apply_patch`
- `exec_command`
- `write_stdin`

MVP clients:

- one Rust TUI or one TS frontend

Deferred features:

- semantic retrieval
- shadow workspace
- multi-agent
- editor-native synchronization
- collaborative thread observation

## Recommended Build Sequence

The build order should stay narrow and execution-oriented:

1. stabilize domain and protocol semantics
2. keep the workspace shape visible
3. implement `protocol`
4. implement tool and storage modules inside `core`
5. implement the foreground `core` loop
6. add checkpoint and replay flow inside `core`
7. add the first provider adapter
8. ship the Rust TUI loop
9. add `app-server`
10. expand retrieval, richer metadata, and later background execution

This keeps the first product focused on one complete foreground loop instead of prematurely chasing full Cursor surface area.

## Architecture Constraints

1. Do not let provider-specific event formats leak into `core`.
2. Do not let frontend clients perform privileged actions directly.
3. Do not couple patch application to UI state.
4. Do not make orchestration depend on any single frontend.
5. Do not treat tool output as untrusted-free text; keep structured results whenever possible.

## Near-Term Build Order

1. Define `protocol`.
2. Build `core` orchestration loop.
3. Build tool implementations inside `core`.
4. Add safety inside `core`.
5. Add `comet-api` with OpenAI first.
6. Add `app-server`.
7. Add first client.
8. Add retrieval and richer memory inside `core`.
