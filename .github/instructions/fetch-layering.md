# Fetch Layering

This document records the current fetch split.

## Current Split

The fetch pipeline is now split into five roles.

### 1. Detect

`detect.ts` decides whether the incoming source page is:

- `detail`
- `listing`

It does not fetch content and does not dispatch.

### 2. Dispatch

`dispatch.ts` is the batch entry coordinator.

It:

- calls `detect.ts`
- routes `detail` pages to `fetchDetail.ts`
- routes `listing` pages to `fetchListing.ts`
- keeps shared fetch helpers such as raw HTML loading

### 3. Detail Fetch

`fetchDetail.ts` handles single-article-page fetching.

It is responsible for:

- loading the page
- parsing the article
- validating article signals
- returning page-only results

### 4. Listing Fetch

`fetchListing.ts` handles list-page fetching.

It is responsible for:

- choosing and applying source extractors
- collecting candidate descriptors
- pagination and pagination stop decisions
- candidate fetch budgeting and concurrency
- fetching candidate detail pages
- merging list-page hints into parsed article results

### 5. Listing Support

Files under `src/ls/code/electron-main/fetch/listing/` are responsible for reusable list-page mechanics:

- `listing/scoring.ts`
- `listing/candidates.ts`
- `listing/planning.ts`

Files under `src/ls/code/electron-main/fetch/sourceExtractors/` provide page-specific extractor logic for listing pages only.

## Design Rule

List-page metadata is still only a hint, not the canonical final article record, unless the merge step explicitly decides the candidate is complete enough to skip article-page parsing.

## Single-Page Parser Debug Entry

Single-page article parsing should be debugged through:

- `src/ls/code/electron-main/fetch/test/parseArticleTest.ts`

This file is the stable local entry for parser validation against saved HTML snapshots.
It is intentionally placed under `fetch/test/` so future article-parser work can reuse the same nearby debug flow instead of creating ad hoc scripts elsewhere.
