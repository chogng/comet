# Comet Tool Catalog

## Goal

This document defines the first-class tools that Comet runtime may execute.

It exists to make tool behavior explicit before implementation.

Every tool should have:

- a stable name
- a clear purpose
- a structured input shape
- a structured output shape
- a risk level
- an approval requirement
- sandbox expectations

## Design Rules

1. Tool names are product-level names, not provider-specific names.
2. Tools should return structured data whenever possible.
3. Tools should not expose raw subprocess behavior unless necessary.
4. Approval and sandbox requirements must be documented per tool.
5. A tool may stream progress, but its final result must still be structured.

## MVP Tool Set

The first implementation should focus on the minimum set required for a useful coding agent.

MVP tools:

- `list_dir`
- `read_file`
- `grep`
- `search_symbol`
- `edit_file`
- `apply_patch`
- `exec_command`
- `write_stdin`

## Tool Summary Matrix

| tool | category | risk | approval default | writes workspace | streaming |
| --- | --- | --- | --- | --- | --- |
| `list_dir` | filesystem | low | no | no | no |
| `read_file` | filesystem | low | no | no | no |
| `grep` | search | low | no | no | no |
| `search_symbol` | search | low | no | no | no |
| `edit_file` | patch | medium | yes | yes | no |
| `apply_patch` | patch | medium | yes | yes | no |
| `exec_command` | execution | high | yes | maybe | yes |
| `write_stdin` | execution | medium | yes | no | yes |

## Tool Definitions

## `list_dir`

Purpose:

- inspect directory contents
- discover project layout

Suggested input:

```json
{
  "path": ".",
  "recursive": false,
  "maxDepth": 2,
  "includeHidden": false
}
```

Suggested output:

```json
{
  "entries": [
    {
      "path": "src",
      "kind": "directory"
    },
    {
      "path": "Cargo.toml",
      "kind": "file"
    }
  ]
}
```

Risk:

- low

Default approval:

- not required

Notes:

- must respect sandbox read scope
- should support bounded recursion only

## `read_file`

Purpose:

- read file contents or a bounded range

Suggested input:

```json
{
  "path": "src/lib.rs",
  "startLine": 1,
  "endLine": 200
}
```

Suggested output:

```json
{
  "path": "src/lib.rs",
  "contents": "file text",
  "startLine": 1,
  "endLine": 200,
  "truncated": false
}
```

Risk:

- low

Default approval:

- not required

Notes:

- should reject paths outside readable scope
- should support partial reads to reduce context size

## `grep`

Purpose:

- perform lexical search over the workspace

Suggested input:

```json
{
  "query": "AuthError",
  "path": ".",
  "glob": "*.rs",
  "caseSensitive": true,
  "maxResults": 200
}
```

Suggested output:

```json
{
  "matches": [
    {
      "path": "core/src/auth.rs",
      "line": 18,
      "column": 9,
      "preview": "pub enum AuthError {"
    }
  ]
}
```

Risk:

- low

Default approval:

- not required

Notes:

- should return structured match records
- should be bounded for runtime cost

## `search_symbol`

Purpose:

- locate definitions, references, and symbol metadata

Suggested input:

```json
{
  "query": "AuthManager",
  "kind": "definition",
  "maxResults": 50
}
```

Suggested output:

```json
{
  "results": [
    {
      "name": "AuthManager",
      "path": "core/src/auth.rs",
      "line": 42,
      "kind": "struct"
    }
  ]
}
```

Risk:

- low

Default approval:

- not required

Notes:

- initial implementation may be backed by language-aware indexing or simpler adapters

## `edit_file`

Purpose:

- apply a targeted edit operation to a file

Suggested input:

```json
{
  "path": "src/lib.rs",
  "edits": [
    {
      "kind": "replaceRange",
      "startLine": 10,
      "endLine": 14,
      "newText": "updated text"
    }
  ]
}
```

Suggested output:

```json
{
  "path": "src/lib.rs",
  "applied": true,
  "beforeHash": "abc",
  "afterHash": "def",
  "changedLines": 5
}
```

Risk:

- medium

Default approval:

- required

Notes:

- must checkpoint before mutation
- should fail if the file changed unexpectedly since read, unless explicit force mode is later added

## `apply_patch`

Purpose:

- apply a unified diff style patch or a structured patch object

Suggested input:

```json
{
  "patch": "*** Begin Patch\n*** Update File: src/lib.rs\n..."
}
```

Suggested output:

```json
{
  "applied": true,
  "files": [
    {
      "path": "src/lib.rs",
      "status": "modified"
    }
  ]
}
```

Risk:

- medium

Default approval:

- required

Notes:

- must checkpoint before mutation
- should provide per-file status
- should reject malformed or out-of-scope patches

## `exec_command`

Purpose:

- run a shell command in the workspace or allowed directory

Suggested input:

```json
{
  "command": "cargo test -p runtime",
  "cwd": ".",
  "timeoutMs": 120000
}
```

Suggested output:

```json
{
  "exitCode": 0,
  "stdout": "test output",
  "stderr": "",
  "timedOut": false
}
```

Risk:

- high

Default approval:

- required

Notes:

- must honor sandbox mode
- should stream stdout and stderr
- should expose process identity for follow-up stdin writes when interactive

## `write_stdin`

Purpose:

- write to a running command's stdin

Suggested input:

```json
{
  "processId": "proc_12",
  "text": "y\n"
}
```

Suggested output:

```json
{
  "accepted": true
}
```

Risk:

- medium

Default approval:

- required

Notes:

- only valid for active interactive exec sessions
- should be tied to a tracked runtime-owned process id

## Phase 2 Tools

Once the MVP loop is stable, add:

- `git_diff`
- `git_status`
- `semantic_search`
- `list_mcp_resources`
- `read_mcp_resource`
- `call_mcp_tool`
- `web_search`
- `run_verification`
- `create_checkpoint`
- `rollback_checkpoint`

## JSON Schema Guidance

Each tool should eventually expose machine-readable schemas.

Required for every tool:

- input schema
- output schema
- stable tool name
- stable risk metadata

This makes provider adapters and frontend debugging easier.

## Runtime Expectations

The runtime should treat tools in three classes:

### Read tools

- `list_dir`
- `read_file`
- `grep`
- `search_symbol`

These are typically low-risk and do not mutate state.

### Mutation tools

- `edit_file`
- `apply_patch`

These must create checkpoints before mutation.

### Execution tools

- `exec_command`
- `write_stdin`

These require the strongest safety controls.

## First Implementation Notes

The first implementation should prefer clarity over maximal generality.

Recommended approach:

- implement each tool as its own type
- register tools through a central registry
- keep the runtime-facing contract stable
- avoid embedding provider-specific tool names in the registry
