---
name: code-review-change-size
description: Change size guidance
---

Unless the change is mechanical, keep the reviewable diff small.

- Complex logic changes should usually stay under 500 changed lines.
- Larger changes should be split into stages with clear dependency boundaries.
- Call out the smallest coherent stage if the diff is too broad.

