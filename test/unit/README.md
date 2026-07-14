# Unit tests

Comet keeps unit and in-process integration test sources beside the code they
exercise. This directory owns their discovery, execution hosts, coverage, and
shared test infrastructure.

## Runtime ownership

Runtime directories identify the process that actually executes a test:

- `node` owns tests executed by Node. Its entry point is `node/index.mjs` and it
  provides the JSDOM bootstrap used by source tests.
- `browser` owns a real headless Chromium page. Its entry point is
  `browser/index.mjs` and its renderer template is `browser/renderer.html`.
- `electron` owns a real Electron main process and hidden `BrowserWindow`. Its
  entry point is `electron/index.mjs`; `electron/main.mjs` owns the window and
  `electron/renderer.html` owns the renderer-side IPC report.

A source-layer name does not select the runtime. DOM-oriented tests that use
JSDOM still execute in Node, and tests for Electron-layer contracts that use
test doubles still execute in Node. A browser or Electron entry point must not
exist without starting that runtime.

The aggregate entry point is `index.mjs`. It runs all three real hosts in
sequence. The Node entry point discovers source tests under `src` and
`scripts`; Browser and Electron entry points discover host tests from their
explicit runtime roots. A source-layer directory alone never changes the
host. All hosts use the same focused test API and strict assertions, while
only Node owns source-mapped LCOV collection.

There are no domain runners, source manifests, or import-only aggregation
tests. A runtime directory is valid only when its entry point starts that
runtime.

The unit root owns runtime-independent infrastructure:

- `test-discovery.mjs` discovers sources and verifies test TypeScript project
  ownership;
- `coverage.mjs` collects source-mapped runtime coverage and checks changed
  reachable branches; and
- `test-infrastructure.test.ts` verifies these contracts.

## Run

Run every unit runtime:

```powershell
npm run test:unit
```

Select one runtime while iterating:

```powershell
npm run test:unit -- --runtime node --run src/cs/base/common/test/actions.test.ts
npm run test:unit -- --runtime browser --glob "test/unit/browser/**/*.test.ts"
npm run test:unit -- --runtime electron --run test/unit/electron/runtime.test.ts
```

The Browser runtime requires the Playwright Chromium browser to be installed
(`npx playwright install chromium`). Electron unit tests start a hidden real
renderer and report results over IPC; they do not reuse the smoke application.

Adding a matching test source requires no runner edit. An unsupported test
suffix, an undiscovered `--run` source, or an empty `--glob` selection fails
directly.

Before completing a test change, run:

```powershell
npm run typecheck:tests
npm run test:coverage
npm run verify
```

Application smoke tests have their own built-application runtime under
[`../smoke`](../smoke/README.md).
