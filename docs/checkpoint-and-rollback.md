# Comet Checkpoint And Rollback

## Goal

This document defines how Comet preserves recoverability when the agent changes the workspace.

Checkpointing is required so that:

- users can review and revert agent changes
- interrupted threads can recover safely once a live session is reattached
- mutations are auditable
- patch application is not a one-way operation

## Design Principles

1. Checkpoint before mutation.
2. Rollback is a first-class runtime action.
3. A checkpoint should describe both state and intent.
4. The first version should prefer simple reliable rollback over sophisticated isolation.
5. Shadow workspace support can come later.

## Recommended First Version

The first version should use file-level checkpoints in the real workspace.

That means:

- before a mutation, capture enough information to restore previous file contents
- apply the mutation in the real workspace
- allow later rollback to the checkpoint

This is simpler than implementing a full shadow workspace or worktree-first system.

## What A Checkpoint Should Store

Each checkpoint should store:

- `checkpointId`
- `threadId`
- `sessionId` when a live runtime instance created the checkpoint
- `turnId`
- creation time
- reason
- files affected
- pre-change content or reference
- optional post-change content metadata
- originating tool call or patch id

Suggested checkpoint record:

```json
{
  "checkpointId": "ckpt_7",
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "turnId": "turn_5",
  "reason": "beforePatchApply",
  "files": [
    {
      "path": "src/lib.rs",
      "beforeHash": "abc",
      "beforeContent": "old text"
    }
  ],
  "origin": {
    "patchId": "patch_9",
    "callId": "call_4"
  }
}
```

## Checkpoint Reasons

Recommended reasons:

- `beforeEditFile`
- `beforeApplyPatch`
- `beforeDeleteFile`
- `manualCheckpoint`
- `beforeRollback`

## Checkpoint Triggers

The runtime should create a checkpoint when:

- applying `edit_file`
- applying `apply_patch`
- deleting a file
- applying any multi-file mutation

The runtime should not create checkpoints for:

- read tools
- search tools
- purely explanatory turns

## Rollback Modes

Recommended first rollback mode:

- rollback to a checkpoint by restoring captured file contents

This means:

- files modified since the checkpoint are reverted to the checkpoint's stored content
- files created by the patch may be removed if tracked as part of the change set
- deleted files may be restored if stored in checkpoint data

## Rollback Command

Rollback should be an explicit runtime command.

Suggested shape:

```json
{
  "type": "rollbackToCheckpoint",
  "threadId": "thr_123",
  "sessionId": "sess_123",
  "checkpointId": "ckpt_7"
}
```

Rollback should emit explicit events:

- `CheckpointRestoreStarted`
- `CheckpointRestored`
- `CheckpointRestoreFailed`

These can be added to the protocol after the initial stable set if needed.

## Checkpoint Lifecycle

Suggested lifecycle:

```text
tool wants to mutate
-> create checkpoint
-> record checkpoint event
-> apply mutation
-> record patch or edit event
-> continue turn
```

Rollback lifecycle:

```text
rollback requested
-> validate checkpoint exists
-> validate thread ownership
-> restore files
-> record rollback event
-> update live session state if one is attached
```

## Storage Strategy

Recommended first implementation:

- store checkpoint metadata in structured storage
- store file contents in local checkpoint artifacts

Possible storage options:

- SQLite metadata + filesystem blobs
- append-only thread files + blob directory

Each checkpoint should be durable enough to survive process restart if resume is a product goal.

## Conflict Handling

Rollback becomes more complex if files changed after the checkpoint for reasons unrelated to the agent.

Recommended first behavior:

- detect mismatch between current content and expected post-change content
- either:
  - fail rollback with explicit conflict
  - or allow force rollback only through a separate explicit action later

The MVP should prefer explicit conflict over silent overwrite.

## Patch Metadata

Whenever a patch is proposed or applied, the runtime should store:

- patch id
- file summaries
- linked checkpoint id
- approval status
- application timestamp

This lets the UI show:

- what changed
- what can be reverted
- which checkpoint owns the revert path

## Relationship To Approval

Checkpointing does not replace approval.

Even if rollback is possible:

- risky mutations may still need approval
- exec commands may still need approval

Checkpointing is a recovery mechanism, not a permission mechanism.

## Relationship To Event Replay

Checkpoint data and event logs complement each other.

Event logs tell you:

- what happened
- in what order
- why the runtime made a decision

Checkpoints tell you:

- how to restore previous workspace state

Both are needed.

## Future Upgrade: Shadow Workspace

Once the MVP is stable, Comet can adopt a more Cursor-like approach:

- apply mutations in an isolated worktree or shadow workspace
- review diff before applying to the real workspace
- accept or reject changes at file or hunk level

Benefits:

- safer preview flow
- cleaner rejection semantics
- lower risk of partial mutation in the real workspace

Costs:

- more implementation complexity
- editor synchronization complexity
- additional storage and process management

This should be phase 2, not phase 1.

## Recommended MVP Rules

1. Every mutation tool creates a checkpoint first.
2. Every applied patch links to a checkpoint id.
3. Rollback is explicit and logged.
4. Rollback conflicts fail loudly.
5. Checkpoint restore does not silently overwrite unrelated user changes.

## Suggested Data Shapes

### Checkpoint Summary

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    pub checkpoint_id: String,
    pub thread_id: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub created_seqno: u64,
    pub created_at: i64,
    pub reason: CheckpointReason,
    pub origin: CheckpointOrigin,
    pub state: CheckpointState,
    pub file_count: Option<u32>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointOrigin {
    pub patch_id: Option<String>,
    pub tool_call_id: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointState {
    Available,
    Restoring,
    Restored,
    RestoreFailed,
}
```

### Checkpoint File Entry

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileEntry {
    pub path: String,
    pub existed_before: bool,
    pub before_hash: String,
    pub after_hash: Option<String>,
    pub before_content_ref: String,
}
```

### Checkpoint Reason

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointReason {
    BeforeEditFile,
    BeforeApplyPatch,
    BeforeDeleteFile,
    ManualCheckpoint,
    BeforeRollback,
}
```

## Deletion And Creation Semantics

Checkpoints must handle three file cases:

- file existed and was modified
- file existed and was deleted
- file did not exist and was created

Rollback behavior:

- modified file: restore previous contents
- deleted file: recreate with previous contents
- created file: remove file

## Observability

The runtime should make this visible to clients:

- latest checkpoint id
- checkpoints available for a thread
- whether a patch is reversible
- rollback success or failure

This is necessary for trustworthy UX.

## MVP Projection Note

`ThreadCheckpointReadState` is projected from checkpoint-related durable effects, and checkpoint metadata (`createdSeqno`, `createdAt`, `reason`, `origin`, `fileCount`) should be carried directly by checkpoint creation effects.

Current limitation is narrower: metadata quality still depends on the producer path that emits the checkpoint effect.

For producer paths that do not yet provide richer linkage, `origin` and `fileCount` can still be `null`, but they should not be synthesized in the projection layer.
