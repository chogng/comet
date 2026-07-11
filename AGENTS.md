- Must read the [Coding Guidelines](.github/instructions/coding-guidelines.instructions.md) and [instructions](.github/instructions) before thinking or editing
- NEVER add fallback logic
- NEVER replace a real fix with renamed declarations, moved logic, wrappers, facades, adapters, aliases, re-exports, or compatibility layers.
- NEVER keep legacy interfaces or local compatibility code just to avoid updating call sites
- Call sites MUST migrate directly to the target interface.
- When the target interface requires call-site changes, migrate the affected call sites directly instead of adding wrappers, aliases, or compatibility code to shrink the diff
- Compare the upstream architecture [`..\vscode` or `../vscode`].
- Permanent project documentation MUST describe Comet's durable target state in
  project-owned terms. Do not put migration status, implementation history,
  temporary structure, or upstream comparisons in README, architecture, layout,
  layering, or normal instruction documents.
- Put temporary migration information only in an explicitly scoped
  `MIGRATION.md` and matching migration instructions. Migration documents must
  define completion and deletion conditions and must be deleted when complete.
