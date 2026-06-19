# PDF Edge-like Rendering Plan

This document tracks the PDF reader work needed to approach Edge/Chromium-style
interaction and rendering behavior. The goal is not to copy Chromium internals
line for line, but to preserve the same user-facing priorities:

1. Input stays responsive.
2. The viewport becomes readable first.
3. High quality rendering catches up progressively.
4. Old render work is cheap to cancel.
5. Memory is bounded by visible work and recent reuse.

## Current Pipeline

- PDFium WASM renders pages on the UI thread.
- Page text and layout are managed in TypeScript for selection and annotation.
- Rendering now has an interactive pass, a viewport tile pass, and a quality pass.
- PDFium progressive rendering is used when the WASM wrapper exposes it, with a
  synchronous fallback for incompatible builds.
- A module-worker bootstrap now verifies the browser can load PDFium in a
  dedicated worker before worker rendering is enabled.
- Viewport tile rendering now uses a dedicated PDFium worker when available,
  transferring the pixel buffer back to the UI thread and falling back to
  main-thread rendering on worker failure. Full-page bitmap rendering also uses
  the worker once the worker document is ready, while preserving immediate
  main-thread fallback during worker warmup.
- Selection pauses PDF rendering so pointer movement wins over bitmap work.

## Checklist

### Selection Correctness

- [x] Double-click word selection uses visual layout character order.
- [x] Annotation reanchor resolves repeated quotes with saved geometry and offsets.
- [x] Selection drag pauses PDF bitmap rendering.
- [x] Selection-only updates refresh only the changed selection pages.
- [x] Selection keeps using retained text layout after bitmap eviction.

### Viewport-first Rendering

- [x] Render zoom completion for viewport pages before preloading.
- [x] Use a lower-cost interactive render before high-quality catch-up.
- [x] Render high-quality viewport tiles above the interactive page canvas.
- [x] Cache viewport tiles per page and reuse them while scrolling.
- [x] Drop viewport tiles that leave the current overscanned viewport.
- [x] Render missing tiles in viewport-center priority order.

### Scheduler and Input Priority

- [x] Split tile catch-up across frames.
- [x] Use `navigator.scheduling.isInputPending` when available.
- [x] Enforce a render time slice so long visible-page work yields predictably.
- [x] Track render budget diagnostics for tile and page render tasks.
- [x] Avoid launching quality catch-up while continuous input is active.

### Progressive Rendering

- [x] Evaluate PDFium progressive render APIs:
  `FPDF_RenderPageBitmap_Start`, `FPDF_RenderPage_Continue`,
  and `FPDF_RenderPage_Close`.
- [x] Add a progressive renderer for tile rendering if PDFium cancellation works
  cleanly with the current WASM wrapper.
- [x] Fall back to synchronous tile render when progressive rendering is
  unavailable or unstable.

### Worker / Off-main-thread Path

- [x] Decide whether PDFium can be loaded safely in a dedicated worker.
- [x] Prototype worker tile rendering with transferable pixel buffers.
- [x] Move viewport tile bitmap rendering off the UI thread if the worker
  prototype is stable.
- [x] Move full-page bitmap rendering off the UI thread after the tile path is
  stable.
- [ ] Keep text layout and selection data on the UI thread unless profiling shows
  a clear need to move them.

### Cache and Memory

- [x] Add a bounded tile LRU across pages.
- [x] Track approximate tile memory cost.
- [x] Prefer keeping current viewport tiles over distant full-page canvases.
- [x] Evict stale zoom-scale tile sets immediately.

## Working Rules

- Interaction wins over rendering. Pointer, wheel, and keyboard input should be
  allowed to interrupt or delay PDF bitmap work.
- The first visible result can be lower quality. It must be stable, correctly
  anchored, and quickly replaced with high quality.
- Each optimization should have a regression test for the scheduling or layout
  behavior it changes.
- Avoid large rewrites until the current pipeline has measurable bottlenecks.
