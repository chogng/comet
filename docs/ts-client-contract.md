# Comet TypeScript Client Contract

## Goal

This document defines how TypeScript frontends should integrate with Comet.

TypeScript is used only for frontend presentation and interaction.
It does not own runtime logic, tool execution, or provider integration.

The TS client contract exists to make that boundary explicit.

## Design Principles

1. TS clients speak Comet protocol only.
2. TS clients do not consume provider-native payloads.
3. TS clients render state and submit commands.
4. TS clients treat the Rust app server as the source of truth.
5. Shared protocol types should be generated, not hand-maintained twice.

## TS Client Responsibilities

TypeScript clients are responsible for:

- rendering thread state and live runtime state
- rendering message history and tool status
- rendering approval prompts
- rendering patch previews
- sending client commands
- subscribing to event streams
- handling reconnect and replay

TypeScript clients are not responsible for:

- tool execution
- approval enforcement
- patch application logic
- provider request construction
- checkpoint restoration
- orchestration decisions

## Transport Contract

Recommended API usage:

- `POST /api/v1/threads`
- `GET /api/v1/threads/:id`
- `POST /api/v1/threads/:id/commands`
- `GET /api/v1/threads/:id/events`

The TS client should use:

- HTTP for setup and one-shot commands
- SSE for ordered event streams

WebSocket can be added later if needed.

## Required TS Types

The TS client should consume generated types equivalent to:

- `ClientCommand`
- `ServerEvent`
- `CommandEnvelope`
- `EventEnvelope`
- `CommandTarget`
- `ThreadReadModel`
- checkpoint summary types

Recommended approach:

- Rust is the source of truth
- generate TypeScript types from Rust-facing protocol definitions

Do not hand-maintain a second protocol definition in TS.

## Client State Model

A TS client should keep a local derived view state, not a separate business-logic state machine.

Suggested frontend state:

- thread read model
- ordered event list
- derived visible messages
- active tool status
- pending approval request
- pending patch review
- connection status

The server remains authoritative.

## Event Handling Rules

The TS client should:

1. process events in sequence order
2. ignore duplicate already-applied sequences
3. request replay from the last known sequence after reconnect
4. derive UI state from events rather than inventing hidden local transitions

## Suggested Frontend Derived Models

The client may derive:

- chat transcript
- tool activity timeline
- status bar state
- approval modal state
- patch review panel state
- verification summary

These are view models, not protocol models.

## Command Submission Rules

When submitting a command, the TS client should:

- generate a stable `commandId`
- include `transportVersion`
- include `runtimeProtocolVersion`
- include `target`
- include `idempotencyKey` when retry safety matters
- optimistically track pending submission state if desired
- wait for streamed events to confirm actual runtime progress

The client should not assume:

- a submitted command was executed immediately
- a submitted approval is valid unless the server accepts it
- a command implicitly targets the active turn unless `target` says so

## Reconnect Behavior

The TS client should support reconnect by:

1. storing the last seen event `seqno`
2. reconnecting with `Last-Event-ID` or `after`
3. replaying missed events
4. rebuilding derived UI state

This avoids state drift after reloads or network interruptions.

For reconnect and cold-start reads, the client should treat `GET /api/v1/threads/:id` as returning the same `ThreadReadModel` shape used by Rust protocol types.

- do not create a second hand-written TS summary type for this endpoint
- use the returned read model as the seed state before applying streamed events
- if `lastEventSeqno` is present, start replay from the next sequence after that watermark
- treat `lastEventSeqno` as the highest server event fully reflected by the read model, not as a vague “latest seen” marker

For event subscriptions, the client should handle four frame categories:

- `snapshot`: replace the local base state with the supplied `ThreadReadModel`
- `event`: apply or append the streamed `EventEnvelope`
- `gap`: clear local replay assumptions and reload a fresh snapshot
- `ready`: mark the transport as live after replay has completed

Reducer rules:

- `snapshot` is a replace-base operation
- `event` is an incremental state update
- `gap` is a reset-required signal
- `ready` changes connection state only; it should not mutate business state

## Approval UX Contract

When the client receives `ApprovalRequested`, it should display:

- tool name
- structured input summary
- reason
- risk level
- active sandbox mode if available

The structured input summary should be treated as runtime-owned display data.

- it may be tool-specific and more concise than raw JSON args
- the client should render it as provided rather than recomputing it from raw input
- prefer `title` + `primaryText` as the compact approval card header
- use `secondaryText` and `fields[]` for supporting detail
- render `dangerHints[]` distinctly when present

Recommended rendering order:

1. tool name, risk, and sandbox mode chrome
2. `title`
3. `primaryText`
4. `secondaryText`
5. `dangerHints[]`
6. `fields[]`
7. approval reason

Rendering rules:

- preserve `fields[]` order exactly as sent by runtime
- do not sort or relabel `dangerHints[]`
- if `primaryText` is absent, the client may elevate the first field value into the visual primary slot
- if `secondaryText` is absent, the client should not synthesize extra text from raw args
- if `dangerHints[]` is non-empty, the approval UI should default to an expanded state rather than a collapsed one
- long `fields[]` lists may be collapsed behind a disclosure control, but the first few rows should still preserve runtime order

When the user decides, the client sends:

- `ApproveToolCall`
- or `RejectToolCall`

The client does not mark the action complete until the server emits follow-up runtime events.

## Approval View Model

Clients should derive a stable approval card view model from `ApprovalRequested`.

Suggested shape:

```ts
type ApprovalCardViewModel = {
  threadId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  tool: string;
  risk: "low" | "medium" | "high";
  sandboxMode?: string;
  title: string;
  primaryText?: string;
  secondaryText?: string;
  fields: Array<{ path: string; valuePreview: string }>;
  dangerHints: string[];
  reason: string;
  isExpandedByDefault: boolean;
};
```

Derivation rules:

- map identifiers and `tool` directly from the protocol event
- `title`, `primaryText`, `secondaryText`, `fields`, and `dangerHints` come directly from `inputSummary`
- `isExpandedByDefault` should be `true` when `dangerHints.length > 0`
- if `primaryText` is absent, the client may use the first field value as a visual fallback without mutating stored state
- if `primaryText` and `fields` are both empty, render only `title` plus `reason`
- this derived view model should be the single source used by both modal and timeline approval renderers

## Patch Review UX Contract

When the client receives `PatchProposed`, it should:

- show changed files
- show patch or diff preview
- allow apply or reject action if the runtime supports it

The client should not modify local files directly.

## Suggested TS Project Shape

Example structure:

```text
frontend/
  src/
    api/
      threads.ts
      commands.ts
      events.ts
    protocol/
      generated.ts
    state/
      reducer.ts
      selectors.ts
    features/
      chat/
      tools/
      approvals/
      patches/
```

## Suggested Frontend Reducer Model

The TS client can use a reducer that consumes `EventEnvelope`.

Pattern:

```text
event stream
-> reducer
-> derived selectors
-> UI
```

This keeps the frontend deterministic and easy to debug.

## Error Handling

The TS client should distinguish:

- transport errors
- command submission errors
- thread-not-found errors
- runtime failure events

Do not collapse all errors into one generic UI toast.

## First MVP Recommendation

The first TS client should implement only:

- create thread
- submit user turn
- stream events
- show message deltas
- show tool activity
- approve or reject tool calls
- show patch proposals

Deferred:

- multi-thread dashboards
- advanced offline cache
- collaborative cursors

## Core Invariant

If the TS client can be replaced by a Rust TUI while the runtime and protocol remain unchanged, the client boundary is correct.
