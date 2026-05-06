---
name: code-review-breaking-changes
description: Breaking change checks
---

Search for breaking changes in external integration surfaces:

- app startup and Electron main process behavior
- renderer-to-main IPC contracts
- persisted configuration and history data
- document schema and selection state
- GitHub workflow or release behavior

Do not stop after finding one issue; inspect all plausible break points.

