# Comet Event Log And Replay

## Goal

This document defines how Comet records durable thread history and rehydrates session activity from that history.

Event logging is not optional infrastructure.
It is required for:

- durable thread replay
- resumable sessions when safe
- debugging runtime behavior
- UI reconnect
- checkpoint coordination
- auditability

## Design Principles

1. Logs are append-only.
2. Commands and events are both worth recording.
3. Replay should reconstruct runtime state deterministically as far as practical.
4. Sequence order is authoritative.
5. Logged payloads should use Comet protocol, not provider-native protocol.

## What Should Be Logged

At minimum, Comet should log:

- thread creation
- session attach or load when operationally useful
- client commands
- runtime events
- approval decisions
- checkpoint creation
- rollback operations

Recommended categories:

- command log
- event log
- checkpoint log

These can be separate or unified behind one append-only record stream.

## Why Log Commands Too

Logging only output events is not enough.

Commands answer:

- what the user asked
- when the frontend approved something
- which interrupt or rollback action occurred

Events answer:

- what the runtime did in response

You need both to reconstruct behavior.

## Record Envelope

Recommended record envelope:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedRecord<T> {
    pub id: String,
    pub log_schema_version: String,
    pub thread_id: String,
    pub session_id: Option<String>,
    pub seqno: u64,
    pub recorded_at: i64,
    pub payload: T,
}
```

Where:

- `logSchemaVersion` identifies the persisted record format
- `threadId` identifies the durable history owner
- `sessionId` identifies the live runtime instance when one exists
- `seqno` is ordered within the thread log

If using a unified stream:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ThreadLogPayload {
    Command { command: protocol::ClientCommand },
    Event { event: protocol::ServerEvent },
    Checkpoint { checkpoint_id: String, reason: String },
}
```

## Sequence Rules

Each thread should have a monotonically increasing `seqno`.

Rules:

- one `seqno` domain per thread
- append order defines truth
- replay reads records in `seqno` order

In the first version, session event streams should inherit ordering from their backing thread log.

For the first implementation:

- `logSchemaVersion = "v1"`

This log schema version should evolve more conservatively than transport-facing fields because replay compatibility is more expensive to break.

## Storage Options

Recommended MVP storage:

- SQLite for metadata and ordered records
- filesystem blobs for large checkpoint content

Alternative MVP:

- newline-delimited JSON append-only files per thread

SQLite is usually the better long-term choice if you want querying and durability.

## Replay Goals

Replay should support at least three modes:

### 1. UI Replay

A client reconnects and replays prior events to reconstruct visible state.

### 2. Runtime Rehydration

The runtime reconstructs enough thread and turn state to load a session and resume or inspect work.

### 3. Debug Replay

A developer replays thread activity offline to understand a bug.

## Replay Strategy

Recommended approach:

1. load thread metadata
2. read records in order
3. fold commands and events into reconstructed state
4. attach checkpoint references
5. produce:
   - current thread summary
   - current session rehydration state if loaded
   - current turn state
   - latest visible history
   - latest checkpoint map

## Derived State

Replay should reconstruct at least:

- thread state summary
- active turn id
- current turn state
- pending approval requests
- applied patches
- latest checkpoint id
- visible conversation history

Not every ephemeral internal detail needs to be replayed if it can be safely recomputed or is not required for resume.

## Event Log vs Snapshot

Event logs are authoritative, but snapshots can improve startup speed.

Recommended strategy:

- keep append-only logs as source of truth
- optionally write periodic derived snapshots

Snapshots should be treated as caches, not as the authoritative record.

## Approval Replay

Approval requests and approval decisions must be replayable.

This is necessary to avoid:

- double-consuming approvals
- orphaned pending approvals
- ambiguous patch state

Recommended logged records:

- `ApprovalRequested`
- approval command
- approval outcome event if emitted

## Checkpoint Replay

Checkpoint metadata must be linked into the event log domain.

At minimum store:

- checkpoint id
- `seqno` where it was created
- associated turn id
- associated patch or tool call

This allows replay to answer:

- what changes are reversible
- which checkpoint belongs to which patch flow

## Replay Boundary Contract

App-server replay and thread read APIs must share the same per-thread durable `seqno` domain.

That means:

- `EventEnvelope.seqno` is the only replay cursor for thread event streams
- `ThreadReadModel.lastEventSeqno` must come from that same durable `seqno` domain
- a read model returned from `GET /threads/{id}` must fully reflect all thread effects through `lastEventSeqno`
- replay with `after=N` must return only events with `seqno > N`

If a requested cursor can no longer be resumed, the server must signal a replay gap explicitly rather than silently skipping ahead.

## Resume Semantics

Resume after process restart should follow this model:

```text
load thread metadata
-> replay command and event log
-> reconstruct pending approvals and active turn state
-> decide if resume is valid
-> load a new session or mark the last turn interrupted
```

Recommended conservative behavior:

- if the previous session had an active tool execution that cannot be resumed, restore visible state and mark the turn interrupted

## Logging Scope Rules

Use Comet protocol payloads in logs.

Do not rely on provider-native payloads as your primary log format.

You may optionally store provider-specific debug artifacts separately when needed, but those are supplementary.

## Observability Queries

The storage layer should eventually support:

- list threads
- fetch thread summary
- list sessions currently attached to threads
- stream events after `seqno` N
- fetch checkpoints for thread or turn
- fetch records for turn id

These queries support both UI and operations.

## Recommended Modules

Suggested modules:

```text
comet-rs/storage/
  src/
    thread_store.rs
    session_store.rs
    command_log.rs
    event_log.rs
    replay.rs
    checkpoint_store.rs
```

## First MVP Recommendation

The MVP should implement:

- append command record
- append event record
- replay full thread history
- stream events after `seqno`

Deferred:

- periodic snapshots
- retention policies
- advanced analytics

## Core Invariant

If a thread cannot be reconstructed from its log plus checkpoint blobs, the logging model is incomplete.
