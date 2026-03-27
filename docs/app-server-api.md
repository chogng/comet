# Comet App Server API

## Goal

This document defines the boundary between frontend clients and the Rust runtime.

The app server exists to:

- accept client commands
- stream runtime events
- manage thread-scoped subscriptions and live runtime attachments
- hide provider-specific details from clients

The app server must not contain orchestration logic.

## Domain Alignment

This API is thread-first at the durable boundary.

Per [domain-model.md](/Users/lance/Desktop/comet/docs/domain-model.md):

- `thread` is the durable conversation container
- `session` is the live loaded runtime handle

So this document should be read as:

- the client addresses a durable thread
- the server may attach or create a live session for that thread
- turns and items are durably stored under the thread
- `sessionId` is operational metadata, not the primary resource key

## Design Principles

1. Clients speak Comet protocol only.
2. The server exposes commands and events, not provider-native streams.
3. The transport should support reconnect and replay.
4. Commands should be idempotent when practical.
5. Event streams should be append-only and resumable.

## Recommended Transport Model

Use one of these patterns:

- HTTP + SSE
- HTTP + WebSocket

Recommended first implementation:

- `POST` for commands
- `GET` with SSE for events

This is simpler to debug and sufficient for a first client.

## Resource Model

Primary resource:

- thread

Secondary resources:

- sessions
- commands
- events
- checkpoints

Recommended base path:

```text
/api/v1
```

## Core Endpoints

Recommended Rust module mapping for these HTTP boundary types:

- `comet-rs/protocol/src/app_server.rs`
- reuse `ThreadReadModel`, `ThreadCheckpointReadState`, and `ThreadSubscriptionParams` via aliases where the wire shape is already canonical

### Start Or Attach Thread

```http
POST /api/v1/threads
```

Request body:

```json
{
  "cwd": "/path/to/workspace",
  "model": "gpt-5.4",
  "provider": {
    "kind": "openai",
    "profile": "default"
  },
  "sandboxMode": "workspaceWrite",
  "approvalMode": "onRequest"
}
```

Response body:

```json
{
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "transportVersion": "v1",
  "runtimeProtocolVersion": "v1"
}
```

This creates a new durable thread and, in the common case, attaches a live session for immediate interaction.

### Get Thread

```http
GET /api/v1/threads/{threadId}
```

Returns thread summary plus live runtime state if a session is currently attached.

This is the main durable read endpoint.

Recommended response shape: return the protocol `ThreadReadModel` directly rather than inventing a separate API-only summary type.

Suggested response:

```json
{
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "sessionState": "idle",
  "cwd": "/path/to/workspace",
  "model": "gpt-5.4",
  "provider": {
    "kind": "openai",
    "profile": "default"
  },
  "sandboxMode": "workspaceWrite",
  "approvalMode": "onRequest",
  "lastEventSeqno": 43,
  "activeTurnId": null,
  "pendingToolApproval": null
}
```

Notes:

- `threadId` remains the durable identity
- `sessionId` and session-scoped fields are present only when a live session is attached
- `lastEventSeqno` is the replay watermark for reconnect; clients should resume the event stream from the next sequence after this value
- `lastCheckpointId` should not be promised by this endpoint until checkpoint read state is actually implemented in core

If a tool approval is currently pending, the thread read response should expose a normalized approval summary payload so clients can rebuild approval UI after reconnect without replay gaps.

Suggested extension:

```json
{
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "sessionState": "runningTurn",
  "lastEventSeqno": 45,
  "activeTurnId": "turn_9",
  "pendingToolApproval": {
    "turnId": "turn_9",
    "toolCallId": "tool_call_22",
    "tool": "exec_command",
    "risk": "high",
    "reason": "tool policy requires approval",
    "activeSandboxMode": "workspaceWrite",
    "inputSummary": {
      "title": "Run shell command",
      "primaryText": "rm -rf build",
      "secondaryText": "cwd: .",
      "fields": [
        { "path": "command", "valuePreview": "rm -rf build" }
      ],
      "dangerHints": ["Command appears destructive"]
    }
  }
}
```

### Submit Command

```http
POST /api/v1/threads/{threadId}/commands
```

Request body:

```json
{
  "commandId": "cmd_001",
  "transportVersion": "v1",
  "runtimeProtocolVersion": "v1",
  "idempotencyKey": "idem_cmd_001",
  "seqno": 1,
  "actor": {
    "actorType": "frontend",
    "clientId": "ts_web"
  },
  "target": {
    "type": "session",
    "threadId": "thr_123",
    "sessionId": "sess_123"
  },
  "issuedAt": 1764180000,
  "payload": {
    "type": "submitUserTurn",
    "turnId": "turn_5",
    "text": "Fix the failing tests in auth.",
    "attachments": [],
    "unifiedMode": "agent"
  }
}
```

Response body:

```json
{
  "accepted": true,
  "commandId": "cmd_001"
}
```

The server should validate:

- transport version
- runtime protocol version
- command route and target thread match
- command shape
- session state allows this command when a live session target is provided

## Event Streaming

### Stream Thread Events

```http
GET /api/v1/threads/{threadId}/events
Accept: text/event-stream
```

Recommended query parameters:

- `after`
- `snapshot`
- `heartbeatSec`

Examples:

```http
GET /api/v1/threads/thr_123/events?after=42
GET /api/v1/threads/thr_123/events?snapshot=ifEmpty
```

Rules:

- `after` is an exclusive replay cursor; the server returns only events with `seqno > after`
- `Last-Event-ID` is equivalent to `after=<that value>`
- if both `after` and `Last-Event-ID` are supplied and differ, return `400 invalid_cursor`
- `snapshot` supports `none`, `ifEmpty`, and `always`
- `snapshot=ifEmpty` is the recommended default for clients that do not send a cursor

Recommended SSE frame types:

`event: snapshot`

```text
id: 43
event: snapshot
data: {"type":"threadSnapshot","threadId":"thr_123","sessionId":"sess_123","lastIncludedSeqno":43,"readModel":{"threadId":"thr_123","sessionId":"sess_123","sessionState":"idle","cwd":"/path/to/workspace","model":"gpt-5.4","provider":{"kind":"openai","profile":"default"},"sandboxMode":"workspaceWrite","approvalMode":"onRequest","lastEventSeqno":43,"activeTurnId":null,"pendingToolApproval":null}}
```

`event: event`

```text
id: 44
event: event
data: {"transportVersion":"v1","runtimeProtocolVersion":"v1","eventId":"evt_44","threadId":"thr_123","sessionId":"sess_123","turnId":"turn_5","seqno":44,"recordedAt":1764180001,"payload":{"type":"agentDelta","threadId":"thr_123","sessionId":"sess_123","turnId":"turn_5","text":"Checking auth tests..."}} 
```

`event: ready`

```text
event: ready
data: {"type":"subscriptionReady","threadId":"thr_123","fromSeqnoExclusive":43,"nextSeqno":44,"mode":"live"}
```

`event: gap`

```text
event: gap
data: {"type":"cursorGap","threadId":"thr_123","requestedAfter":43,"oldestAvailableSeqno":70,"latestSeqno":120,"recovery":"reloadSnapshot"}
```

Rules:

- SSE `id` must equal the server-assigned thread event `seqno`
- `snapshot.lastIncludedSeqno` and `readModel.lastEventSeqno` must match
- `ready` marks the boundary after replay and before live tail
- `gap` means the client must discard the current replay attempt and reload a fresh snapshot

Recommended cold-start pattern:

1. `GET /api/v1/threads/{threadId}` or open `/events?snapshot=ifEmpty`
2. use `lastEventSeqno` as the replay boundary
3. continue with events where `seqno > lastEventSeqno`

Recommended shared request shape:

```json
{
  "after": 42,
  "snapshot": "ifEmpty",
  "heartbeatSec": 15
}
```

Reconnect rules:

- if the cursor is still resumable, the server replays missed `event` frames, then emits `ready`, then tails live events
- if the cursor is no longer resumable, the server should return `409 cursor_gap` before streaming when possible, or emit `gap` and close the stream if the failure is discovered after opening

## Checkpoint Endpoints

### List Checkpoints

```http
GET /api/v1/threads/{threadId}/checkpoints
```

Suggested response:

```json
{
  "lastCheckpointId": "ckpt_7",
  "checkpoints": [
    {
      "checkpointId": "ckpt_7",
      "threadId": "thr_123",
      "sessionId": "sess_123",
      "turnId": "turn_5",
      "createdSeqno": 45,
      "createdAt": 1764180000,
      "reason": "beforePatchApply",
      "origin": {
        "patchId": "patch_9",
        "toolCallId": "tool_call_5"
      },
      "state": "available",
      "fileCount": 3
    }
  ]
}
```

Recommended shared response type: `ThreadCheckpointReadState`.

### Roll Back To Checkpoint

This may be modeled either as a resource endpoint or as a command.

Recommended first version:

- use the command API

Example command payload:

```json
{
  "commandId": "cmd_rollback_1",
  "transportVersion": "v1",
  "runtimeProtocolVersion": "v1",
  "actor": {
    "actorType": "frontend",
    "clientId": "ts_web"
  },
  "target": {
    "type": "checkpoint",
    "threadId": "thr_123",
    "checkpointId": "ckpt_7"
  },
  "issuedAt": 1764180000,
  "payload": {
    "type": "rollbackToCheckpoint",
    "checkpointId": "ckpt_7",
    "rollbackMode": "workspaceAndConversationHead",
    "conflictPolicy": "fail"
  }
}
```

## Recommended Command Envelope

```json
{
  "commandId": "cmd_001",
  "transportVersion": "v1",
  "runtimeProtocolVersion": "v1",
  "idempotencyKey": "idem_cmd_001",
  "seqno": 1,
  "actor": {
    "actorType": "frontend",
    "clientId": "ts_web"
  },
  "target": {
    "type": "session",
    "threadId": "thr_123",
    "sessionId": "sess_123"
  },
  "issuedAt": 1764180000,
  "payload": {
    "type": "submitUserTurn",
    "turnId": "turn_5",
    "text": "Explain the auth flow."
  }
}
```

Command envelope fields:

- `commandId`
- `transportVersion`
- `runtimeProtocolVersion`
- `idempotencyKey`
- `seqno`
- `target`
- `payload`

Why `commandId` matters:

- client retry safety
- deduplication
- command audit trail

## Recommended Event Envelope

```json
{
  "transportVersion": "v1",
  "runtimeProtocolVersion": "v1",
  "eventId": "evt_43",
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "turnId": "turn_5",
  "seqno": 43,
  "seqnoAck": 1,
  "recordedAt": 1764180000,
  "payload": {
    "type": "agentDelta",
    "threadId": "thr_123",
    "sessionId": "sess_123",
    "turnId": "turn_5",
    "text": "Checking auth tests..."
  }
}
```

Event envelope fields:

- `transportVersion`
- `runtimeProtocolVersion`
- `eventId`
- `threadId`
- `sessionId`
- `turnId`
- `seqno`
- `seqnoAck`
- `recordedAt`
- `payload`

## Idempotency Rules

### Commands

The app server should treat repeated `commandId` values for the same thread as idempotent retries.

Recommended behavior:

- if the same command was already accepted, return the original acceptance result
- if the payload differs for the same `commandId`, return conflict

### Event Replay

Clients should be able to reconnect using:

- SSE `Last-Event-ID`
- `after` query parameter

The server should resume event delivery from the next `seqno`.

## Error Model

Use structured error responses.

Suggested error body:

```json
{
  "error": {
    "code": "thread_not_found",
    "message": "No thread exists for thr_123",
    "retryable": false
  }
}
```

Suggested error codes:

- `invalid_request`
- `unsupported_transport_version`
- `thread_not_found`
- `invalid_session_state`
- `duplicate_command_id_conflict`
- `internal_error`

## Authentication

The first local version may run without user auth if it is only bound to localhost.

Recommended first version:

- bind to `127.0.0.1`
- use unguessable thread ids and session ids
- no cross-user trust assumptions

If remote access is needed later, add:

- bearer tokens
- per-thread access control
- origin restrictions

## Runtime Concurrency

Recommended first version:

- many sessions may exist
- only one active turn per thread at a time
- multiple clients may subscribe to one thread's event stream

If multiple command issuers exist, the server should serialize commands per thread.

## Suggested Rust Transport Types

### Command Envelope

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub command_id: String,
    pub transport_version: String,
    pub runtime_protocol_version: String,
    pub idempotency_key: Option<String>,
    pub seqno: Option<u64>,
    pub actor: protocol::CommandActor,
    pub target: protocol::CommandTarget,
    pub issued_at: i64,
    pub expected_state: Option<protocol::ExpectedRuntimeState>,
    pub payload: protocol::ClientCommand,
}
```

### Event Envelope

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub transport_version: String,
    pub runtime_protocol_version: String,
    pub event_id: String,
    pub thread_id: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub task_id: Option<String>,
    pub seqno: u64,
    pub seqno_ack: Option<u64>,
    pub recorded_at: i64,
    pub payload: protocol::ServerEvent,
}
```

## API Behavior Rules

## Rule 1: The server does not invent business logic

It forwards commands into the runtime and streams events back.

## Rule 2: The server never exposes provider-native events

Clients only see Comet events.

## Rule 3: Commands are validated before runtime dispatch

Validation includes:

- transport version
- runtime protocol version
- route/thread consistency
- schema correctness
- session state compatibility

## Rule 4: Events are strictly ordered per thread

Each thread log should have a monotonically increasing `seqno`.

Any session-scoped subscription inherits that ordering from its backing thread.

## Rule 5: Reconnect must be supported

Frontend restarts or tab reloads should not destroy thread visibility, even if the live session is recreated later.

## Future Extensions

These can be added later without changing the core model:

- `GET /api/v1/threads`
- `GET /api/v1/threads/{threadId}/turns`
- `GET /api/v1/threads/{threadId}/events?fromTimestamp=...`
- `POST /api/v1/threads/{threadId}/resume`
- `DELETE /api/v1/sessions/{sessionId}`
- WebSocket multiplexing for multiple threads
- binary artifact download endpoints

## Minimal First Version

The smallest useful app-server surface is:

- `POST /api/v1/threads`
- `GET /api/v1/threads/{threadId}`
- `POST /api/v1/threads/{threadId}/commands`
- `GET /api/v1/threads/{threadId}/events`

That is enough to support:

- one TS frontend
- one Rust TUI frontend
- resumable event rendering
- approval prompts
- patch application
- rollback command dispatch

## Versioning Notes

For the first implementation, this API should expose:

- `transportVersion = "v1"`
- `runtimeProtocolVersion = "v1"`

These may move together initially, but they should remain conceptually separate:

- `transportVersion` is the client compatibility contract
- `runtimeProtocolVersion` identifies the canonical command and event language carried by the server
