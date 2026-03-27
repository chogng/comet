# Comet OpenAI Provider Adapter

## Goal

This document defines how Comet should integrate with OpenAI as a provider without leaking OpenAI-native protocol into the runtime core.

The adapter exists to:

- translate Comet turn requests into OpenAI requests
- interpret OpenAI streaming responses
- normalize provider output into Comet runtime events
- map Comet tool results back into provider continuation input

## Design Principles

1. OpenAI-specific payload shapes stay inside the adapter crate.
2. The adapter translates provider semantics into Comet semantics.
3. The runtime should not need to know OpenAI response item formats.
4. Tool use should be mapped into Comet tool requests, not passed through raw.
5. Streaming should preserve partial deltas while still producing canonical completion events.

## Crate Placement

Recommended crate:

- `comet-rs/comet-api`

Recommended supporting transport crate:

- `comet-rs/comet-client`

This crate should depend on:

- `protocol`
- provider-facing traits from `core`
- `comet-client` for reusable HTTP or SSE transport helpers
- OpenAI client SDK only if the provider semantic layer still needs it directly

It should not depend on:

- frontend code
- app-server transport code
- concrete tool implementations
- reusable frontend transport client logic that belongs in `comet-client`

## Adapter Responsibilities

The OpenAI adapter is responsible for:

- building provider request payloads
- translating context packages into provider input
- interpreting provider streaming response events after transport framing is decoded
- extracting model text deltas
- extracting tool-call intents
- mapping provider terminal states to Comet terminal states
- surfacing provider errors as structured runtime errors

It is not responsible for becoming the general home for:

- HTTP client lifecycle management shared by multiple integrations
- generic SSE parsing shared by multiple providers
- WebSocket or IPC transport helpers

## Runtime Boundary

The runtime should call the adapter through a small trait.

Suggested shape:

```rust
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    async fn start_turn(
        &self,
        request: ProviderTurnRequest,
    ) -> Result<ProviderTurnStream, ProviderError>;

    async fn continue_turn(
        &self,
        request: ProviderContinuationRequest,
    ) -> Result<ProviderTurnStream, ProviderError>;
}
```

The OpenAI module inside `comet-api` should implement this trait.
If the implementation needs HTTP or SSE support, it should prefer calling that through `comet-client` rather than embedding reusable transport machinery directly into `comet-api`.

## Input Mapping

The adapter receives Comet-native input, not raw frontend input.

Typical input to the adapter:

- session metadata
- model selection
- system instructions
- packed context
- user turn content
- tool result continuations

The adapter then builds the OpenAI request body.

## Context Mapping

Comet context should be translated into OpenAI request content in a structured and deterministic order.

Recommended mapping order:

1. system rules
2. runtime policy notes
3. user request
4. packed context excerpts
5. prior tool results relevant to the current continuation

The adapter should avoid leaking internal implementation detail that the model does not need.

## Streaming Output Mapping

The adapter should normalize streaming output into a small set of provider-side internal events before publishing to runtime.

Recommended normalized provider events:

- `TextDelta`
- `MessageCompleted`
- `ToolCallRequested`
- `ResponseCompleted`
- `ProviderFailed`

These are adapter-local events.
The runtime can then turn them into `ServerEvent` values.

Important split:

- `comet-client` owns transport frame decoding such as SSE line handling when that logic is generic
- `comet-api/openai` owns provider endpoint wiring such as authenticated OpenAI `/responses` HTTP calls
- `comet-api/openai` owns mapping OpenAI event types into Comet provider events

That boundary should be read strictly:

- `comet-client` owns HTTP client behavior, SSE parsing, retry, timeout, connection lifecycle, and generic header helpers
- `comet-api/openai` owns endpoint paths, auth conventions, request JSON, response JSON, streaming event semantics, error-body parsing, and final mapping into Comet `ProviderStreamEvent`
- the same rule should apply to `comet-api/anthropic` and any later provider module

## Tool Call Mapping

If OpenAI emits tool calls, the adapter should:

1. parse provider tool name and arguments
2. map them to Comet tool names
3. validate that arguments parse into Comet tool input
4. emit a Comet-style tool request

Example mapping:

```text
OpenAI tool call
-> provider adapter mapping
-> Comet ToolRequest
-> runtime policy evaluation
-> tool execution
-> Comet ToolResponse
-> provider continuation payload
```

The runtime must not consume provider-native tool call payloads directly.

## Tool Name Mapping

Recommended strategy:

- keep Comet tool names canonical
- add a mapping table inside the adapter if OpenAI-facing names differ

Example:

```text
OpenAI-facing name: read_file
Comet canonical name: read_file
```

If they match, the mapping is trivial, but the boundary still matters.

## Tool Result Mapping

After Comet executes a tool, the adapter should convert the result into the provider's expected continuation format.

The adapter should:

- preserve `tool_call_id`
- serialize structured output
- include error information when execution failed

The runtime should pass a structured `ToolResponse` or tool failure object into the adapter, not provider-specific result messages.

## Error Mapping

The adapter should classify provider failures into stable runtime error codes.

Suggested categories:

- `provider_auth_error`
- `provider_rate_limited`
- `provider_invalid_request`
- `provider_stream_failed`
- `provider_unavailable`

These should become Comet `RuntimeError` values.

## Model Selection

The adapter should accept a platform-managed resolved provider target rather than maintain its own alias table.

Recommended split:

- runtime owns `model_profile` selection and registry resolution
- adapter owns only provider-specific request wiring

Example:

```text
Comet model profile: reasoning_default
-> platform registry resolves to { provider=openai/default, provider_model_id=gpt-5.4 }
-> OpenAI adapter writes provider_model_id into Responses.model
```

## Retry Guidance

The adapter may support limited provider-level retries for:

- transient transport failures before streaming starts
- explicit rate-limited retries if policy allows

The adapter should not silently retry a partially consumed stream in a way that duplicates model-side actions.

## Logging Guidance

The adapter should log:

- request metadata
- provider response ids if available
- stream start and completion
- tool call boundaries
- provider errors

It should not log sensitive payloads indiscriminately unless debug mode explicitly enables it.

## Recommended Module Layout

Suggested modules:

```text
comet-rs/comet-client/
  src/
    lib.rs
    http.rs
    sse.rs
    retry.rs

comet-rs/comet-api/
  src/
    lib.rs
    openai/
      mod.rs
      adapter.rs
      transport.rs
      request_builder.rs
      stream_mapping.rs
      tool_mapping.rs
      error.rs
      model_mapping.rs
    anthropic/
      mod.rs
```

If transport logic is still embedded in `comet-api` for the first implementation, that should be treated as temporary debt and not as the target boundary.

## First MVP Scope

The first OpenAI adapter should support:

- one primary model path
- text deltas
- completed messages
- tool call parsing
- tool result continuation
- basic provider error mapping

Deferred:

- multimodal input
- image output
- advanced provider-specific features
- multiple OpenAI account or org routing modes

## Core Invariant

If `core` can be unit-tested without importing any OpenAI types, the adapter boundary is working correctly.
