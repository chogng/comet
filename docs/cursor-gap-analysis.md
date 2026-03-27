# Comet vs Cursor Protocol Gap Analysis

## Goal

This document compares Comet's current protocol design to the locally extracted Cursor agent schema.

It exists to answer one practical question:

Is Comet's current protocol field set complete enough for a Cursor-class product?

Short answer:

- for MVP architecture: mostly yes
- for Cursor-class product behavior: no

## Scope Of Comparison

This comparison is based on the local Cursor research documents, especially:

- `cursor-agent-field-map.md`
- `cursor-agent-protocol.md`
- `cursor-agent-unified-chat-schema.md`
- `cursor-agent-clienttools-schema.md`
- `cursor-agent-rollback-schema.md`
- `cursor-agent-tool-scheduling-thinking.md`

## Overall Assessment

Comet currently has:

- a cleaner internal abstraction
- a smaller, easier-to-build protocol
- enough structure for an MVP runtime

Cursor currently shows:

- a much richer request envelope
- a much richer response envelope
- explicit reliability fields
- explicit tool grouping metadata
- explicit subagent and task structures
- more response-side UI metadata

That means Comet is architecturally sound but not field-complete.

## Gap 1: Request-Side Context Envelope

Cursor's `StreamUnifiedChatRequest` includes much more than user text.

Major observed categories:

- conversation history
- conversation headers only
- explicit context
- current file
- linter errors
- multi-file linter errors
- recent edits
- file diff histories
- ranked context
- quotes
- external links
- project context
- repository info
- environment info
- workspace folders
- planning fields
- indexing fields
- model fallback fields
- mode flags
- sandbox and terminal support hints

Comet now documents a richer command and provider-turn envelope, but it still does not match Cursor's full request-side surface.

Verdict:

- gap is real
- acceptable for MVP
- must be expanded for a Cursor-class runtime

## Gap 2: Response-Side Metadata

Cursor's `StreamUnifiedChatResponse` is not just text.

Observed categories:

- text and intermediate text
- citations
- docs references
- web citations
- status updates
- tool call echoes
- final tool result echoes
- symbol and file links
- conversation summary
- context updates
- used code
- thinking blocks
- context window status
- subagent return
- parallel tool completion markers

Comet currently documents:

- text delta
- message completed
- plan update
- some tool events
- patch events
- verification and checkpoint events

Verdict:

- Comet's doc model is closer now, but implementation is still behind Cursor's response richness
- not all of it is required initially
- citations, thinking, status updates, context-window updates, and summary signals are high-value additions

## Gap 3: Reliability Envelope

Cursor explicitly models:

- `idempotency_key`
- `seqno`
- `seqno_ack`
- `abort`
- `close`
- `event_id`

Comet now documents explicit reliability envelopes and event correlation, but they are not yet implemented.

Verdict:

- this is a medium-priority gap
- the architecture already points in the right direction
- the explicit envelope should be added before long-running multi-client sessions
- the first thing to get right is not more envelope fields, but one server-assigned per-thread event `seqno` domain plus explicit snapshot, gap, and live-boundary semantics

## Gap 4: Tool Call Metadata

Cursor tool calls and results contain:

- `tool_call_id`
- `tool_index`
- `model_call_id`
- `timeout_ms`
- `is_streaming`
- `is_last_message`
- `raw_args`
- `attachments`

Comet originally modeled only:

- tool name
- call id
- input and output payload

Verdict:

- this was a concrete field gap
- the doc model now includes `toolIndex`, `modelCallId`, streaming flags, and richer envelopes
- implementation still needs to catch up

## Gap 5: Tool Error Structure

Cursor's `ToolResultError` separates:

- client-visible error
- model-visible error
- internal-only actual error

Comet initially had only a generic runtime error shape.

Verdict:

- Cursor is clearly better here
- Comet should adopt the split
- this is especially useful for self-repair loops

## Gap 6: Subagents And Async Tasks

Cursor explicitly models:

- `SubagentInfo`
- `SubagentReturnCall`
- task and await-task tools
- background composer and followup flows

Comet initially documented multi-agent and subagent ideas mostly at the architecture level, and only later promoted them into protocol drafts.

Verdict:

- acceptable for MVP
- must be protocolized if Comet wants serious parallel or delegated execution

## Gap 7: UI-Visible Structured Output

Cursor exposes response-side structures for:

- file links
- symbol links
- docs citations
- web citations
- context updates
- git-view context

Comet initially left most UI structure to higher-level interpretation.

Verdict:

- a gap for rich frontend parity
- not all pieces are equally important
- citations and links are high-value

## Gap 8: Shadow Workspace And Rollback Integration

Cursor's rollback-related schema shows:

- shadow workspace RPC
- lint-for-change flows
- explicit shadow execution endpoints

Comet intentionally chose a simpler checkpoint-first MVP.

Verdict:

- this is a deliberate product scope difference, not a design mistake
- phase 1 should keep the simpler design
- phase 2 can add isolated workspace semantics

## What Comet Already Gets Right

Comet already gets several important things right:

- provider protocol is kept at the edge
- runtime protocol is canonical and product-focused
- tools are behind a stable ABI
- approval, checkpoint, and replay are first-class concepts
- the system is being designed for multiple frontends

These are strong foundations.

## Recommended Next Protocol Additions

Recommended priority order:

1. richer tool call and tool result metadata
2. split tool failure visibility
3. client capabilities and turn context hints
4. citations and status updates
5. reliability envelope
6. subagent lifecycle protocol

## What Should Still Be Deferred

Do not rush all Cursor fields into Comet immediately.

Keep deferred:

- every provider-specific mode flag
- speculative routing fields
- every debug-only payload
- every background-composer-specific detail
- every shadow workspace detail

Comet should copy the category, not the accidental complexity.

## Practical Conclusion

Comet's current protocol is not field-complete relative to Cursor.

It is:

- complete enough to start building
- not complete enough to claim Cursor parity

The correct strategy is:

- preserve Comet's cleaner abstraction
- selectively add the Cursor-learned field categories that materially improve product behavior
- version those additions deliberately
