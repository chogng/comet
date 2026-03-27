# Comet Approval And Sandbox

## Goal

This document defines how Comet decides whether a tool call may execute.

Approval and sandbox are separate concerns:

- sandbox defines what execution is technically allowed to do
- approval defines whether the user must confirm before it happens

Both must be enforced by Rust runtime, not by the frontend.

## Design Principles

1. Approval is about user consent.
2. Sandbox is about capability restriction.
3. A tool must satisfy both.
4. High-risk actions must be explicit in the event log.
5. Frontends may display policy, but they do not enforce policy.

## Sandbox Modes

Recommended initial modes:

- `read-only`
- `workspace-write`
- `danger-full-access`

## `read-only`

Allowed:

- list files
- read files
- search files
- inspect symbols
- run commands that do not require writes, subject to process sandbox limits

Disallowed:

- edit files
- apply patches
- delete files
- write outside temp areas

Use cases:

- explanation
- exploration
- audit
- dry-run debugging

## `workspace-write`

Allowed:

- read operations
- writes inside the workspace root
- optional writes inside explicitly allowed extra roots
- controlled command execution

Disallowed:

- writes outside allowed roots
- unrestricted host access

Use cases:

- normal coding workflow
- patch application
- local test runs

## `danger-full-access`

Allowed:

- full local writes
- unrestricted command execution
- optional network access if separately enabled

Disallowed:

- nothing by sandbox itself

Use cases:

- explicitly trusted environments
- advanced local automation

This mode should be visually and structurally distinct in the UI.

## Approval Modes

Recommended initial modes:

- `always`
- `on-request`
- `never`

## `always`

Every privileged action requires explicit user confirmation.

Best for:

- cautious users
- unknown repositories
- early product versions

## `on-request`

Low-risk actions execute automatically if allowed by sandbox.
Higher-risk actions require approval.

This should be the default mode for most users.

## `never`

No user confirmation is required.

This mode should only be available when:

- environment is trusted
- users understand the risks
- UI communicates the implications clearly

## Risk Categories

Recommended categories:

- `low`
- `medium`
- `high`

## Risk Classification Guidance

### Low

Examples:

- `list_dir`
- `read_file`
- `grep`
- `search_symbol`

Typical handling:

- no approval in `on-request`

### Medium

Examples:

- `edit_file`
- `apply_patch`
- `write_stdin`

Typical handling:

- approval required in `always`
- usually approval required in `on-request`

### High

Examples:

- `exec_command`
- destructive git commands
- networked external commands
- writes outside workspace

Typical handling:

- approval required in `always`
- approval required in `on-request`
- possibly blocked entirely in restrictive sandbox modes

## Policy Matrix

Recommended initial matrix:

| tool | risk | read-only | workspace-write | danger-full-access |
| --- | --- | --- | --- | --- |
| `list_dir` | low | allow | allow | allow |
| `read_file` | low | allow | allow | allow |
| `grep` | low | allow | allow | allow |
| `search_symbol` | low | allow | allow | allow |
| `edit_file` | medium | deny | allow | allow |
| `apply_patch` | medium | deny | allow | allow |
| `exec_command` | high | conditional | conditional | allow |
| `write_stdin` | medium | conditional | conditional | allow |

`conditional` means:

- allowed only if it targets a runtime-owned process or a command permitted by the active execution policy

## Approval Matrix

Recommended initial matrix:

| tool | always | on-request | never |
| --- | --- | --- | --- |
| `list_dir` | no | no | no |
| `read_file` | no | no | no |
| `grep` | no | no | no |
| `search_symbol` | no | no | no |
| `edit_file` | yes | yes | no |
| `apply_patch` | yes | yes | no |
| `exec_command` | yes | yes | no |
| `write_stdin` | yes | yes | no |

This matrix may later support per-tool overrides.

## Evaluation Flow

The runtime should evaluate a tool call in this order:

1. validate tool input
2. classify tool risk
3. evaluate sandbox capability
4. evaluate approval policy
5. emit approval request if needed
6. execute only after all checks pass

Suggested flow:

```text
tool requested
-> validate input
-> classify risk
-> sandbox check
-> if denied: fail fast
-> approval check
-> if approval needed: emit ApprovalRequested
-> if approved: execute
```

## Approval Request Contents

An approval request should include:

- `callId`
- tool name
- structured input summary
- risk level
- reason for approval requirement
- active sandbox mode

The UI should not need to reconstruct this from raw tool input.

For reconnect and cold-start reads, the same approval payload should also appear in `ThreadReadModel.pendingToolApproval` when one is still outstanding.

Recommended approval card structure:

- `title`: short action label
- `primaryText`: the main command/path/query preview
- `secondaryText`: short supporting context such as cwd or edit count
- `fields[]`: structured detail rows
- `dangerHints[]`: explicit risk warnings

Recommended client behavior:

- keep the card compact by default for low-risk actions
- auto-expand the card when `dangerHints[]` is non-empty
- preserve runtime field order instead of sorting rows alphabetically
- never regenerate warnings from raw args if `dangerHints[]` is empty
- show approval reason separately from `primaryText` and `secondaryText`

Recommended built-in summary templates in runtime:

- `shell` / `exec_command`: command, cwd, timeout
- `grep`: query, path, glob
- `search_symbol`: query, kind
- `edit_file`: path, edit count
- `apply_patch`: first touched file, file count
- `write_stdin`: process id, text preview

Tool implementations may still override these templates with richer summaries.

## Path Rules

All write tools must validate path scope.

Recommended rules:

- writes inside workspace are allowed in `workspace-write`
- writes outside workspace are denied unless explicitly whitelisted
- symlink resolution must be considered when enforcing boundaries

## Command Execution Rules

`exec_command` needs extra policy beyond general sandbox mode.

Recommended first rules:

- command must run under runtime-owned process supervision
- cwd must be inside allowed roots
- timeout must be bounded
- network capability must be explicit, not implicit
- destructive command patterns may be denied by policy even in permissive modes

Examples of commands that should receive special scrutiny:

- `rm -rf`
- `git reset --hard`
- `git clean -fd`
- `curl ... | sh`

## Patch Approval vs Tool Approval

Tool approval and patch approval are distinct.

Examples:

- a provider proposes a patch without immediate mutation
- runtime requests approval for patch application
- patch is approved or rejected separately

Why this matters:

- some tools are safe to compute but not safe to apply automatically
- UI needs a clear review step

## Audit Requirements

The event log should record:

- sandbox mode at session start
- approval mode at session start
- every approval request
- every approval decision
- every denied tool call
- every patch application under approval

## First MVP Recommendations

Recommended defaults:

- sandbox mode: `workspace-write`
- approval mode: `on-request`

Recommended MVP enforcement:

- block mutation tools in `read-only`
- require approval for `edit_file`, `apply_patch`, `exec_command`, `write_stdin`
- allow read/search tools without approval

## Future Extensions

These can be added later:

- per-tool approval overrides
- per-directory write grants
- network permission modes
- command allowlists and denylists
- reviewer roles for team workflows

## Core Invariant

No privileged action may execute solely because a frontend said it was approved.

The runtime must validate that:

- the approval corresponds to an outstanding request
- the request belongs to the same session
- the request has not expired or already been consumed
