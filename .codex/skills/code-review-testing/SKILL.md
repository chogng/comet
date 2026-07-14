---
name: code-review-testing
description: Test authoring guidance
---

For behavior changes, prefer integration coverage over narrow unit tests when the repo already has an end-to-end path.

In this repository, select the narrowest source set through the real unit
runtime:
- `npm run test:unit -- --runtime node --run src/cs/example/test/example.test.ts`
- `npm run test:unit -- --runtime browser --glob "test/unit/browser/**/*.test.ts"`
- `npm run test:unit -- --runtime electron --glob "test/unit/electron/**/*.test.ts"`

Run `npm run test:unit` when all unit hosts are required. Runtime directories
under `test/unit` describe the process that really executes a test; do not
classify JSDOM as a browser host or a mocked Electron contract as an Electron
host.

If unit tests are needed, keep them close to the affected module and avoid test-only hooks in production code.
