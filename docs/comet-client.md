# Comet Client Layer

## Goal

This document defines the transport client boundary inside the Rust workspace.

Comet needs a layer that is narrower than `app-server` and more reusable than provider-specific adapter modules.

The purpose of `comet-client` is to:

- own reusable transport mechanics
- keep HTTP, SSE, WebSocket, and IPC concerns out of protocol mapping code
- let `comet-api`, `tui`, and future Rust-side clients share connection machinery without sharing provider semantics

## Why This Boundary Matters

Without a dedicated transport client layer, `comet-api` tends to accumulate both:

- provider protocol translation
- low-level HTTP or streaming machinery

That mix is workable for an MVP, but it is the wrong long-term boundary.

Provider adapters should answer questions like:

- how does OpenAI express a tool call?
- which event types map to Comet `TextDelta` or `ToolCallRequested`?
- how should provider errors be normalized?

The transport client layer should answer different questions:

- how do we issue an authenticated HTTP request?
- how do we consume SSE frames correctly?
- how do we configure retries, timeouts, and backoff?
- how do we share connection setup across adapters or Rust clients?

Those are separate responsibilities and should stay separate.

## Recommended Crate

```text
comet-rs/comet-client
```

This crate should be reusable from:

- `comet-api`
- `tui`
- future local Rust CLIs or test harnesses

It should not depend on:

- `core`
- frontend rendering code
- provider-specific protocol mapping modules

## Responsibilities

`comet-client` should own:

- HTTP client construction
- shared header and auth injection helpers where the concern is transport-level
- SSE frame parsing
- future WebSocket helpers
- future IPC or local socket helpers
- timeout and retry helpers
- connection lifecycle utilities

In concrete terms, `comet-client` is the place for:

- HTTP client behavior
- SSE parsing
- retry, timeout, and connection lifecycle mechanics
- generic header builders where the helper is transport-level rather than provider-specific

`comet-client` should not own:

- OpenAI request body construction
- Anthropic event semantics
- Comet runtime orchestration
- app-server route handlers
- frontend state reducers

It also should not own provider-specific concerns such as:

- endpoint paths
- auth conventions for a specific provider API
- request and response JSON shapes
- streaming event semantics
- provider error-body parsing
- mapping external provider protocol into Comet `ProviderStreamEvent`

## Relationship To Other Crates

### `comet-api`

`comet-api` is the provider protocol layer.

It should:

- build provider-native requests
- interpret provider-native event types
- map tool calls and tool results
- normalize provider failures

More concretely, each provider module inside `comet-api` should own:

- endpoint paths
- auth conventions as used by that provider API
- request body structure
- response JSON structure
- streaming event semantics
- provider error-body parsing
- final mapping into Comet internal provider events such as `ProviderStreamEvent`

It may use `comet-client` for transport helpers, but it should not become the shared home for generic transport logic.

### `app-server`

`app-server` is the server-side transport boundary.

It exposes:

- HTTP endpoints
- SSE or WebSocket streams
- request validation and session attachment

That is a different concern from a reusable client crate.

### `tui`

The TUI may either:

- talk to `core` directly in a local-only mode
- or talk to `app-server` through `comet-client`

The important point is that the TUI should not need to implement its own ad hoc transport stack if a reusable Rust client already exists.

## Recommended Initial Module Shape

Suggested layout:

```text
comet-rs/comet-client/
  src/
    lib.rs
    http/
      mod.rs
      auth.rs
      client.rs
      async_client.rs
      error.rs
    policy.rs
    sse.rs
```

Possible later additions:

```text
    websocket.rs
    ipc.rs
    retry.rs
```

## Initial MVP Scope

The first version of `comet-client` should stay narrow.

Recommended first exports:

- blocking HTTP client helpers
- SSE event reader utilities
- small transport error types

Current MVP status:

- `http.rs` already owns blocking authenticated JSON POST helpers plus transport error types
- `http.rs` now exposes both blocking and async HTTP transport clients
- `policy.rs` now owns reusable timeout and retry policy types
- `sse.rs` already owns generic SSE frame parsing and incremental event reading
- provider-specific endpoint/auth/request wiring stays in `comet-api`

Deferred:

- WebSocket client helpers
- resumable stream reconnection helpers
- cross-process local IPC client support

## SSE Boundary

The split for SSE should be:

1. `comet-client` reads transport frames
2. `comet-api/openai` interprets OpenAI event payloads
3. `core` consumes normalized `ProviderStreamEvent`

In other words:

```text
raw bytes
-> transport SSE parser
-> provider-specific event JSON
-> Comet provider event mapping
-> runtime reducer
```

This is the right separation because:

- frame parsing is transport logic
- event interpretation is provider logic

## Error Boundary

Transport-layer failures should be represented separately from provider semantic failures.

Examples of transport-layer failures:

- TCP connection failure
- timeout before response
- malformed SSE frame
- truncated stream

Examples of provider semantic failures:

- provider returned `error` event
- provider returned invalid tool arguments
- provider returned an unsupported response shape

Both may eventually map into `RuntimeError`, but they should not originate from the same responsibility layer.

## Core Invariant

If the same HTTP or SSE helper could reasonably be reused by both:

- an OpenAI provider adapter
- and a future Rust client for app-server streaming

then that helper belongs in `comet-client`, not in `comet-api`.
