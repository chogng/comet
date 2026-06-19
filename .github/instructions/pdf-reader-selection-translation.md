# PDF Reader Selection and Translation Architecture

This document records the intended architecture for Literature Studio's PDF
reader, text selection, highlight anchoring, and layout-preserving translation
experiments.

## Goals

- Own the reader interaction model: page lifecycle, zoom, scroll, text
  selection, highlights, annotations, status, and diagnostics.
- Do not rely on the browser's built-in PDF plugin for selection or annotation
  state, because it does not expose stable character indices or PDF-space
  rectangles to the app.
- Do not build a PDF parser or rendering engine from scratch. Use a PDF engine
  only behind a narrow backend boundary.
- Store anchors in PDF coordinates, not DOM coordinates, so highlights survive
  zoom changes, resize, rerender, and future backend swaps.

## Edge / Chromium Reference Model

Edge and Chromium are useful references because they do not treat PDF text
selection as normal DOM selection.

Chromium's PDF viewer is built around PDFium. The public PDFium mirror describes
PDFium as the PDF library used by Chromium:
https://github.com/chromium/pdfium

The important implementation pattern is:

```text
screen point
  -> page index
  -> PDF page coordinate
  -> PDFium character index / character bounds
  -> selection ranges
  -> selected text and PDF-space rectangles
  -> viewer-drawn selection/highlight overlay
```

Relevant Chromium references:

- `PDFiumEngine::ExtendSelectionByPoint()` converts a point to page/character
  data and extends the selection.
  https://chromium.googlesource.com/chromium/src/+/master/pdf/pdfium/pdfium_engine.cc
- `PDFiumEngine::GetSelectionRectMap()` returns selected rectangles by page in
  PDF coordinates.
  https://chromium.googlesource.com/chromium/src/+/master/pdf/pdfium/pdfium_engine.cc
- `PDFiumRange` represents a character range on one page and exposes both
  PDF-space rectangles and screen-space rectangles.
  https://chromium.googlesource.com/chromium/src/+/HEAD/pdf/pdfium/pdfium_range.h

The lesson for this project: the browser DOM should not be the source of truth
for selection. The source of truth should be a page index plus character ranges
and PDF-space rectangles.

## Proposed Reader Layers

```text
PdfEditorPane
  -> PdfReaderView
  -> PdfDocumentSession
  -> PdfPageView
  -> PdfSelectionController
  -> PdfHighlightLayer
  -> PdfRenderBackend
```

Responsibilities:

- `PdfEditorPane` connects PDF tabs to the editor workbench.
- `PdfReaderView` owns scroll, zoom, page layout, active page, and status.
- `PdfDocumentSession` owns document handles, page metadata, render cache, text
  cache, and coordinate conversion.
- `PdfPageView` owns one page canvas, text hit layer, and highlight layer.
- `PdfSelectionController` owns pointer selection, word/line expansion, and
  cross-page selection ranges.
- `PdfHighlightLayer` draws transient selection and persisted annotations.
- `PdfRenderBackend` is the only layer allowed to talk to PDFium, MuPDF, a
  sidecar service, or any future renderer.

## Backend Boundary

The backend interface should expose only stable reader primitives:

```ts
export type PdfRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PdfPageSize = {
  width: number;
  height: number;
};

export type PdfTextChar = {
  index: number;
  char: string;
  rect: PdfRect;
};

export type PdfTextPage = {
  page: number;
  chars: readonly PdfTextChar[];
  text: string;
};

export type PdfSelectionRange = {
  page: number;
  startCharIndex: number;
  endCharIndex: number;
  text: string;
  rects: readonly PdfRect[];
};

export interface PdfRenderBackend {
  openDocument(data: Uint8Array): Promise<PdfDocumentHandle>;
  closeDocument(document: PdfDocumentHandle): void;
  getPageCount(document: PdfDocumentHandle): number;
  getPageSize(document: PdfDocumentHandle, page: number): PdfPageSize;
  renderPage(params: PdfRenderPageParams): Promise<ImageData>;
  getPageText(document: PdfDocumentHandle, page: number): Promise<PdfTextPage>;
}
```

The app should never persist renderer-specific handles or DOM rectangles.

## Selection Model

Selection state should be represented as character ranges:

```ts
export type PdfReaderSelection = {
  anchor: {
    page: number;
    charIndex: number;
  };
  focus: {
    page: number;
    charIndex: number;
  };
  ranges: readonly PdfSelectionRange[];
};
```

Selection behavior:

- Pointer down finds the nearest selectable character on a page.
- Pointer move converts the current point to a page/character focus.
- The controller normalizes anchor/focus order and materializes per-page ranges.
- Double click expands to word boundaries.
- Triple click can expand to line/paragraph boundaries later.
- Form fields and links should be detected before text selection, mirroring the
  Chromium separation between form handling and text selection.

## Highlight Anchors

Persisted highlights and annotations should store PDF-space anchors:

```ts
export type PdfHighlightAnchor = {
  page: number;
  startCharIndex?: number;
  endCharIndex?: number;
  rects: readonly PdfRect[];
  quote?: string;
};
```

Rendering rule:

- Convert PDF rects to viewport rects at paint time.
- Never store viewport rects as the durable annotation anchor.
- Recompute viewport rects after zoom, resize, rotation, or page relayout.
- Keep the quote as a validation hint, not as the primary geometry.

## Translation And Layout-Preserving Output

The PDF reader should not directly own layout-preserving translation. Treat it
as a separate document-processing pipeline that can consume the same PDF and
produce artifacts for the reader to display.

Recommended pipeline:

```text
source PDF
  -> OCR / Normalize
  -> document.v1.json
  -> Translate
  -> translation-manifest.json + per-page payloads
  -> Render
  -> translated PDF / side-by-side PDF / overlay artifacts
  -> Reader artifact attachment
```

This keeps the interactive reader fast and local while allowing heavy OCR,
translation, layout analysis, and PDF reconstruction to run as background jobs.

## RetainPDF Notes

RetainPDF is relevant as a reference for layout-preserving translation, not as a
drop-in PDF viewer.

Repository:
https://github.com/wxyhgk/retain-pdf

Useful observations:

- It explicitly targets scanned/image PDFs and complex inline formulas, which
  are the exact cases where text-only extraction or naive overlay translation
  breaks down.
- The repository describes a full OCR, translation, layout, and delivery stack
  with Rust API, Python scripts, Docker delivery, and desktop packaging.
- Its README states the project can complete upload, OCR, translation, layout
  reconstruction, and artifact download as one chain.
- Its pipeline documentation separates `OCR / Normalize`, `Translation`, and
  `Rendering` stages. The rendering stage consumes source PDF plus translation
  artifacts and does not own OCR or translation.
- It exposes workflow modes like full `mineru`, OCR-only, translate-only, and
  render-only, which is a good product/API pattern for Literature Studio.
- Its public API docs show upload, job creation, job status/events, and artifact
  download endpoints. That shape maps well to a background task model in our
  workbench.

RetainPDF references:

- README and feature positioning:
  https://github.com/wxyhgk/retain-pdf
- Pipeline stage contract:
  https://github.com/wxyhgk/retain-pdf/blob/main/backend/scripts/runtime/pipeline/README.md
- API endpoints:
  https://github.com/wxyhgk/retain-pdf/blob/main/doc/api-endpoints.md
- Task lifecycle:
  https://github.com/wxyhgk/retain-pdf/blob/main/doc/rust_api/04-%E4%BB%BB%E5%8A%A1%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F.md

## How RetainPDF Could Fit Literature Studio

Do not embed RetainPDF directly into the reader. Instead, model it as an
optional processing provider:

```text
Literature Studio PDF tab
  -> "Translate with layout retention"
  -> background job
  -> progress events
  -> translated PDF artifact
  -> open artifact as sibling PDF tab or attach to source paper
```

Integration boundary:

- The reader supplies source PDF and metadata.
- The provider returns artifacts: translated PDF, markdown, normalized document,
  reports, and logs.
- Literature Studio stores artifact links in the literature library.
- The reader opens the translated PDF as a normal PDF tab.
- The annotation system remains independent and can anchor to either the source
  PDF or translated PDF.

Potential first-class workflows:

- `ocr-only`: extract `document.v1.json` and use it for search, outline, and
  RAG ingestion.
- `translate-only`: produce page-level translation payloads for side panel
  reading without generating a new PDF.
- `render-only`: rerender with different layout/typography rules without paying
  OCR/translation cost again.
- `full`: OCR, translate, render, and attach the final PDF to the source item.

## Recommendation

Build the PDF reader and annotation system independently from layout-preserving
translation.

For the reader:

- Follow the Chromium-style character range model.
- Keep selection and highlights in PDF coordinates.
- Hide the concrete render engine behind `PdfRenderBackend`.

For translation:

- Learn from RetainPDF's pipeline split and artifact contract.
- Treat RetainPDF-like processing as a background provider.
- Prefer consuming artifacts and APIs instead of mixing translation layout code
  into the live PDF viewer.

This gives us a clean product split: the reader stays interactive and precise,
while heavyweight OCR/translation/rendering can evolve as a separate pipeline.
