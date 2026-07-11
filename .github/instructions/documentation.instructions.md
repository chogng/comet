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

## Migration documents are temporary

When a durable target differs from the current repository, keep the target
architecture in the durable documents and put the transition in a dedicated
`MIGRATION.md`.

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

If migration rules must be loaded automatically, create a separately named
`*-migration.instructions.md` with the narrowest applicable path scope. It must
point to the migration document, contain no permanent architecture, and be
deleted with the migration document.

## Instruction documents

Normal `.instructions.md` files contain durable rules only. Their `applyTo`
scope must cover the final project locations and must not include old paths only
to carry a migration.

Migration instructions own transitional paths and one-time constraints. Do not
duplicate migration guidance in the normal instructions.

## Documentation ownership

Keep one authoritative document for each subject. Link to that owner instead of
copying its rules into multiple files. Split domain architecture, visual layout,
dependency rules, and migration when they have different lifecycles.

Before completing a documentation change, verify that:

1. durable documents still make sense after all current migrations are deleted;
2. project architecture is understandable without access to an upstream tree;
3. temporary facts exist only in explicitly temporary documents;
4. every path and symbol uses its final project name;
5. links resolve and migration documents have deletion criteria.
