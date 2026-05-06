---
name: code-review-context
description: Review context and payload hygiene
---

Keep model context bounded and relevant.

1. Avoid rewriting history in the review context.
2. Keep injected items small and deterministic.
3. Watch for large new payloads, especially rendered document fragments, PDFs, images, or selection snapshots.
4. Flag new large context items as high risk when they can affect latency or memory.

