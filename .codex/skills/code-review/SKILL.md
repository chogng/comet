---
name: code-review
description: Run a final code review on a pull request
---

Use subagents to review the pull request using the other code-review-* skills in this repository. One subagent per skill.

Return every actionable issue you find. Use raw Markdown. Number findings for ease of reference.
Each finding should include a specific file path and line number.

Prefer to focus on regressions, missing tests, and behavior changes in the Electron, renderer, PDF, or document-processing paths.

