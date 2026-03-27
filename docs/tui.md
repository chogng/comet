# Comet TUI

## Goal

This document defines the product and implementation contract for `comet-rs/tui`.

It exists to answer a practical question:

What should the Rust terminal client do now, given the current protocol and runtime shape?

## Current Constraint

The current runtime path is synchronous:

- `tui` boots `app-server` in process
- `app-server` calls `core`
- `core` runs provider/tool work synchronously
- `handle_command(...)` returns a completed `Vec<EventEnvelope>`

That means the current TUI should not pretend it has:

- live incremental subscriptions
- concurrent panes updating from an async event bus
- partial provider streaming while the input loop stays interactive

Those can come later, but they are not the right first target for the current codebase.

## Product Direction

The first real TUI should therefore be:

- a stateful terminal client
- conversation-first
- render-rich even in a line-oriented shell
- slash-command driven for runtime control
- ready to swap its transport later without rewriting render logic

This is deliberately different from a full-screen terminal multiplexer.

The real requirement is not alternate-screen chrome.
The requirement is a frontend boundary that can:

- restore thread history
- render protocol events coherently
- accept user turns and control commands
- expose approvals, patches, checkpoints, and session state
- teach users how to use advanced input affordances

## MVP Responsibilities

`comet-rs/tui` should own:

- bootstrapping a local session
- loading thread history from the thread log
- reducing events into a frontend state model
- rendering user/assistant/tool/approval/patch/status items
- slash command parsing and execution
- contextual hints
- onboarding copy for advanced terminal usage

It should not own:

- orchestration logic
- provider policy
- tool execution logic
- protocol reinterpretation that belongs in `core`

## UI Model

The TUI should maintain a frontend state with these categories:

- session metadata
- timeline items
- pending approval card
- pending patch card
- current plan
- checkpoints
- local UI preferences

Recommended timeline item categories:

- user message
- assistant message
- assistant thinking
- status update
- tool proposed
- tool output
- tool result
- approval request
- patch proposal
- checkpoint
- verification result
- citation
- context update
- subagent update
- session lifecycle event

This derived view state should be independent from terminal rendering details.

## Theme Contract

The first TUI does not need theme plugins, but it should have stable theme names and semantic colors.

Recommended built-in themes:

- `comet`
- `mono`
- `sunset`

Themes should color semantic roles, not raw widget ids:

- chrome
- user text
- assistant text
- muted metadata
- success
- warning
- danger
- code
- diff add
- diff remove
- diff hunk

This allows a later full-screen renderer to reuse the same theme semantics.

## Rendering Contract

The render layer should produce a readable transcript-oriented terminal output.

It should support:

- markdown-ish assistant rendering
- diff rendering
- compact or verbose tool cards
- approval cards with danger hints
- patch cards with file summaries
- footer hint blocks

Recommended rendering rules:

- treat the timeline as the primary surface
- render session chrome before the timeline
- render pending approvals and pending patches after the latest timeline item
- render hints last

## Markdown Rendering

Assistant and user messages should be rendered with a lightweight markdown renderer.

Required first-pass support:

- ATX headings
- unordered and ordered lists
- fenced code blocks
- block quotes
- inline code spans
- thematic breaks

Tables, HTML, and nested markdown edge cases can stay plain text for now.

The markdown renderer should prefer stable, readable terminal output over exact CommonMark fidelity.

## Diff Rendering

The TUI should have a dedicated diff renderer for:

- patch proposals
- fenced ```diff blocks inside assistant messages
- tool outputs that are clearly unified diffs

Required first-pass behavior:

- detect file headers
- color additions and deletions
- color hunk headers
- preserve line prefixes exactly
- allow compact previews when the diff is long

Patch proposal cards should also render file status badges:

- added
- modified
- deleted

## Slash Command Contract

The TUI should reserve `/` commands for client-side control and runtime commands.

Required commands:

- `/help`
- `/status`
- `/mode <chat|agent|background|spec>`
- `/theme <name>`
- `/thinking <on|off|toggle>`
- `/hints <on|off|toggle>`
- `/approvals`
- `/approve`
- `/reject [reason]`
- `/patch`
- `/patch apply`
- `/patch apply-and-continue`
- `/patch reject [reason]`
- `/diff`
- `/checkpoints`
- `/resume`
- `/interrupt`
- `/onboarding`
- `/quit`

Recommended local affordance:

- `/exec <command>`

`/exec` is a TUI-local input transform, not a protocol-level command.
It should expand into a normal user turn that asks the agent to execute a shell command and explain the result.

## Exec Cell Onboarding

The runtime does not yet expose a first-class `exec_cell` protocol item.
The TUI should still provide an onboarding path because command execution is a central terminal use case.

The first version should treat `exec_cell` as a local composer affordance:

- `/exec <command>` submits a turn template for shell execution
- a single-line input that starts with `!` should behave like `/exec`

Example expansion:

```text
Run this shell command in the current workspace.
Explain the result briefly and stop for approval if needed.

```sh
git status
```
```

The onboarding surface should teach:

- normal turns
- slash commands
- exec cells via `/exec` or `!cmd`
- approval and patch review flows

Onboarding should appear:

- on an empty thread
- after startup when configured to `always`
- on demand with `/onboarding`

## Hint System

Hints are contextual suggestions shown in a footer block.

Hints should be derived from UI state, not hard-coded to a single startup moment.

Required hint triggers:

- empty thread: show example normal turn, slash command, and exec cell
- pending approval: show `/approve` and `/reject`
- pending patch: show `/patch apply`, `/patch reject`, and `/diff`
- hidden thinking: suggest `/thinking on`
- interrupted session: suggest `/resume`

Hints should be suppressible with config or `/hints off`.

## Configuration

The TUI should read frontend-only preferences from `[tui]`.

Recommended fields:

- `default_mode`
- `show_thinking`
- `show_hints`
- `theme`
- `tool_rendering`
- `onboarding`

Suggested values:

- `tool_rendering = "compact" | "verbose"`
- `onboarding = "auto" | "always" | "never"`

These values should affect rendering only.
They must not change runtime semantics.

## State Restoration

On startup, the TUI should:

1. start or attach the thread
2. load the current thread read model
3. load the thread log
4. rebuild the frontend timeline from prior events
5. render the restored session before accepting input

The thread log is the current authoritative source for transcript restoration.

## Non-Goals For This Phase

This phase should not attempt:

- terminal raw-mode editing
- async streaming subscriptions
- mouse support
- split panes
- provider-specific widgets
- inline file previews

Those are valid later, but they should come after the current frontend contract is solid.

## Implementation Shape

Recommended internal modules:

```text
comet-rs/tui/src/
  main.rs
  app.rs
  config.rs
  state.rs
  slash.rs
  render.rs
  markdown.rs
  diff.rs
  hint.rs
  onboarding.rs
  theme.rs
```

The key rule is:

input parsing, state reduction, and rendering should stay separate so the transport can change later without rewriting the whole client.
