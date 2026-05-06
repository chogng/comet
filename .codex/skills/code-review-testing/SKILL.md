---
name: code-review-testing
description: Test authoring guidance
---

For behavior changes, prefer integration coverage over narrow unit tests when the repo already has an end-to-end path.

In this repository, check the existing test runners first:
- `npm run test:base-common`
- `npm run test:editor`
- `npm run test:pdf-selection`
- `npm run test:library-store`
- `npm run test:electron-main`

If unit tests are needed, keep them close to the affected module and avoid test-only hooks in production code.

