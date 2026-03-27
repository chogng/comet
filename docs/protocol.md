# Comet Protocol

## Goal

Comet uses three protocol layers:

1. provider protocol at the edge
2. internal runtime protocol inside Rust
3. tool ABI between the runtime and tool implementations

This separation keeps the core stable while allowing providers and clients to change independently.

## Foundation

Comet should deliberately combine Codex and Cursor rather than copying either one wholesale.

- use Codex's domain model for durable ownership: `thread`, `turn`, `item`, `task`
- use Cursor's runtime envelope patterns for reliability and correlation: `idempotency_key`, `seqno`, `seqno_ack`, `tool_call_id`, `model_call_id`, `tool_index`, `subagent_id`
- treat `thread_id` as the canonical durable identity inside Comet
- treat `session_id` as an optional live runtime handle, not as the durable conversation owner
- normalize external `conversation_id` values to `thread_id` at adapter boundaries
- avoid one overloaded `request_id`; use typed ids such as `command_id`, `turn_id`, `tool_call_id`, `model_call_id`, and `subagent_id`

## Completeness Note

The protocol shapes in this document are not intended to be Cursor-level complete.

They are:

- complete enough to define the core product architecture
- complete enough for a first MVP implementation
- intentionally smaller than Cursor's observed protocol surface

They are not yet complete in these Cursor-like areas:

- rich request-side context injection fields
- provider stream reliability envelopes
- tool call grouping and streaming metadata
- subagent and async task lifecycle fields
- structured tool error visibility split
- response-side citations, links, and status metadata

Cursor's locally extracted schema shows a much wider field surface in:

- `aiserver.v1.StreamUnifiedChatRequest`
- `aiserver.v1.StreamUnifiedChatResponse`
- `aiserver.v1.StreamUnifiedChatRequestWithToolsIdempotent`
- `aiserver.v1.StreamUnifiedChatResponseWithToolsIdempotent`
- `aiserver.v1.ClientSideToolV2Call`
- `aiserver.v1.ClientSideToolV2Result`
- `aiserver.v1.ToolResultError`
- `aiserver.v1.SubagentInfo`
- `aiserver.v1.SubagentReturnCall`

Comet should learn from those structures, but should not copy them mechanically.

## Cursor-Informed Lessons

Based on the local Cursor research materials, the most important protocol lessons are:

1. Request payloads become large when context engineering is explicit.
2. Tool invocation should use a separate envelope from main response text.
3. Reliability fields such as `idempotency_key`, `seqno`, and `seqno_ack` matter for long-running streams.
4. Tool calls need grouping metadata such as `tool_call_id`, `tool_index`, and `model_call_id`.
5. Tool errors should separate user-visible and model-visible messages.
6. Subagent and task orchestration eventually need protocol-level representation.
7. Response payloads often include more than text, such as citations, status, context updates, and plan signals.

Comet's protocol should therefore evolve in layers:

- core MVP surface first
- richer request envelope second
- richer response and task orchestration fields third

## Protocol Layers

```text
external provider APIs
        |
        v
provider adapters
        ^
        |
transport clients
        |
        v
internal runtime protocol
        |
        +------------------+
        |                  |
        v                  v
frontend transport     tool ABI
```

For Rust code organization, app-server HTTP boundary types should live in a dedicated protocol module rather than continue expanding the general-purpose `common` module.

Recommended module split inside `comet-rs/protocol`:

- `common`: shared domain and wire building blocks
- `client`: runtime command and event payloads
- `provider`: provider-facing runtime envelopes
- `tool`: tool ABI payloads
- `app_server`: HTTP request and response shapes for app-server endpoints

## 1. Provider Protocol

The provider protocol is not designed by Comet.
It is whatever an external model provider requires.

Examples:

- OpenAI Responses
- Anthropic streaming messages
- MCP tool interactions
- future provider-specific APIs

These protocols are handled only inside provider adapter crates under `comet-rs/`.

Reusable transport mechanics used to talk to those providers should live in a separate transport client layer, not inside the internal runtime protocol and not necessarily inside each adapter crate.

Provider adapters must convert provider-native structures into Comet-native runtime commands and events.

## 2. Internal Runtime Protocol

The internal runtime protocol is Comet's canonical language.

Everything inside the system should use this protocol:

- runtime
- app server
- TUI
- TS frontend
- checkpoint engine
- approval system
- event log
- replay tools

The protocol should be:

- explicit
- versioned
- transport-neutral
- serializable
- stable across providers

## Domain Terminology Alignment

This protocol document follows the terminology in [domain-model.md](/Users/lance/Desktop/comet/docs/domain-model.md).

The important distinctions are:

- `thread` is the durable conversation container
- `session` is the live loaded runtime handle bound to one thread
- `turn` is the user-visible interaction step
- `task` is the execution unit inside runtime behavior

Comet is thread-first at the protocol level.

- `thread_id` is the canonical durable identity and should appear on any payload that affects persisted history
- `session_id` is optional and should only identify a currently loaded runtime instance when one exists
- live control may still target a session, but session targeting must not replace thread ownership
- turns belong to a thread and are executed through a session when a loaded runtime is present
- adapters may accept external `conversation_id` values, but they should normalize them to `thread_id` before entering Comet's internal protocol

## Protocol Surface Split

One thing Cursor makes very clear is that not all "protocol fields" belong to the same layer.

Comet should keep these surfaces distinct:

1. client control protocol
   This is what TUI, TS, or IDE frontends send to the runtime and receive back.
2. runtime-to-provider protocol
   This is the richer turn envelope that the runtime gives to a provider adapter.
3. tool ABI
   This is the execution contract between the runtime and tools.

This matters because Cursor's richest fields mostly live in the provider-facing turn envelope, not in frontend command payloads.

## Wire Naming Rule

All JSON payloads should use camelCase on the wire.

That includes both:

- normal struct fields
- named fields inside tagged enum variants

In Rust terms, tagged enums should use:

```rust
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
```

Without `rename_all_fields = "camelCase"`, variant names serialize correctly but named variant fields fall back to Rust `snake_case`, which is not acceptable for the Comet wire format.

## Command Model

Commands are requests sent into the runtime.

Cursor's local schema makes one thing very clear:

- the control surface is not just a small enum
- it is a layered protocol made of:
  - durable and operational ids
  - a reliability envelope
  - target metadata
  - a typed payload

Comet should follow that shape.

It should do so with Codex-style ownership semantics and Cursor-style runtime correlation fields.

It should not copy Cursor's names mechanically.

In particular:

- Cursor's `conversation_id` maps better to Comet `thread_id`
- Cursor's `request_id` should not stay overloaded as one id in Comet
- tool and subagent correlation ids should still be preserved

Recommended structure:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub transport_version: String,
    pub runtime_protocol_version: String,
    pub command_id: String,
    pub idempotency_key: Option<String>,
    pub seqno: Option<u64>,
    pub actor: CommandActor,
    pub target: CommandTarget,
    pub issued_at: i64,
    pub expected_state: Option<ExpectedRuntimeState>,
    pub payload: ClientCommand,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandActor {
    pub actor_type: ActorType,
    pub client_id: Option<String>,
    pub user_id: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CommandTarget {
    Session {
        thread_id: String,
        session_id: String,
    },
    Turn {
        thread_id: String,
        session_id: String,
        turn_id: String,
    },
    Task {
        thread_id: String,
        session_id: String,
        task_id: String,
    },
    Subagent {
        thread_id: String,
        session_id: String,
        subagent_id: String,
        subagent_type: String,
    },
    Patch {
        thread_id: String,
        patch_id: String,
    },
    Checkpoint {
        thread_id: String,
        checkpoint_id: String,
    },
}
```

Suggested payload enum:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientCommand {
    StartSession {
        cwd: String,
        model: String,
        provider: ProviderRef,
        sandbox_mode: SandboxMode,
        approval_mode: ApprovalMode,
        client_capabilities: ClientCapabilities,
        supported_tools: Vec<String>,
        tools_requiring_accepted_return: Vec<String>,
        workspace_folders: Vec<WorkspaceFolder>,
        environment_info: Option<EnvironmentInfo>,
    },
    SubmitUserTurn {
        turn_id: String,
        text: String,
        attachments: Vec<AttachmentRef>,
        reply_to_turn_id: Option<String>,
        turn_context: Option<TurnContextHints>,
        current_file: Option<CurrentFileRef>,
        diagnostics: Vec<DiagnosticSummary>,
        additional_ranked_context: Vec<RankedContextRef>,
        external_links: Vec<ExternalLinkRef>,
        current_plan: Option<CurrentPlanRef>,
        custom_planning_instructions: Option<String>,
        use_web: bool,
        unified_mode: SessionMode,
    },
    ApproveToolCall {
        turn_id: String,
        tool_call_id: String,
        model_call_id: Option<String>,
        tool_index: Option<u32>,
    },
    RejectToolCall {
        turn_id: String,
        tool_call_id: String,
        model_call_id: Option<String>,
        tool_index: Option<u32>,
        reason: Option<String>,
    },
    ApplyPatch {
        patch_id: String,
        turn_id: Option<String>,
        apply_mode: PatchApplyMode,
    },
    RejectPatch {
        patch_id: String,
        turn_id: Option<String>,
        rejection_reason: Option<String>,
    },
    Interrupt {
        turn_id: Option<String>,
        task_id: Option<String>,
        reason: Option<String>,
        interrupt_scope: InterruptScope,
    },
    Resume {
        turn_id: Option<String>,
        resume_strategy: ResumeStrategy,
    },
    RollbackToCheckpoint {
        checkpoint_id: String,
        rollback_mode: RollbackMode,
        conflict_policy: RollbackConflictPolicy,
    },
    ApproveSubagentAction {
        action_id: String,
        subagent_id: String,
        subagent_type: String,
    },
    RejectSubagentAction {
        action_id: String,
        subagent_id: String,
        subagent_type: String,
        reason: Option<String>,
    },
    SetSessionMode {
        mode: SessionMode,
        reason: Option<String>,
    },
}
```

This is still smaller than Cursor's full request surface.

But it is no longer unrealistically thin.

The important lesson from Cursor is:

- keep command payloads typed
- keep correlation and reliability metadata outside the payload
- keep rich model-facing context available when a turn starts

Useful Cursor-inspired fields Comet should preserve somewhere in this layer include:

- `threadId`
- `sessionId`
- `turnId`
- `taskId`
- `commandId`
- `idempotencyKey`
- `seqno`
- `toolCallId`
- `modelCallId`
- `toolIndex`
- `subagentId`
- `subagentType`
- `replyingToRequestId` or Comet equivalent via `replyToTurnId`
- `supportedTools`
- `toolsRequiringAcceptedReturn`
- `workspaceFolders`
- `currentPlan`
- `customPlanningInstructions`
- `environmentInfo`
- `repositoryInfo`

## Event Model

Events are emitted by the runtime.

Cursor's response schema is also richer than a plain stream of text deltas.

It includes:

- text and intermediate text
- tool call and final tool result correlation
- status updates
- context-window signals
- conversation summaries
- subagent return
- event ids and tracing context

Comet should keep its runtime events explicit in the same way.

Recommended event envelope:

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
    pub payload: ServerEvent,
}
```

Rules:

- `seqno` is a per-thread, server-assigned, monotonically increasing event sequence
- `seqno` must come from the thread event log domain, not from a client-supplied command envelope
- `seqnoAck` may acknowledge client command ordering, but it must not be used as the replay cursor for thread event streams

Suggested payload enum:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerEvent {
    SessionStarted {
        thread_id: String,
        session_id: String,
        state: SessionState,
        sandbox_mode: SandboxMode,
        approval_mode: ApprovalMode,
    },
    UserTurnAccepted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        reply_to_turn_id: Option<String>,
    },
    AgentDelta {
        thread_id: String,
        session_id: String,
        turn_id: String,
        text: String,
        chunk_id: Option<String>,
        intermediate_text: Option<String>,
    },
    AgentMessageCompleted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        text: String,
        message_id: String,
        request_id: Option<String>,
    },
    PlanUpdated {
        thread_id: String,
        session_id: String,
        turn_id: String,
        steps: Vec<PlanStep>,
        current_plan: Option<CurrentPlanRef>,
    },
    ThinkingDelta {
        thread_id: String,
        session_id: String,
        turn_id: String,
        text: String,
        is_last_chunk: bool,
        thinking_style: Option<ThinkingStyle>,
    },
    ToolCallProposed {
        thread_id: String,
        session_id: String,
        turn_id: String,
        task_id: Option<String>,
        tool_call_id: String,
        model_call_id: Option<String>,
        tool_index: Option<u32>,
        tool: String,
        name: Option<String>,
        input: serde_json::Value,
        raw_args: Option<String>,
        risk: RiskLevel,
        requires_approval: bool,
        timeout_ms: Option<u64>,
        is_streaming: bool,
        is_last_message: bool,
    },
    ApprovalRequested {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        reason: String,
        tool: String,
        risk: RiskLevel,
        input_summary: ToolInputSummary,
        active_sandbox_mode: Option<SandboxMode>,
    },
    ToolCallStarted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        model_call_id: Option<String>,
        tool_index: Option<u32>,
    },
    ToolCallStdout {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        chunk: String,
    },
    ToolCallStderr {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        chunk: String,
    },
    ToolCallCompleted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        model_call_id: Option<String>,
        tool_index: Option<u32>,
        result: serde_json::Value,
        attachments: Vec<ToolAttachment>,
    },
    ToolCallFailed {
        thread_id: String,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        error: ToolFailure,
    },
    PatchProposed {
        thread_id: String,
        session_id: String,
        turn_id: String,
        patch_id: String,
        files: Vec<PatchFileSummary>,
        checkpoint_id: Option<String>,
    },
    PatchApplied {
        thread_id: String,
        session_id: String,
        turn_id: String,
        patch_id: String,
        checkpoint_id: String,
    },
    PatchRejected {
        thread_id: String,
        session_id: String,
        turn_id: String,
        patch_id: String,
    },
    VerificationCompleted {
        thread_id: String,
        session_id: String,
        turn_id: Option<String>,
        result: VerificationResult,
    },
    CheckpointCreated {
        thread_id: String,
        session_id: String,
        turn_id: Option<String>,
        checkpoint_id: String,
        reason: CheckpointReason,
    },
    ContextUpdated {
        thread_id: String,
        session_id: String,
        turn_id: String,
        summary: ContextUpdateSummary,
    },
    CitationEmitted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        citation: Citation,
    },
    StatusUpdated {
        thread_id: String,
        session_id: String,
        turn_id: String,
        status: StatusUpdate,
    },
    ConversationSummaryUpdated {
        thread_id: String,
        session_id: Option<String>,
        summary: ConversationSummaryRef,
    },
    ContextWindowUpdated {
        thread_id: String,
        session_id: Option<String>,
        turn_id: Option<String>,
        status: ContextWindowStatus,
    },
    SubagentSpawned {
        thread_id: String,
        session_id: String,
        turn_id: String,
        subagent: SubagentRef,
    },
    SubagentUpdated {
        thread_id: String,
        session_id: String,
        turn_id: String,
        subagent: SubagentRef,
        status: SubagentStatus,
    },
    SubagentCompleted {
        thread_id: String,
        session_id: String,
        turn_id: String,
        subagent: SubagentRef,
        result: serde_json::Value,
    },
    StreamStarted {
        thread_id: String,
        session_id: Option<String>,
        padding: Option<String>,
    },
    SessionCompleted {
        thread_id: String,
        session_id: String,
    },
    SessionFailed {
        thread_id: String,
        session_id: String,
        error: RuntimeError,
    },
}
```

The key change here is not just "more fields".

It is that Comet events should be:

- addressable
- replayable
- correlated across turn, task, tool, patch, and subagent boundaries
- rich enough for TUI and future IDE/web clients

## Shared Types

These types should live in `comet-rs/protocol`.

### Provider Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRef {
    pub kind: ProviderKind,
    pub profile: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    Mcp,
    Local,
    Custom,
}
```

### Session State

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Created,
    Idle,
    RunningTurn,
    Interrupted,
    Completed,
    Failed,
}
```

### Sandbox Mode

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}
```

### Approval Mode

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    Always,
    OnRequest,
    Never,
}
```

### Risk Level

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}
```

### Thread Read Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadModel {
    pub thread_id: String,
    pub session_id: Option<String>,
    pub session_state: Option<SessionState>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub provider: Option<ProviderRef>,
    pub sandbox_mode: Option<SandboxMode>,
    pub approval_mode: Option<ApprovalMode>,
    pub last_event_seqno: Option<u64>,
    pub active_turn_id: Option<String>,
    pub pending_tool_approval: Option<PendingToolApprovalSummary>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingToolApprovalSummary {
    pub turn_id: String,
    pub tool_call_id: String,
    pub tool: String,
    pub risk: RiskLevel,
    pub reason: String,
    pub input_summary: ToolInputSummary,
    pub active_sandbox_mode: Option<SandboxMode>,
}
```

This read model is intended for thread/session read APIs and reconnect flows.

- it is a derived runtime view, not a durable event
- it is the recommended response shape for `GET /api/v1/threads/{threadId}`
- it should expose active session configuration when a live session is attached
- `lastEventSeqno` means the highest thread event `seqno` fully reflected by this read model
- it should expose the currently pending approval in normalized form
- clients should prefer this model over replaying a long event stream just to rebuild one approval card

### Thread Subscription Frames

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSubscriptionParams {
    pub after: Option<u64>,
    pub snapshot: Option<ThreadSubscriptionSnapshotMode>,
    pub heartbeat_sec: Option<u32>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadSubscriptionSnapshotMode {
    None,
    IfEmpty,
    Always,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSnapshotFrame {
    pub thread_id: String,
    pub session_id: Option<String>,
    pub last_included_seqno: u64,
    pub read_model: ThreadReadModel,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorGapFrame {
    pub thread_id: String,
    pub requested_after: u64,
    pub oldest_available_seqno: Option<u64>,
    pub latest_seqno: Option<u64>,
    pub recovery: String,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionReadyFrame {
    pub thread_id: String,
    pub from_seqno_exclusive: Option<u64>,
    pub next_seqno: Option<u64>,
    pub mode: String,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ThreadSubscriptionFrame {
    Snapshot(ThreadSnapshotFrame),
    Event(EventEnvelope),
    Gap(CursorGapFrame),
    Ready(SubscriptionReadyFrame),
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadSubscriptionErrorCode {
    InvalidCursor,
    ThreadNotFound,
    CursorGap,
    StreamReset,
    UnsupportedResumeMode,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSubscriptionError {
    pub code: ThreadSubscriptionErrorCode,
    pub message: String,
    pub retryable: bool,
}
```

Rules:

- `Snapshot.lastIncludedSeqno` and `readModel.lastEventSeqno` must match
- `after=N` means the server returns only events with `seqno > N`
- `Gap` means the requested cursor cannot be resumed and the client must reload a fresh snapshot
- `Ready` marks the transition from snapshot or replay into live streaming

### Checkpoint Read State

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
pub struct ThreadCheckpointReadState {
    pub last_checkpoint_id: Option<String>,
    pub checkpoints: Vec<CheckpointSummary>,
}
```

### Plan Step

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub title: String,
    pub status: PlanStepStatus,
}
```

### Plan Step Status

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanStepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}
```

### Verification Result

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub success: bool,
    pub summary: String,
    pub outputs: Vec<VerificationOutput>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationOutput {
    pub name: String,
    pub success: bool,
    pub summary: String,
}
```

### Runtime Error

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
```

### Attachment Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub kind: AttachmentKind,
    pub path: Option<String>,
    pub mime_type: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    Image,
    File,
    Text,
}
```

### Client Capabilities

Cursor's request schema makes one design pattern very clear:
the client should tell the runtime and provider what it can support.

Suggested shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    pub supports_patch_review: bool,
    pub supports_streaming_tool_output: bool,
    pub supports_thinking_display: bool,
    pub supports_images: bool,
    pub supports_resume: bool,
    pub supports_message_editing: bool,
}
```

### Turn Context Hints

This is Comet's smaller equivalent of the rich request-side context fields seen in Cursor.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnContextHints {
    pub current_file: Option<String>,
    pub selected_paths: Vec<String>,
    pub user_visible_diagnostics: Vec<DiagnosticRef>,
    pub reply_to_message_id: Option<String>,
}
```

### Diagnostic Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRef {
    pub path: String,
    pub line: Option<u32>,
    pub severity: Option<String>,
    pub message: String,
}
```

### Tool Failure

Cursor's `ToolResultError` strongly suggests separating user-visible and model-visible messages.

Suggested shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFailure {
    pub code: String,
    pub client_visible_message: String,
    pub model_visible_message: String,
    pub internal_message: Option<String>,
    pub retryable: bool,
}
```

### Tool Attachment

Tool results often need supplementary metadata beyond a raw output payload.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAttachment {
    pub kind: String,
    pub name: String,
    pub value: serde_json::Value,
}
```

### Patch File Summary

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileSummary {
    pub path: String,
    pub status: PatchFileStatus,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchFileStatus {
    Added,
    Modified,
    Deleted,
}
```

### Citation

Cursor's response schema includes documentation, web, symbol, and file references.
Comet should leave room for the same category.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Citation {
    File {
        path: String,
        line: Option<u32>,
    },
    Symbol {
        symbol: String,
        path: String,
        line: Option<u32>,
    },
    Web {
        title: String,
        url: String,
    },
    Docs {
        title: String,
        locator: String,
    },
}
```

### Status Update

Response-side status lines should have a stable type instead of being implicit text.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusUpdate {
    pub phase: String,
    pub message: String,
}
```

### Context Update Summary

This is a compact internal equivalent of Cursor's `context_piece_update` and related fields.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUpdateSummary {
    pub working_set_paths: Vec<String>,
    pub retrieved_chunk_ids: Vec<String>,
    pub dropped_chunk_ids: Vec<String>,
}
```

### Checkpoint Reason

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointReason {
    BeforeEditFile,
    BeforeApplyPatch,
    BeforeDeleteFile,
    ManualCheckpoint,
    BeforeRollback,
}
```

### Subagent Reference

Cursor's `SubagentInfo` and `SubagentReturnCall` show that subagent lifecycle eventually needs protocol-level representation.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentRef {
    pub id: String,
    pub kind: SubagentKind,
    pub parent_turn_id: String,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubagentKind {
    DeepSearch,
    FixLints,
    Task,
    Spec,
    Custom,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubagentStatus {
    Queued,
    Running,
    Waiting,
    Completed,
    Failed,
}
```

### Session Mode

Cursor's request-side fields indicate that mode is important enough to be explicit.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    Chat,
    Agent,
    Background,
    Spec,
}
```

### Actor Type

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActorType {
    User,
    Client,
    Runtime,
    System,
}
```

### Expected Runtime State

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedRuntimeState {
    pub session_state: Option<SessionState>,
    pub active_turn_id: Option<String>,
    pub active_task_id: Option<String>,
}
```

### Patch Apply Mode

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchApplyMode {
    Apply,
    ApplyAndContinue,
}
```

### Interrupt Scope

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InterruptScope {
    Session,
    Turn,
    Task,
}
```

### Resume Strategy

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResumeStrategy {
    Continue,
    RetryLastStep,
    RehydrateOnly,
}
```

### Rollback Mode

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RollbackMode {
    Workspace,
    ConversationHead,
    WorkspaceAndConversationHead,
}
```

### Rollback Conflict Policy

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RollbackConflictPolicy {
    Fail,
    Force,
    RequireApproval,
}
```

### Thinking Style

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThinkingStyle {
    Default,
    Codex,
    Gpt5,
}
```

### Current Plan Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPlanRef {
    pub name: Option<String>,
    pub content: String,
}
```

### Current File Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentFileRef {
    pub path: String,
    pub selection: Option<SelectionRange>,
}
```

### Diagnostic Summary

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    pub path: String,
    pub line: Option<u32>,
    pub severity: Option<String>,
    pub message: String,
}
```

### Ranked Context Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedContextRef {
    pub id: String,
    pub path: Option<String>,
    pub score: f32,
}
```

### Conversation Summary Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummaryRef {
    pub summary: String,
    pub truncation_anchor: Option<String>,
}
```

### Context Window Status

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindowStatus {
    pub used_tokens: Option<u32>,
    pub max_tokens: Option<u32>,
    pub summary: Option<String>,
}
```

### Workspace Folder

`WorkspaceFolder` in the command surface and `WorkspaceFolderRef` in provider context can share the same shape in the first version.

```rust
pub type WorkspaceFolder = WorkspaceFolderRef;
```

### Environment Info

`EnvironmentInfo` in the command surface and `EnvironmentContext` in provider context can also share the same shape in the first version.

```rust
pub type EnvironmentInfo = EnvironmentContext;
```

## Runtime-To-Provider Turn Envelope

This is the most important missing distinction from the earlier Comet draft.

`ClientCommand::SubmitUserTurn` is not the same thing as the full provider-facing turn request.

The runtime-to-provider envelope is where Comet should carry the richer field categories inspired by Cursor:

- conversation state
- explicit context
- current file and diagnostics
- ranked retrieval context
- repository and environment metadata
- tool permissions and MCP descriptors
- planning state and thinking level
- mode, resume, and background execution hints

Suggested shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTurnRequest {
    pub thread: ThreadDescriptor,
    pub session: SessionDescriptor,
    pub turn: TurnDescriptor,
    pub conversation: Vec<ConversationItem>,
    pub conversation_summary: Option<ConversationSummary>,
    pub context: ContextPackage,
    pub tool_permissions: ToolPermissionContext,
    pub planning: PlanningContext,
}
```

### Thread Descriptor

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDescriptor {
    pub thread_id: String,
}
```

### Session Descriptor

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDescriptor {
    pub session_id: String,
    pub cwd: String,
    pub mode: SessionMode,
    pub model: String,
    pub provider: ProviderRef,
    pub sandbox_mode: SandboxMode,
    pub approval_mode: ApprovalMode,
}
```

### Turn Descriptor

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDescriptor {
    pub turn_id: String,
    pub user_text: String,
    pub attachments: Vec<AttachmentRef>,
    pub reply_to_turn_id: Option<String>,
    pub is_resume: bool,
    pub is_background: bool,
}
```

### Conversation Item

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ConversationItem {
    User {
        message_id: String,
        text: String,
    },
    Assistant {
        message_id: String,
        text: String,
    },
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        output: serde_json::Value,
    },
    Thinking {
        message_id: String,
        text: String,
        is_redacted: bool,
    },
}
```

### Conversation Summary

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub text: String,
}
```

### Context Package

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackage {
    pub explicit_instructions: Vec<String>,
    pub current_file: Option<CurrentFileContext>,
    pub diagnostics: Vec<DiagnosticRef>,
    pub ranked_context: Vec<RankedSnippet>,
    pub recent_edits: Vec<RecentEdit>,
    pub file_diff_history: Vec<FileDiffSummary>,
    pub quotes: Vec<QuoteRef>,
    pub external_links: Vec<ExternalLinkRef>,
    pub repository: Option<RepositoryContext>,
    pub environment: Option<EnvironmentContext>,
    pub workspace_folders: Vec<WorkspaceFolderRef>,
}
```

### Current File Context

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentFileContext {
    pub path: String,
    pub contents: Option<String>,
    pub selection: Option<SelectionRange>,
}
```

### Selection Range

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRange {
    pub start_line: u32,
    pub end_line: u32,
}
```

### Ranked Snippet

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedSnippet {
    pub id: String,
    pub path: Option<String>,
    pub score: f32,
    pub text: String,
}
```

### Recent Edit

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEdit {
    pub path: String,
    pub summary: String,
}
```

### File Diff Summary

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffSummary {
    pub path: String,
    pub diff: String,
}
```

### Quote Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteRef {
    pub source_message_id: Option<String>,
    pub text: String,
}
```

### External Link Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkRef {
    pub title: String,
    pub url: String,
}
```

### Repository Context

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryContext {
    pub root_path: String,
    pub repository_name: Option<String>,
    pub branch: Option<String>,
    pub indexing_progress: Option<f32>,
    pub supports_git_index: bool,
}
```

### Environment Context

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentContext {
    pub os: Option<String>,
    pub shell: Option<String>,
    pub timezone: Option<String>,
}
```

### Workspace Folder Reference

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFolderRef {
    pub name: Option<String>,
    pub path: String,
}
```

### Tool Permission Context

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionContext {
    pub supported_tools: Vec<String>,
    pub approval_required_tools: Vec<String>,
    pub disable_tools: bool,
    pub mcp_tools: Vec<McpToolDescriptor>,
}
```

### MCP Tool Descriptor

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub name: String,
    pub description: Option<String>,
}
```

### Planning Context

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningContext {
    pub current_plan: Vec<PlanStep>,
    pub custom_planning_instructions: Option<String>,
    pub thinking_level: Option<ThinkingLevel>,
    pub subagent: Option<SubagentRef>,
}
```

### Thinking Level

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThinkingLevel {
    Medium,
    High,
}
```

## Provider Stream Event Model

The runtime should not receive raw provider protocol events.
The adapter should normalize them into a provider-facing internal stream.

Suggested shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ProviderStreamEvent {
    TextDelta {
        turn_id: String,
        text: String,
        chunk_id: Option<String>,
    },
    ThinkingDelta {
        turn_id: String,
        text: String,
        is_last_chunk: bool,
    },
    Status {
        turn_id: String,
        status: StatusUpdate,
    },
    Citation {
        turn_id: String,
        citation: Citation,
    },
    ContextUpdate {
        turn_id: String,
        summary: ContextUpdateSummary,
    },
    ToolCallRequested {
        request: ToolRequest,
    },
    MessageCompleted {
        turn_id: String,
        message_id: String,
        text: String,
    },
    SubagentReturned {
        turn_id: String,
        subagent: SubagentRef,
        result: serde_json::Value,
    },
    Completed,
    Failed {
        error: RuntimeError,
    },
}
```

## Tool ABI

The tool ABI is the interface between `comet-rs/core` and tool implementations.

The runtime should not care whether a tool is implemented through:

- local filesystem calls
- subprocess execution
- git commands
- MCP transport
- future remote services

It only cares about a stable request/response contract.

## Tool Trait

Suggested Rust interface:

```rust
use async_trait::async_trait;

#[async_trait]
pub trait Tool: Send + Sync {
    fn spec(&self) -> ToolSpec;

    async fn invoke(
        &self,
        ctx: ToolContext,
        request: ToolRequest,
        sink: &mut dyn ToolEventSink,
    ) -> Result<ToolResponse, ToolInvokeError>;
}
```

```rust
pub type ToolInvokeError = RuntimeError;
```

## Tool Spec

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub tool_abi_version: String,
    pub risk: RiskLevel,
    pub needs_approval: bool,
    pub supports_streaming: bool,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
}
```

## Tool Request

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
    pub source: ToolCallSource,
    pub model_call_id: Option<String>,
    pub tool_index: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub is_streaming: bool,
    pub is_last_message: bool,
    pub raw_args: Option<String>,
}
```

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolCallSource {
    Model,
    Runtime,
    User,
}
```

## Tool Response

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResponse {
    pub tool_call_id: String,
    pub tool_name: String,
    pub output: serde_json::Value,
    pub metadata: ToolResultMetadata,
    pub model_call_id: Option<String>,
    pub tool_index: Option<u32>,
    pub attachments: Vec<ToolAttachment>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultMetadata {
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInputSummary {
    pub title: String,
    pub primary_text: Option<String>,
    pub secondary_text: Option<String>,
    pub fields: Vec<ToolInputFieldSummary>,
    pub danger_hints: Vec<String>,
}
```

`ToolInputSummary` is runtime-derived approval UI data.

- it is not part of the provider-native tool call payload
- it should be produced by the tool registry or tool implementation
- tool-specific summaries should override the generic JSON fallback when available
- the orchestrator should consume this summary, not synthesize it locally
- `title` is the card heading
- `primary_text` is the most important human-facing action preview
- `secondary_text` is short supporting context such as cwd, path scope, or counts
- `fields` remain the structured detail list for expandable rendering
- `danger_hints` are explicit warnings for destructive or high-risk actions
- field order inside `fields` is significant and should be preserved by clients
- `danger_hints` should be treated as direct rendering hints, not reclassified by clients

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInputFieldSummary {
    pub path: String,
    pub value_preview: String,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRejection {
    pub status: String,
    pub reason: Option<String>,
    pub rejected_by: ToolCallSource,
    pub tool_call_id: String,
    pub tool_name: String,
}
```

## Tool Context

```rust
pub struct ToolContext {
    pub session_id: String,
    pub cwd: std::path::PathBuf,
    pub sandbox_mode: SandboxMode,
    pub approval_mode: ApprovalMode,
    pub cancellation: tokio_util::sync::CancellationToken,
    pub writable_roots: Vec<std::path::PathBuf>,
}
```

`ToolContext` can be expanded later with:

- writable roots
- git context
- environment overrides
- network policy
- workspace metadata

## Tool Event Sink

Streaming tools should emit structured progress instead of raw text only.

Suggested event forms:

```rust
pub enum ToolEvent {
    Stdout { chunk: String },
    Stderr { chunk: String },
    Progress { message: String },
    Artifact { path: String },
}
```

## Reliability Envelope

Cursor's stream protocol makes a strong case for explicit reliability metadata.
Comet should support a transport-neutral reliability envelope even if the first implementation does not need all fields.

Suggested transport envelopes:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliableClientEnvelope<T> {
    pub transport_version: String,
    pub idempotency_key: Option<String>,
    pub seqno: Option<u64>,
    pub frame: ReliableClientFrame<T>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliableServerEnvelope<T> {
    pub transport_version: String,
    pub runtime_protocol_version: String,
    pub seqno_ack: Option<u64>,
    pub event_id: Option<String>,
    pub frame: ReliableServerFrame<T>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ReliableClientFrame<T> {
    Chunk { payload: T },
    Abort,
    Close,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ReliableServerFrame<T> {
    Chunk { payload: T },
    Ack { seqno: u64 },
    Welcome,
}
```

## Provider Adapter Contract

Provider adapters should expose a small interface to the runtime.

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

```rust
pub type ProviderError = RuntimeError;
```

The provider stream should normalize provider-native output into internal events such as:

- text deltas
- completed messages
- tool call requests
- plan updates
- terminal completion

Suggested request types:

```rust
pub type ProviderContinuationRequest = ProviderTurnRequest;
pub type ProviderTurnStream = std::pin::Pin<
    Box<dyn futures::Stream<Item = Result<ProviderStreamEvent, ProviderError>> + Send>,
>;
```

## Transport Contract For TS Frontends

TS frontends should consume only `ClientCommand` and `ServerEvent`.

Recommended API:

- `POST /threads/:id/commands`
- `GET /threads/:id/events`

Or:

- `ws://.../threads/:id`

The frontend should not consume provider-native deltas directly.

This transport contract should be thread-oriented at the durable API boundary.

If a frontend needs to address a specific loaded runtime instance, it should include `sessionId` inside the command target or use it as a subscription hint rather than promoting it above `threadId`.

## Event Log Format

All commands and runtime events should be append-only logged.

Recommended envelope:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedRecord<T> {
    pub id: String,
    pub thread_id: String,
    pub session_id: Option<String>,
    pub seqno: u64,
    pub recorded_at: i64,
    pub payload: T,
}
```

Recommended interpretation:

- `threadId` identifies the durable history owner
- `sessionId` identifies the live runtime instance when one exists

Separate logs are acceptable:

- command log
- event log
- checkpoint log

Or a unified log with tagged payloads.

## Versioning

The internal protocol should be versioned from day one.

Comet should treat these as separate version axes:

- `transportVersion` for frontend-facing transport payloads
- `runtimeProtocolVersion` for canonical internal commands and events
- `toolAbiVersion` for runtime-tool integration
- `logSchemaVersion` for persisted replayed records

For the first implementation:

- `transportVersion = "v1"`
- `runtimeProtocolVersion = "v1"`
- `toolAbiVersion = "v1"`
- `logSchemaVersion = "v1"`

Recommended rules:

- transport payloads include `transportVersion`
- reliability and event envelopes should use the explicit version names above instead of a generic `protocolVersion`
- breaking changes require a new version
- additive fields should preserve backwards compatibility where possible
- provider adapter revisions should not automatically force transport or log version changes

## Safety Rules At Protocol Level

The protocol must make risky actions explicit.

Recommended rules:

1. Every privileged tool call has a stable `tool_call_id`.
2. Approval requests reference the exact `tool_call_id`.
3. Patch application uses a separate command from tool completion.
4. Checkpoint creation emits an explicit event.
5. Rollback is a first-class command, not an implicit side effect.

## Recommended First Stable Surface

Keep the first stable protocol small.

Commands:

- `StartSession`
- `SubmitUserTurn`
- `ApproveToolCall`
- `RejectToolCall`
- `ApplyPatch`
- `Interrupt`

Events:

- `SessionStarted`
- `AgentDelta`
- `AgentMessageCompleted`
- `ToolCallProposed`
- `ApprovalRequested`
- `ToolCallStarted`
- `ToolCallCompleted`
- `PatchProposed`
- `PatchApplied`
- `VerificationCompleted`
- `SessionCompleted`
- `SessionFailed`

Expand only after the first loop is stable.

## Cursor-Level Expansion Areas

If Comet needs to approach Cursor-class product depth, the next protocol expansions should be:

1. richer request-side context envelope
2. richer response-side status and citation envelope
3. reliable streaming envelopes with explicit ack semantics
4. subagent lifecycle events and commands
5. tool result attachments and dual-visibility errors

Those additions should be versioned and introduced intentionally, not ad hoc.

## Recommended Phase Split

### Phase 1

Implement first:

- `ClientCommand`
- `ServerEvent`
- core shared enums and summaries
- `ToolRequest`
- `ToolResponse`
- `ToolFailure`
- `Reliable*Envelope`
- a minimal `ProviderTurnRequest`

Rust workspace mapping:

- `comet-rs/protocol`
- `comet-rs/core`
- `comet-rs/comet-api`
- `comet-rs/tui`

### Phase 2

Add next:

- richer `ContextPackage`
- richer `ProviderStreamEvent`
- citations and status updates
- subagent lifecycle events
- structured tool attachments

Recommended crate growth:

- `comet-rs/app-server`
- `comet-rs/openai`
- `comet-rs/safety`
- `comet-rs/context`
- `comet-rs/checkpoint`

### Phase 3

Add only if product pressure justifies it:

- richer background execution semantics
- more provider-specific capability hints
- more complex shadow workspace or distributed execution fields

Possible later crates:

- `comet-rs/storage`
- `comet-rs/memory`
- `comet-rs/anthropic`
- `comet-rs/app-server`
- `comet-rs/indexing`
- `comet-rs/retrieval`
- `comet-rs/safety`
