# Unit tests

Comet keeps unit and in-process integration test sources beside the code they
exercise. This directory owns their discovery, execution hosts, coverage, and
shared test infrastructure.

## Runtime ownership

Runtime directories identify the process that actually executes a test:

- `node` owns tests executed by Node. Its entry point is `node/index.mjs`.
- `browser` owns a real browser page and controller when browser-hosted unit
  tests exist.
- `electron` owns a real Electron main, preload, and renderer chain when
  Electron-hosted unit tests exist.

A source-layer name does not select the runtime. DOM-oriented tests that use
JSDOM still execute in Node, and tests for Electron-layer contracts that use
test doubles still execute in Node. A browser or Electron entry point must not
exist without starting that runtime.

The Node entry point discovers `*.test.ts` and `*.integrationTest.ts` under
`src`, `scripts`, and `test/unit`. It applies one build, JSDOM bootstrap,
serial-execution, and reporting policy to the selected sources. There are no
domain runners, source manifests, or import-only aggregation tests.

The unit root owns runtime-independent infrastructure:

- `test-discovery.mjs` discovers sources and verifies test TypeScript project
  ownership;
- `coverage.mjs` collects source-mapped runtime coverage and checks changed
  reachable branches; and
- `test-infrastructure.test.ts` verifies these contracts.

## Run

Run the complete Node unit runtime:

```powershell
npm run test:unit
```

Select one source or a repository-relative glob while iterating:

```powershell
npm run test:unit -- --run src/cs/base/common/test/actions.test.ts
npm run test:unit -- --glob "src/cs/base/common/test/**/*.test.ts"
```

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
