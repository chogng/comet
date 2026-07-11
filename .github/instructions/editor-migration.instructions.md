---
description: One-time rules for migrating the current Editor implementation to the target Editor architecture.
applyTo: "{src/cs/workbench/common/editor/**,src/cs/workbench/browser/parts/editor/**,src/cs/workbench/services/editor/**,src/cs/workbench/contrib/draftEditor/**,src/cs/workbench/contrib/pdfEditor/**,src/cs/workbench/contrib/browserView/**}"
---

# Editor migration

Read `src/cs/workbench/browser/parts/editor/MIGRATION.md` and
`.github/instructions/editor.instructions.md` before changing Editor contracts,
groups, pane resolution, or typed editor contributions.

Migrate implementations and affected call sites directly to the target
contracts. Do not add wrappers, facades, adapters, aliases, re-exports,
compatibility layers, or fallback behavior to preserve the current parallel
interfaces.

Delete superseded implementations in the same change that migrates their call
sites. Delete this instruction and the migration document when every completion
criterion in `MIGRATION.md` is satisfied.
