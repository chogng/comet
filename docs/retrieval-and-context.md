# Comet Retrieval And Context

## Goal

This document defines how Comet gathers, selects, and packages context for a turn.

The purpose is to avoid two common failure modes:

- stuffing the model with too much irrelevant context
- repeatedly rediscovering the same information across a multi-step task

Retrieval in Comet is part of orchestration state, not an isolated helper.

## Design Principles

1. Retrieval should be stateful across a turn.
2. Context should be selected for the current step, not for the entire session in one shot.
3. Retrieval should combine cheap signals and rich signals.
4. Context should be deduplicated before prompt packing.
5. The runtime should make retrieval decisions inspectable.

## Core State

The orchestrator should maintain at least:

- `goal`
- `working_set`
- `signals`
- `seen_context_ids`
- `last_tool_results`
- `budget`

## `goal`

The current task objective derived from the user's request and any updated runtime understanding.

Examples:

- fix a failing test
- add a new API field
- explain a subsystem

## `working_set`

The current set of files, modules, symbols, or directories most likely relevant to the step.

Sources:

- current user file
- files already read
- files recently changed
- files named in errors
- symbols found by search

## `signals`

Signals are structured clues collected during the turn.

Examples:

- compiler errors
- test failures
- stack traces
- changed file paths
- provider plan updates

Signals should influence retrieval strategy.

## `seen_context_ids`

Identifiers for already-used context chunks.

Purpose:

- prevent repeated packing of the same content
- preserve budget for new information

## `last_tool_results`

The recent outputs from tools such as:

- file reads
- grep results
- symbol search
- test output

These outputs often matter more than old chat text.

## `budget`

A structured token or size budget for prompt composition.

The runtime should explicitly divide available space rather than appending context until the request is too large.

## Retrieval Sources

Comet should combine multiple retrieval sources.

Recommended order of adoption:

1. local diff and current file
2. lexical search
3. symbol search
4. file reads
5. semantic retrieval

## Source 1: Local Context

Always consider:

- active file
- files changed in the current turn
- files recently read by the agent

This is usually the highest-signal source for coding tasks.

## Source 2: Lexical Search

Lexical search is cheap and should often be the first broad retrieval tool.

Best for:

- exact error text
- identifiers
- config keys
- log fragments

Typical implementation:

- `grep`

## Source 3: Symbol Search

Symbol search helps when semantics matter more than text matching.

Best for:

- locating definitions
- finding type owners
- finding interfaces and method declarations

Typical implementation:

- `search_symbol`

## Source 4: Direct File Reads

Reading files is not retrieval in the ranking sense, but it is part of context acquisition.

Read files only when:

- search results point to them
- they are already in the working set
- the current step clearly needs them

Avoid:

- reading entire large files by default
- reading many files before narrowing scope

## Source 5: Semantic Retrieval

Semantic retrieval should be added after the MVP loop is stable.

Best for:

- natural language tasks
- cross-file conceptual relationships
- code areas where exact symbol names are unknown

Semantic retrieval should remain bounded and should not replace lexical or symbol search.

## Retrieval Triggers

The runtime should not retrieve blindly on every loop.

Recommended strong triggers:

- new user request
- new error signal
- new failing verification result
- working set expansion after a patch or command

Recommended weak triggers:

- repeated low-confidence reasoning
- no progress across multiple steps
- working set too narrow for the observed problem

## Retrieval Strategy By Task Type

## Bug Fixing

Priority:

1. error text
2. stack trace files
3. failing test files
4. symbol owners
5. related implementation files

## Feature Work

Priority:

1. current file or target module
2. interface owners
3. existing neighboring implementations
4. tests that define expected behavior

## Explanation Or Audit

Priority:

1. key module entrypoints
2. interface definitions
3. important call sites
4. nearby documentation or comments

## Retrieval Loop

Recommended retrieval loop:

```text
receive step goal
-> inspect working set
-> decide if retrieval is needed
-> run lexical or symbol search
-> select candidate files or chunks
-> read bounded file regions as needed
-> dedupe against seen context
-> pack into context budget
```

## Context Packing

Prompt composition should use fixed categories with explicit budget shares.

Recommended categories:

- system and product rules
- turn goal
- local changes
- working set excerpts
- retrieved context
- recent tool results
- open plan state

## Suggested Budget Split

Initial heuristic:

- rules: 10-15%
- goal and turn state: 5-10%
- local diffs and current file: 20-30%
- retrieved context: 30-45%
- tool results and diagnostics: 15-25%

The exact percentages can vary by task type.

## Packing Order

Recommended order:

1. system and policy rules
2. user goal
3. active turn summary
4. current file or local diff
5. critical tool outputs
6. highest-ranked retrieved snippets
7. pending questions or plan state

When budget is tight, lower-ranked retrieved snippets should be dropped first.

## Chunking Guidance

Context should be chunked before packing.

Recommended chunk types:

- file region
- symbol block
- diagnostic block
- diff hunk
- command output summary

Each chunk should have:

- stable id
- source type
- path if relevant
- line range if relevant
- summary metadata

## Dedupe Rules

Before packing, the runtime should:

- remove exact duplicate chunks
- remove heavily overlapping file regions
- prefer fresher reads over older reads
- avoid repeating content already represented in diffs or tool outputs

## Working Set Update Rules

The working set should evolve after major steps.

Add files when:

- a search result looks relevant
- a diagnostic points to a file
- a patch changes a file
- a symbol resolution lands in a file

Remove or de-prioritize files when:

- they were explored and found irrelevant
- the task narrowed to a smaller subsystem
- verification suggests a different failure surface

## Verification Feedback

Verification results should feed back into retrieval.

Examples:

- test failures add failing paths and names to signals
- compile errors add files and symbols to working set
- lint output updates retrieval queries

This is one of the core differences between a coding runtime and a normal chat loop.

## Observability

Comet should log retrieval decisions.

Useful logged records:

- trigger reason
- search queries
- candidate count
- selected chunk ids
- skipped duplicate ids
- final packed chunk ids

This makes tuning and debugging practical.

## First MVP Recommendation

Do not build semantic retrieval first.

Build this order:

1. working set tracking
2. lexical search
3. symbol search
4. bounded file reads
5. prompt packing
6. retrieval logging

Only then add:

- indexing
- semantic retrieval
- learned ranking

## Core Invariant

Context should be assembled from explicit runtime state and tool results, not inferred only from chat history.
