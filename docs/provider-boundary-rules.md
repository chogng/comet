# Provider Boundary Rules

## Goal

This document makes the boundary between `comet-client` and `comet-api/<provider>` explicit.

The short version is:

- `comet-client` owns transport mechanics
- `comet-api/<provider>` owns provider API semantics

If a piece of code violates that split, it is in the wrong crate.

## Primary Rule

Use this test:

1. If the helper could be shared by OpenAI, Anthropic, and a future provider, it belongs in `comet-client`.
2. If the helper knows anything specific about one provider API, it belongs in `comet-api/<provider>`.

That second category includes:

- provider endpoint paths
- provider auth conventions
- provider request JSON fields
- provider response JSON fields
- provider streaming event names
- provider error-body formats
- provider-specific mapping into Comet internal protocol

## `comet-client` Owns

`comet-client` should own only transport-layer concerns such as:

- HTTP client behavior
- SSE parsing
- retry policy
- timeout policy
- connection lifecycle handling
- generic header builders
- generic request execution helpers

These helpers must stay provider-agnostic.

Allowed examples:

- `BlockingHttpClient`
- generic SSE event reader
- shared reconnect utility
- generic bearer-header helper when it does not encode provider semantics

## `comet-api/<provider>` Owns

Each provider module should own API-layer concerns such as:

- endpoint paths
- auth conventions as used by that provider API
- request body construction
- response JSON parsing
- streaming event semantics
- error-body parsing
- conversion into Comet `ProviderStreamEvent`

Allowed examples:

- OpenAI `/responses` endpoint wiring
- Anthropic message stream event interpretation
- provider-specific error normalization
- tool-call mapping from provider-native shape into Comet tool request shape

## Decision Checklist

Before placing code, ask:

1. Does this code know a provider name, endpoint, JSON field, or event type?
2. Does this code parse a provider error body?
3. Does this code decide how an external event becomes `ProviderStreamEvent`?

If the answer to any of those is yes, the code belongs in `comet-api/<provider>`.

Then ask:

1. Would this helper still make sense if OpenAI were replaced by Anthropic?
2. Could this helper be reused by app-server or a future Rust-side client?

If yes, it likely belongs in `comet-client`.

## Anti-Patterns

These are boundary mistakes:

- putting OpenAI endpoint helpers in `comet-client`
- putting generic SSE parsing in `comet-api/openai`
- putting provider JSON structs in `core`
- letting `core` consume raw provider events
- mixing transport retry logic with provider event interpretation in one module

## Expected Flow

The intended pipeline is:

```text
provider HTTP/SSE transport
-> provider API module
-> Comet ProviderStreamEvent
-> core runtime
```

In other words:

- `comet-client` gets bytes and frames
- `comet-api/<provider>` interprets provider protocol
- `core` consumes only Comet internal protocol

## Invariant

`core` should never need to import provider-native request types, response types, event names, or endpoint details.

If that happens, the provider boundary has already leaked.
