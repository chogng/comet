---
description: Project documentation rules for durable architecture documents, instructions, and temporary migration documents.
applyTo: "**/*.md"
---

# Project documentation

## Durable documents are the default

README, architecture, layout, layering, ownership, and normal instruction
documents describe the project's durable target state. Write them in present
tense using Comet-owned concepts, names, paths, contracts, and invariants.

Durable documents explain:

- what each component owns;
- which dependencies and calls are allowed;
- which state is authoritative;
- which behavior must remain true;
- where final code and documentation belong.

Do not put the following in durable documents:

- migration sequences, progress, transitional paths, or deletion steps;
- current-versus-target comparisons;
- implementation history or reasons based only on past code;
- upstream file lists, upstream behavior comparisons, or external architecture
  as a substitute for defining Comet's architecture;
- temporary compatibility arrangements, TODO plans, or task-local notes.

Upstream and external projects may be used as implementation evidence while
working. Translate the resulting decision into Comet's own ownership and
behavior rules before writing a durable project document.

## Effective document structure

Write documentation so a reader can verify the architecture from concrete
project evidence instead of reconstructing it from descriptive prose. Use the
smallest useful subset of the following structure:

1. Start with the architectural outcome and the boundary the document owns.
2. Show an architecture-at-a-glance flow when three or more components or
   process boundaries participate.
3. Name ownership explicitly. Use a compact table when several concerns map to
   different services, layers, processes, or final repository paths.
4. Include representative examples of public contracts, state, requests,
   responses, configuration, or data flow. Examples use real project symbols
   and shapes; label pseudocode when an exact implementation is intentionally
   omitted.
5. Cover invalid and failure behavior where it defines the contract. Do not
   document only the successful path.
6. Use bad/good examples when a prohibited shortcut could otherwise look
   reasonable.
7. End implementation-facing documents with concrete verification evidence or
   a verification matrix when several invariants require different tests.

Examples support the invariant; they do not replace it. Keep the prose that
states who owns the behavior and why the boundary exists, then demonstrate the
rule with one end-to-end example rather than several disconnected fragments.
Do not add a diagram, table, or code block when a short sentence communicates
the relationship more clearly.

For an implementation-facing architecture document, prefer a verifiable block
like this over several paragraphs that only describe intent:

````markdown
## Ownership

| Path | Owns |
|---|---|
| `src/cs/platform/example/common/` | Public contracts |
| `src/cs/platform/example/node/` | Node implementation |

```typescript
interface IExampleRequest {
	readonly operation: ExampleOperationId;
	readonly expectedRevision: number;
}
```

| Invalid input | Required result |
|---|---|
| stale revision | reject without committing state |
| duplicate operation, same digest | return the recorded outcome |
| duplicate operation, different digest | report a conflict |
````

The table identifies final ownership, the code block pins the contract shape,
and the failure matrix makes behavior testable. Replace `example` with real
project paths and symbols; do not leave template names in committed documents.

When location matters, show the exact final project path. A path example such
as `src/cs/platform/example/node/feature/` is useful only when that directory is
the durable owner. Do not use an entry-point, build-output, staging, cache, or
migration path as the apparent owner of runtime behavior.

## Migration documents are temporary

When a durable target differs from the current repository, keep the target
architecture in the durable documents and put the transition in a dedicated
`<subject>.migration.md`.

A migration document must contain:

- the exact temporary scope;
- the current boundary being removed;
- the final project-owned target;
- direct migration steps for implementations and call sites;
- behavior that must be preserved;
- objective completion criteria;
- an explicit requirement to delete the migration document when complete.

Current-state analysis and necessary upstream references are allowed only in
the migration document, only when they directly guide the transition. They must
not leak into the final README, architecture, layout, layering, or normal
instruction documents.

## Instruction documents

Normal `.instructions.md` files contain durable rules only. Their `applyTo`
scope must cover the final project locations and must not include old paths only
to carry a migration.

Do not create a separate migration instruction file. `AGENTS.md` requires
agents to discover applicable `*.migration.md` documents by their declared
scope. Keep all transitional guidance in that single migration document and do
not duplicate it in normal instructions.

## Documentation ownership

Keep one authoritative document for each subject. Link to that owner instead of
copying its rules into multiple files. Split domain architecture, visual layout,
dependency rules, and migration when they have different lifecycles.

Before completing a documentation change, verify that:

1. durable documents still make sense after all current migrations are deleted;
2. project architecture is understandable without access to an upstream tree;
3. temporary facts exist only in explicitly temporary documents;
4. every path and symbol uses its final project name;
5. examples agree with the actual public contracts and do not invent an API,
   default, fallback, or repository location;
6. instruction `applyTo` scopes include every final location governed by the
   instruction, including build inputs and process entry points when relevant;
7. links resolve and migration documents have deletion criteria.
