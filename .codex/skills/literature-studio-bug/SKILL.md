---
name: literature-studio-bug
description: Diagnose Literature Studio bug reports and decide whether to reproduce, request more info, or patch locally.
---

# Literature Studio Bug

## Workflow

1. Confirm the report

- If the user provides a GitHub issue URL, read the issue and comments as the source of truth.
- If no URL is provided, extract the reported behavior, expected behavior, repro steps, environment, logs, and screenshots from the conversation.
- Ask for missing repro details only when the bug cannot be investigated safely from local context.

2. Summarize before investigating

Write a short summary in your own words before changing code:

- reported behavior
- expected behavior
- reproduction path
- affected platform or mode, such as Electron desktop, web preview, PDF reader, ProseMirror editor, release workflow, or settings/data persistence
- evidence already available and evidence missing

3. Investigate with repo context

Prefer targeted searches and existing architecture boundaries:

- Electron main process: `src/ls/code/electron-main`
- renderer/workbench: `src/ls/workbench/browser`
- editor and PDF reader: `src/ls/editor`
- platform services: `src/ls/platform`
- tests and scripts: `src/**/tests`, `scripts`
- release and CI: `.github/workflows`

Use `rg` first, inspect nearby tests, and preserve unrelated user changes.

4. Decide the next action

- **Patch locally** when the report is specific, reproducible enough, and points to code in this workspace.
- **Request more information** when the report lacks repro steps, inputs, logs, or platform details.
- **Explain not a bug** when the behavior matches documented constraints or current intended behavior.

5. Verify

Run the narrowest useful command first, then broaden if risk warrants it:

- `npm run check:i18n`
- `npm run typecheck:tests`
- `npm run test:editor`
- `npm run test:pdf-selection`
- `npm run test:workbench-browser`
- `npm run test:electron-main`
- `npm run build`

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

6. Report

Keep the final response concise:

- what was fixed or concluded
- files changed
- verification run
- any remaining risk or missing information

