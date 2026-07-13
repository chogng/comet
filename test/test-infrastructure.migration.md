# Test lane and coverage migration

## Temporary scope

This migration owns only repository-wide test discovery, lane execution,
test-source type checking, and changed-branch coverage:

- the lane, command, coverage, and test-source classification sections of
  `.github/instructions/writing-test.instructions.md`;
- `package.json`, `package-lock.json`, and `tsconfig.tests.json` where those
  files define lane commands, coverage, or test type checking;
- `scripts/run-*-tests.mjs`;
- the new authoritative `scripts/test-lanes.mjs` and shared
  `scripts/test-discovery.mjs`;
- `scripts/verify/verify-all.ts` and focused lane, discovery, type-check
  coverage, and changed-branch coverage verification under
  `scripts/verify/**`;
- `.github/workflows/ci.yml` only where CI invokes verification or coverage;
  and
- these import-only aggregation files:
  - `src/cs/base/common/test/index.test.ts`;
  - `src/cs/agent/tests/index.test.ts`;
  - `src/cs/platform/storage/test/index.test.ts`;
  - `src/cs/code/electron-main/tests/index.test.ts`; and
  - `src/cs/editor/browser/pdf/tests/pdfSelection.index.test.ts`.

It does not own test framework conversion, smoke fixtures, smoke artifacts,
Disposable tracking, Observable behavior, or domain test content. Those have
separate migrations, including the
[test contract audit](test-contract-audit.migration.md), so completing one
concern never depends on completing all of the others.

## Boundary being replaced

The current runner scripts use separate hand-maintained source lists and, for
several lanes, compile one aggregation test that imports the real suites. A
new matching test can therefore type-check without executing, or execute
without belonging to an explicit lane. Deleting an aggregation file without
preserving its lane policy would also change formerly serial suites into
Node's multi-file parallel execution.

`tsconfig.tests.json` currently includes `src/**/*.test.ts` and broad
`src/**/tests/**/*.ts`, but not `src/**/*.integrationTest.ts` or
`scripts/**/*.test.ts`. Direct discovery must not make those test sources
runtime-visible while leaving them outside test type checking.

There is no source-mapped coverage command or CI rule that mechanically checks
new and changed reachable branches. The permanent depth rule therefore cannot
yet be enforced.

## Final project-owned target

### Authoritative lane manifest

`scripts/test-lanes.mjs` is the single manifest of executable test lanes. Each
lane declares:

- a stable lane ID and public package command;
- source roots and supported suffixes;
- runtime and bootstrap requirements;
- build or bundling configuration;
- serial or explicitly bounded concurrency; and
- its source-mapped coverage collector and owned production source roots.

`scripts/test-discovery.mjs` expands those declarations in stable sorted order.
Verification compares every project-owned `*.test.ts` and
`*.integrationTest.ts` source with the manifest and fails if a test is
unassigned, multiply assigned, outside every test TypeScript project, or if a
required lane is empty. Support modules do not use a test suffix.

The runtime-specific `scripts/run-*-tests.mjs` files consume the manifest and
shared discovery result directly. They retain only real runtime build and
bootstrap differences. No runner has a private file list and no import-only
test aggregation entry point remains.

### Preserved execution policy

The Base common, Agent, storage, Electron main, and PDF-selection lanes remain
serial at the direct-discovery cutover because their aggregation files
previously made each lane one Node test file. Their runner passes
`--test-concurrency=1` after compilation. A later change may enable bounded
parallelism only after proving that its fixtures, process globals, ports,
clocks, lifecycle trackers, and temporary state are isolated.

The lane verifier exercises command construction and rejects a serial lane
whose concurrency option is dropped before the test child process is spawned.

### Complete test type checking

Every discovered test belongs to exactly one test TypeScript project.
`tsconfig.tests.json`, or explicit test projects referenced by it, covers:

- `src/**/*.test.ts`;
- `src/**/*.integrationTest.ts`;
- test support modules under declared `test` and `tests` roots; and
- `scripts/**/*.test.ts`.

`test/smoke/tsconfig.json` remains the type-check owner for smoke sources and is
recorded by the lane manifest. The root `npm run typecheck:tests` command
executes every declared test TypeScript project, including smoke. Verification
compares discovery with these projects rather than assuming that one include
pattern covers every runtime.

### Mechanical changed-branch coverage

`npm run test:coverage` executes the coverage-producing lanes selected by the
manifest, merges their source-mapped V8 coverage, and evaluates the pull
request diff against the merge base. Every newly introduced or changed
reachable branch in an owned executable TypeScript source must have a mapped
execution count. An uncovered changed branch fails the command and prints the
source file, branch span, and owning lane.

Generated files, type-only declarations, and statically unreachable branches
may be excluded only by an explicit checked-in manifest entry with a reason.
A platform-specific reachable branch is assigned to its matching platform
collector and must appear in the final CI merge; only nonmatching collectors
mark it inapplicable. There is no percentage escape hatch and no blanket
directory exclusion.

CI runs repository verification and every declared test TypeScript project.
Coverage collectors run on each platform required by the manifest and publish
source-mapped fragments; one final coverage job merges those fragments and
runs the same changed-branch evaluator exposed by `npm run test:coverage`, with
enough Git history to compute the merge base. A collector failure, missing
platform fragment, missing source map, missing base revision, or unowned
changed source fails rather than silently producing an empty report.

## Direct migration steps

1. Add the lane manifest and discovery module, then make every existing runner
   consume them. Preserve each runtime's current compiler, bundle format,
   bootstrap, external modules, and exit propagation.
2. Record the effective serial policy of every current lane. Mark the five
   formerly aggregated lanes serial and pass `--test-concurrency=1` to the
   spawned Node test process.
3. Change each runner to compile and execute every directly discovered test.
   Delete its scoped aggregation file in the same cutover; do not keep an
   import shim or a second list.
4. Expand the test TypeScript project graph to include integration tests,
   script tests, and declared support modules. Record the smoke TypeScript
   project in the lane manifest.
5. Add verification for discovery ownership, non-empty lanes, test-project
   ownership, runner command construction, and child exit propagation. Wire
   it into `npm run verify`.
6. Add the source-mapped V8 coverage collector and changed-branch evaluator.
   Declare production-source and required-platform ownership per lane, add
   `npm run test:coverage`, and wire platform collection plus final merge and
   evaluation into CI.
7. Run every lane, `npm run typecheck:tests`, `npm run test:coverage`, and
   `npm run verify`, then delete this migration document when all completion
   criteria hold.

## Infrastructure conformance cases

Focused infrastructure tests must prove:

- a new matching unit or integration test is discovered without editing a
  second file;
- unassigned, duplicate, unsupported-suffix, and empty-required-lane cases
  fail with the addressed path and lane;
- stable ordering, paths containing spaces, and cross-platform separators are
  preserved;
- TypeScript, esbuild, spawn, non-zero exit, and signal termination failures
  propagate from a runner;
- each runtime receives only its declared bootstrap and external modules;
- every serial lane passes `--test-concurrency=1` to Node;
- every discovered test maps to exactly one test TypeScript project, including
  integration and script tests;
- source maps resolve a covered and an uncovered branch to the original
  TypeScript span;
- a changed uncovered reachable branch fails while a covered branch passes;
  and
- a missing required-platform fragment, coverage file, source map, merge-base
  revision, or source owner fails directly.

## Behavior that must be preserved

- Existing public package-level lane commands remain the way to run their
  owning tests.
- Every currently active suite continues to execute exactly once.
- The direct-discovery cutover does not introduce cross-file concurrency into
  a formerly aggregated lane.
- Runtime-specific build formats, bootstraps, and process exit semantics remain
  intact.
- Coverage does not replace behavioral assertions, failure injection, or
  platform-specific test execution.

## Completion and deletion criteria

This migration is complete only when:

- every project-owned unit and integration test is owned by exactly one lane
  and one test TypeScript project;
- every required lane is non-empty and directly discovers its sources;
- none of the scoped aggregation entry points or runner-private source lists
  remains;
- the five formerly aggregated lanes still run serially, with a conformance
  test guarding flag propagation;
- integration, script, and smoke test sources are type-checked by the root
  command;
- `npm run test:coverage` enforces source-mapped changed reachable branches and
  CI evaluates merged required-platform fragments against a real merge base;
- every infrastructure conformance case passes; and
- every declared lane, `npm run typecheck:tests`,
  `npm run test:coverage`, and `npm run verify` passes.

Delete this document in the same change that satisfies these criteria.
