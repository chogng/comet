# Comet Runtime State Machine

## Goal

This document defines the runtime state machine for a Comet session.

The runtime is not modeled as a free-form chat loop.
It is modeled as an explicit state machine so that:

- behavior is predictable
- approval and safety gates are explicit
- replay is possible
- UI can render accurate state
- failures and retries are manageable

## Scope

This document describes:

- thread context as the durable owner of history
- session-level states
- turn-level states
- task-level execution interpretation
- major transitions
- approval and patch checkpoints
- failure and interruption behavior

This document follows the terminology in [domain-model.md](/Users/lance/Desktop/comet/docs/domain-model.md).

Important distinction:

- `thread` is the durable conversation container
- `session` is the live loaded runtime handle
- `turn` is the user-visible interaction unit
- `task` is the execution unit inside the runtime

This means the state machine primarily operates on:

- a loaded session
- an active turn
- a primary task executing for that turn

It does not mean that the session is the durable owner of all history.

## Thread Context

A thread is the durable owner of:

- ordered turns
- checkpoints
- durable items
- replayable history

The runtime state machine does not replace the thread model.

Instead:

- the thread owns durable history
- the session loads one thread for active work
- the active turn runs inside that loaded session

## Session Model

A session is the live runtime handle bound to one thread.

A session owns live execution state such as:

- one loaded thread reference
- one working directory and runtime configuration
- one active turn at most
- one active primary task at most
- in-memory caches and working set state
- live approval wait state

A session does not own durable history in the domain sense.

Durable turns and checkpoints belong to the thread that the session has loaded.

Each loaded session can be in one high-level state:

```text
created
-> idle
-> running_turn
-> interrupted
-> completed
-> failed
```

## Session States

### `Created`

The session exists but has not yet accepted the first user turn for its loaded thread.

Allowed transitions:

- `Created -> Idle`
- `Created -> Failed`

### `Idle`

The session is ready to accept a new user turn for its loaded thread.

Allowed transitions:

- `Idle -> RunningTurn`
- `Idle -> Completed`
- `Idle -> Failed`

### `RunningTurn`

The session is actively processing one active turn.

Allowed transitions:

- `RunningTurn -> Idle`
- `RunningTurn -> Interrupted`
- `RunningTurn -> Failed`

### `Interrupted`

The active turn was paused or aborted by the user or by runtime policy.

Allowed transitions:

- `Interrupted -> Idle`
- `Interrupted -> RunningTurn`
- `Interrupted -> Failed`

### `Completed`

The session has ended normally and does not accept new turns while loaded in this runtime instance.

### `Failed`

The session has ended due to unrecoverable error and does not accept new turns while loaded in this runtime instance.

## Turn Model

Each user-visible turn is processed as a separate state machine inside `RunningTurn`.

In the recommended domain model:

- the turn is the durable interaction unit
- the runtime usually creates one primary task to execute that turn

The phases below are therefore best read as the state of the active turn and its primary task, not as separate durable domain objects.

Recommended turn states:

```text
accepted
-> planning
-> retrieving_context
-> awaiting_provider
-> awaiting_tool_approval
-> running_tool
-> awaiting_patch_approval
-> applying_patch
-> verifying
-> completed

failure paths:
-> interrupted
-> failed
```

Not every turn visits every state.

Examples:

- a simple answer-only turn may go from `planning` to `awaiting_provider` to `completed`
- a read-only tool turn may go through `running_tool` and then back to `awaiting_provider`
- a code-editing turn may pass through patch and verification states

## Minimal Orchestrator Loop

For the first real `core` implementation, the state machine should be executed by one foreground turn loop, not by many independent schedulers.

The minimal thread-first loop should be:

```text
load thread into session
-> accept command envelope for that thread
-> create durable turn record
-> create one primary task for the turn
-> prepare orchestration state
-> call provider with ProviderTurnRequest
-> consume provider stream
-> if text delta: emit event and continue
-> if tool request: gate, execute, reinject result, continue
-> if patch proposal: gate, checkpoint, apply or reject, continue
-> if verification requested: run verification, continue
-> if provider completes cleanly: finalize turn
-> persist terminal turn outcome
-> return session to Idle
```

This is the implementation target for MVP.

It means the first version should have exactly one foreground executor path inside `core`:

- one loaded session
- one active turn
- one primary task
- one provider stream at a time

Background tasks and subagents can be layered on later, but they should not complicate the first foreground executor.

## Orchestrator Responsibilities

The foreground orchestrator inside `core` should own these decisions:

- whether the incoming command may start or modify the active turn
- when to create a durable turn item versus a transient stream event
- when to call the provider again after tool or patch feedback
- when approval blocks execution
- when checkpointing is required before mutation
- when the turn is terminal and may be finalized

The orchestrator should not own:

- provider-native stream parsing
- transport session attachment
- frontend-specific view state

Those belong respectively to:

- `comet-api`
- `app-server`
- `tui` or TS clients

## One-Step Transition Rule

For implementation simplicity, each loop iteration should do one state transition and emit the corresponding event set before moving on.

That means:

- receive one command or one provider stream item
- reduce runtime state once
- emit canonical events
- persist durable effects if required
- decide next state

This reducer-like rule keeps replay and testing manageable.

## Reducer Inputs

For the MVP foreground loop, the reducer only needs a small set of input categories.

Recommended input classes:

- `SubmitUserTurn`
- `ProviderItem`
  text delta, message completed, tool request, patch proposal, verification request, provider completed, provider failed
- `ApproveToolCall`
- `RejectToolCall`
- `ApplyPatch`
- `RejectPatch`
- `Interrupt`
- `Resume`
- `RollbackToCheckpoint`

The implementation should normalize provider-native stream events into `ProviderItem` variants before they reach the reducer.

## Reducer Table For MVP

This is the practical implementation contract for the first foreground `core/orchestrator`.

### 1. Session `Idle` + `SubmitUserTurn`

Durable effects:

- create turn record on the thread
- create primary task record for the turn
- store initial user item

Emitted events:

- `UserTurnAccepted`

Next state:

- session `RunningTurn`
- turn `Accepted`

### 2. Turn `Accepted` + internal continue

Durable effects:

- update turn state to `Planning`

Emitted events:

- optional `PlanUpdated`

Next state:

- `Planning`

### 3. Turn `Planning` + internal continue

Durable effects:

- update orchestration metadata
- persist any chosen plan summary if it is user-visible

Emitted events:

- optional `PlanUpdated`
- optional `StatusUpdated`

Next state:

- `RetrievingContext` or `AwaitingProvider`

### 4. Turn `RetrievingContext` + internal continue

Durable effects:

- persist context decisions that affect replay or later packing

Emitted events:

- optional `ContextUpdated`
- optional `StatusUpdated`

Next state:

- `AwaitingProvider`

### 5. Turn `AwaitingProvider` + provider text delta

Durable effects:

- none required for each chunk

Emitted events:

- `AgentDelta`

Next state:

- `AwaitingProvider`

### 6. Turn `AwaitingProvider` + provider completed message

Durable effects:

- append final assistant item to the turn

Emitted events:

- `AgentMessageCompleted`

Next state:

- `AwaitingProvider` or `Completed`

The provider may emit a completed message before asking for more tool work, so completed message and turn completion must stay separate.

### 7. Turn `AwaitingProvider` + provider tool request

Durable effects:

- create tool-call record
- persist approval requirement if blocking

Emitted events:

- `ToolCallProposed`
- optional `ApprovalRequested`

Notes:

- `ApprovalRequested.input_summary` should already be prepared by the runtime tool layer
- the state machine should treat that summary as input data, not derive it from raw JSON args

Next state:

- `AwaitingToolApproval` or `RunningTool`

### 8. Turn `AwaitingToolApproval` + `ApproveToolCall`

Durable effects:

- append approval decision to the turn

Emitted events:

- optional `StatusUpdated`

Next state:

- `RunningTool`

### 9. Turn `AwaitingToolApproval` + `RejectToolCall`

Durable effects:

- append rejection decision to the turn
- persist refusal result for reinjection into provider continuation

Emitted events:

- optional `StatusUpdated`

Next state:

- `AwaitingProvider`, `Interrupted`, or `Failed`

The preferred MVP behavior is:

- reject tool call
- reinject structured refusal into provider continuation
- return to `AwaitingProvider`

### 10. Turn `RunningTool` + tool started

Durable effects:

- none required

Emitted events:

- `ToolCallStarted`

Next state:

- `RunningTool`

### 11. Turn `RunningTool` + tool stdout/stderr

Durable effects:

- none required for each chunk

Emitted events:

- `ToolCallStdout`
- `ToolCallStderr`

Next state:

- `RunningTool`

### 12. Turn `RunningTool` + tool completed

Durable effects:

- append tool result item

Emitted events:

- `ToolCallCompleted`

Next state:

- `AwaitingProvider`, `AwaitingPatchApproval`, or `Verifying`

### 13. Turn `RunningTool` + tool failed

Durable effects:

- append tool failure item

Emitted events:

- `ToolCallFailed`

Next state:

- `AwaitingProvider`, `Interrupted`, or `Failed`

The preferred MVP behavior is:

- return structured failure into provider continuation when recoverable
- otherwise fail the turn

### 14. Turn `AwaitingProvider` or `RunningTool` + patch proposal

Durable effects:

- create patch proposal record

Emitted events:

- `PatchProposed`

Next state:

- `AwaitingPatchApproval`

### 15. Turn `AwaitingPatchApproval` + `ApplyPatch`

Durable effects:

- create checkpoint
- append checkpoint record
- apply patch
- append patch-applied record

Emitted events:

- `CheckpointCreated`
- `PatchApplied`

Next state:

- `AwaitingProvider` or `Verifying`

### 16. Turn `AwaitingPatchApproval` + `RejectPatch`

Durable effects:

- append patch rejection record

Emitted events:

- `PatchRejected`

Next state:

- `AwaitingProvider`

### 17. Turn `Verifying` + verification completed

Durable effects:

- append verification result item

Emitted events:

- `VerificationCompleted`

Next state:

- `AwaitingProvider`, `Completed`, or `Failed`

### 18. Any active turn state + `Interrupt`

Durable effects:

- append interruption record

Emitted events:

- turn-scoped interruption status event or session interruption event

Next state:

- turn `Interrupted`
- session `Interrupted`

### 19. Session `Interrupted` + `Resume`

Durable effects:

- reconstruct active turn/task orchestration state from event log and checkpoints

Emitted events:

- optional `StatusUpdated`

Next state:

- session `RunningTurn` or `Idle`

### 20. Session `Idle` or `Interrupted` + `RollbackToCheckpoint`

Durable effects:

- validate checkpoint ownership on the thread
- restore workspace state
- append rollback record

Emitted events:

- optional `StatusUpdated`

Next state:

- session `Idle` or `Failed`

The preferred MVP behavior is:

- allow rollback only when there is no conflicting active foreground turn
- keep rollback as a thread-scoped recovery action, not as an implicit side effect of patch rejection

### 21. Any state + unrecoverable failure

Durable effects:

- persist failure outcome on turn and session

Emitted events:

- `SessionFailed`

Next state:

- turn `Failed`
- session `Failed`

## Durable vs Transient Effects

Each state transition should answer two questions explicitly:

1. what durable records change on the thread
2. what transient events are emitted for the live session

Recommended MVP split:

- `UserTurnAccepted`, final agent messages, tool call records, patch records, approvals, verification results, checkpoints:
  durable on the thread
- `AgentDelta`, streaming tool stdout/stderr, intermediate status:
  transient event stream first, with durable summary only when needed

This rule avoids the common mistake of trying to persist every stream chunk as a business object.

## Suggested Reducer Return Shape

The first `core/orchestrator` implementation should treat one reduction step as returning:

1. updated in-memory runtime state
2. durable writes to commit
3. transient events to publish
4. next action hint

Suggested conceptual shape:

```rust
pub struct ReduceResult {
    pub durable_effects: Vec<DurableEffect>,
    pub emitted_events: Vec<EventEnvelope>,
    pub next_action: NextAction,
}
```

Where `NextAction` is intentionally small for MVP:

- `None`
- `Continue`
- `CallProvider`
- `RunTool`
- `RunVerification`
- `AwaitUserDecision`
- `FinalizeTurn`
- `FailTurn`

This keeps the orchestrator loop explicit:

```text
reduce
-> persist durable effects
-> publish events
-> execute next action
-> reduce again
```

## Suggested Reducer Input Shape

The reducer should not consume raw transport payloads or provider-native frames directly.

It should consume normalized internal inputs.

Suggested conceptual shape:

```rust
pub enum ReducerInput {
    Command(CommandInput),
    Provider(ProviderInput),
    Tool(ToolExecutionInput),
    Verification(VerificationInput),
    InternalContinue,
}
```

Suggested MVP sub-shapes:

```rust
pub enum CommandInput {
    SubmitUserTurn,
    ApproveToolCall,
    RejectToolCall,
    ApplyPatch,
    RejectPatch,
    Interrupt,
    Resume,
    RollbackToCheckpoint,
}
```

```rust
pub enum ProviderInput {
    TextDelta,
    MessageCompleted,
    ToolRequested,
    PatchProposed,
    VerificationRequested,
    Completed,
    Failed,
}
```

```rust
pub enum ToolExecutionInput {
    Started,
    Stdout,
    Stderr,
    Completed,
    Failed,
}
```

```rust
pub enum VerificationInput {
    Completed,
}
```

The important constraint is:

- `app-server` converts wire commands into normalized command input
- `comet-api` converts provider streams into normalized provider input
- `core/orchestrator` reduces only over internal input shapes

## Suggested Durable Effect Shape

`DurableEffect` should describe what must be committed to thread-backed storage before the transition is considered complete.

Suggested conceptual shape:

```rust
pub enum DurableEffect {
    CreateTurn,
    UpdateTurnState,
    CreateTask,
    UpdateTaskState,
    AppendItem,
    RecordToolCall,
    RecordToolResult,
    RecordApprovalDecision,
    RecordPatchProposal,
    RecordPatchApplied,
    RecordPatchRejected,
    CreateCheckpoint,
    RecordVerificationResult,
    RecordInterruption,
    RecordRollback,
    RecordFailure,
}
```

In the first implementation, `DurableEffect` should stay domain-oriented rather than storage-oriented.

Good:

- `CreateCheckpoint`
- `RecordPatchApplied`
- `RecordFailure`

Bad:

- `InsertRowIntoTurns`
- `WriteJsonBlob`
- `UpdateSqliteTable`

The storage layer should interpret durable effects, not leak through them.

## Suggested Next Action Shape

`NextAction` should represent side effects the orchestrator must drive after persistence and event emission.

Suggested conceptual shape:

```rust
pub enum NextAction {
    None,
    Continue,
    CallProvider,
    RunTool,
    RunVerification,
    AwaitUserDecision,
    RestoreCheckpoint,
    FinalizeTurn,
    FailTurn,
}
```

MVP meaning:

- `Continue`
  immediately reduce again with `InternalContinue`
- `CallProvider`
  build `ProviderTurnRequest` and begin or resume provider stream
- `RunTool`
  dispatch tool execution through `core/tools`
- `RunVerification`
  dispatch verification flow
- `AwaitUserDecision`
  stop active progress until a new command arrives
- `RestoreCheckpoint`
  run rollback restoration before reducing again
- `FinalizeTurn`
  write final summaries and return session to `Idle`
- `FailTurn`
  write failure outcome and move session to `Failed` or `Interrupted`

## Ownership Notes For Internal Types

To avoid boundary drift inside `core`, the internal shapes above should be owned like this:

- `state_machine/`
  `SessionState`, `TurnState`, `ReducerInput`, `NextAction`, transition rules
- `orchestrator/`
  reduction loop, `ReduceResult`, action dispatch sequencing
- `turn/`
  durable turn/item/task domain objects referenced by `DurableEffect`
- `checkpoint/`
  checkpoint and rollback-specific durable effect handlers
- `providers/`
  conversion between `NextAction::CallProvider` and provider-facing requests
- `tools/`
  conversion between `NextAction::RunTool` and tool execution callbacks

This keeps state semantics in one place and side-effect execution in the subsystems that actually own them.

## Turn States

### `Accepted`

The runtime has accepted the user's input and created a durable turn record.

Entry conditions:

- valid session
- valid user input
- no conflicting active turn

Emitted events:

- `UserTurnAccepted`

Allowed transitions:

- `Accepted -> Planning`
- `Accepted -> Failed`

### `Planning`

The runtime prepares orchestration state for the active turn and its primary task.

Responsibilities:

- normalize the user goal
- initialize or update the working set
- select budget strategy
- decide whether retrieval is needed
- prepare provider input skeleton

Emitted events:

- optional `PlanUpdated`

Allowed transitions:

- `Planning -> RetrievingContext`
- `Planning -> AwaitingProvider`
- `Planning -> Failed`

### `RetrievingContext`

The runtime gathers relevant context for the active turn before the next provider request.

Possible actions:

- inspect working set
- run lexical search
- run symbol search
- use cached context
- use semantic retrieval if enabled
- deduplicate previous context chunks

Allowed transitions:

- `RetrievingContext -> AwaitingProvider`
- `RetrievingContext -> Failed`

### `AwaitingProvider`

The runtime is consuming a provider stream on behalf of the active turn.

Possible provider outputs:

- text deltas
- completed message
- plan update
- tool call proposal
- stop/completion
- provider error

Emitted events:

- `AgentDelta`
- `AgentMessageCompleted`
- `PlanUpdated`
- `ToolCallProposed`

Allowed transitions:

- `AwaitingProvider -> AwaitingToolApproval`
- `AwaitingProvider -> RunningTool`
- `AwaitingProvider -> AwaitingPatchApproval`
- `AwaitingProvider -> Verifying`
- `AwaitingProvider -> Completed`
- `AwaitingProvider -> Interrupted`
- `AwaitingProvider -> Failed`

## Tool Flow States

### `AwaitingToolApproval`

The runtime has received a tool request for the active task that cannot execute immediately.

Typical reasons:

- approval policy requires user confirmation
- tool risk is high
- tool affects workspace outside allowed scope
- network or exec action is gated

Emitted events:

- `ApprovalRequested`

Allowed transitions:

- `AwaitingToolApproval -> RunningTool`
- `AwaitingToolApproval -> Interrupted`
- `AwaitingToolApproval -> Failed`

Rejected tool calls may either:

- fail the turn
- send a refusal result back into the provider loop

The exact strategy should be policy-driven.

### `RunningTool`

The runtime is executing a tool request inside the active task.

Possible behaviors:

- one-shot tool execution
- streaming stdout or stderr
- structured progress updates
- production of files, patch data, or diagnostics

Emitted events:

- `ToolCallStarted`
- `ToolCallStdout`
- `ToolCallStderr`
- `ToolCallCompleted`
- `ToolCallFailed`

Allowed transitions:

- `RunningTool -> AwaitingProvider`
- `RunningTool -> AwaitingPatchApproval`
- `RunningTool -> Verifying`
- `RunningTool -> Failed`
- `RunningTool -> Interrupted`

## Patch Flow States

### `AwaitingPatchApproval`

The runtime has a proposed patch for the active turn that requires user confirmation before applying.

This state is distinct from tool approval.
The tool may already have completed successfully, but the patch has not yet been applied to the workspace.

Emitted events:

- `PatchProposed`

Allowed transitions:

- `AwaitingPatchApproval -> ApplyingPatch`
- `AwaitingPatchApproval -> AwaitingProvider`
- `AwaitingPatchApproval -> Interrupted`
- `AwaitingPatchApproval -> Failed`

Patch rejection behavior:

- the patch is marked rejected
- the provider may receive a structured rejection result
- the turn may continue if the provider can recover

### `ApplyingPatch`

The runtime is applying an approved patch associated with the active turn.

Requirements:

- create checkpoint before write
- validate write scope
- record changed files
- attach patch metadata to the event log

Emitted events:

- `CheckpointCreated`
- `PatchApplied`

Allowed transitions:

- `ApplyingPatch -> AwaitingProvider`
- `ApplyingPatch -> Verifying`
- `ApplyingPatch -> Failed`

## Verification State

### `Verifying`

The runtime is validating that the result of the active turn is acceptable.

Examples:

- run tests
- run lint
- inspect diagnostics
- compare diff shape
- ensure files were actually changed when expected

Emitted events:

- `VerificationCompleted`

Allowed transitions:

- `Verifying -> AwaitingProvider`
- `Verifying -> Completed`
- `Verifying -> Failed`

Verification does not always imply shell execution.
Some verification may be purely structural.

## Terminal States

### `Completed`

The turn finished successfully.

Entry conditions:

- provider stopped normally
- no unresolved tool or patch approvals remain
- verification status is acceptable, if verification was required

Effects:

- session returns to `Idle`
- turn summary can be recorded

### `Interrupted`

The turn was paused or stopped before normal completion.

Examples:

- user interrupt
- transport disconnect
- explicit pause for later resume

Effects:

- active provider stream is cancelled
- active tool execution receives cancellation
- session enters `Interrupted`

### `Failed`

The turn encountered an unrecoverable error.

Examples:

- provider adapter error
- invalid tool call
- patch application failure
- unrecoverable storage failure

Emitted events:

- `SessionFailed` or turn-scoped failure event

## Transition Rules

## Rule 1: Only one active turn per session

The runtime must reject new turn submissions while a previous turn is still active unless explicit concurrency support is added later.

This rule does not prevent later support for:

- background tasks
- child tasks
- subagents

It only means that one foreground session should expose at most one primary active turn at a time in the first version.

## Rule 2: Approval states block progress

While the runtime is in `AwaitingToolApproval` or `AwaitingPatchApproval`, no further provider progress may occur for that turn.

## Rule 3: Checkpoint before workspace mutation

Any patch or direct edit that mutates the workspace must create a checkpoint first.

## Rule 4: Provider output must be normalized before use

Provider-native tool calls or delta shapes are not consumed directly by runtime subsystems.

## Rule 5: All visible state changes emit events

If the UI or replay tooling needs to understand a transition, the runtime must emit an explicit event for it.

## Interrupt Semantics

Interrupt should be modeled as a command that:

1. cancels the active provider stream
2. cancels active tool execution if possible
3. records an interruption event
4. leaves the session resumable when safe

If a tool is not safely interruptible, the runtime should:

- record that interruption was requested
- complete tool cleanup
- then move to `Interrupted`

## Resume Semantics

Resume should only be allowed when:

- session is in `Interrupted`
- checkpoint and event log are coherent
- the runtime can reconstruct orchestration state

Resume flow:

```text
Interrupted
-> reconstruct state from event log and checkpoints
-> RunningTurn or Idle
```

## Recommended Turn Outcomes

Each turn should end with one of these outcomes:

- `answered`
- `tool_executed`
- `patch_applied`
- `verification_failed`
- `interrupted`
- `failed`

This outcome should be stored in turn metadata for analytics and replay.

## Suggested Internal Enum Shapes

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Created,
    Idle,
    RunningTurn,
    Interrupted,
    Completed,
    Failed,
}
```

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnState {
    Accepted,
    Planning,
    RetrievingContext,
    AwaitingProvider,
    AwaitingToolApproval,
    RunningTool,
    AwaitingPatchApproval,
    ApplyingPatch,
    Verifying,
    Completed,
    Interrupted,
    Failed,
}
```

## First MVP Simplification

The MVP does not need every state to be implemented in full detail.

The minimum practical turn graph is:

```text
accepted
-> planning
-> awaiting_provider
-> awaiting_tool_approval
-> running_tool
-> awaiting_patch_approval
-> applying_patch
-> completed
```

Optional for MVP:

- `retrieving_context` as its own explicit state
- `verifying` as its own explicit state
- `resume` across process restarts

## Recommended MVP Executor Shape

Inside `comet-rs/core`, the first executor should be intentionally small.

Suggested ownership split:

- `session/`
  loads a thread into one live session and guards one-active-turn semantics
- `turn/`
  creates and finalizes durable turns
- `task/`
  tracks the primary execution unit for the active turn
- `orchestrator/`
  runs the foreground loop and transition reducer
- `checkpoint/`
  creates checkpoints before mutation and handles rollback
- `tools/`
  executes tool requests behind the stable ABI
- `providers/`
  owns provider-facing traits consumed by `comet-api`

The point of this split is not crate fragmentation.

It is to keep one implementable loop with clear ownership boundaries inside `core`.

## Observability

The runtime should expose at least:

- current session state
- loaded thread id
- current turn state
- active task id
- last provider request id
- active tool call id
- last checkpoint id
- last verification result

These are required for UI fidelity and debugging.
