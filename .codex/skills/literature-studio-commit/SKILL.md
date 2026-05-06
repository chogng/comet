---
name: literature-studio-commit
description: Commit message and commit hygiene guidance for Literature Studio changes.
---

# Literature Studio Commit

## Commit Hygiene

1. Inspect the worktree

- Run `git status --short`.
- Review the relevant diff before staging.
- Assume unrelated modified files may belong to the user or another agent.
- Never revert unrelated changes.

2. Choose commit scope

Prefer focused commits:

- engineering configuration, CI, and `.codex` changes
- Electron main process changes
- renderer/workbench changes
- editor/PDF changes
- tests and fixtures
- documentation

If the diff mixes unrelated concerns, split commits by behavior and ownership boundary.

3. Stage deliberately

Use explicit paths. Avoid broad staging commands unless the user explicitly asks for a whole-worktree commit.

Good examples:

```shell
git add .codex .github
git add src/ls/editor/browser/pdf src/ls/editor/common
git add docs/pdf-selection-rag-extraction-roadmap.md
```

Avoid:

```shell
git add .
```

4. Verify before committing

Run the narrowest useful checks for the staged change:

- `.codex` / `.github` only: inspect files and run no build unless workflow commands changed.
- TypeScript/editor changes: `npm run typecheck:tests`, plus the relevant test runner.
- PDF reader or selection changes: `npm run test:pdf-selection`.
- Electron main changes: `npm run test:electron-main`.
- Release workflow changes: inspect `.github/workflows/release.yml` and confirm referenced package scripts exist.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Commit Message

Use a concise imperative subject, usually 50 characters or less:

```text
Add Codex project skills
Tighten PDF selection anchoring
Update release workflow checks
```

Prefer this shape:

- subject: imperative, specific, no trailing period
- body: only when the why, risk, or verification matters
- bullets: useful for multi-part changes or follow-up notes

Good commit messages for this repo:

```text
Add Literature Studio skill templates
Refine PDF selection anchoring
Harden CI workflow checks
```

Avoid:

- vague subjects like `fix stuff`
- long prose in the subject line
- mixing unrelated changes in one commit

5. Report

After committing, report:

- commit hash and subject
- files included at a high level
- verification run
- any relevant files left unstaged
