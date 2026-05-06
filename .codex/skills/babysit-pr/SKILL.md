---
name: babysit-pr
description: Watch PR review comments, CI, and merge conflicts
---

Monitor the current pull request until it is merged, closed, or blocked on user help.

- Surface new review feedback before acting on CI or mergeability work.
- Fix valid branch-related issues, push updates, and retry flaky failures only when they are plausibly branch-related.
- Do not post replies to human-authored review comments unless the user explicitly confirms the exact response.
- Keep a single watcher active and continue polling while the PR remains open.

