---
description: Comet test runner, test depth, isolation, failure injection, and teardown rules.
applyTo: "{src/cs/**/test/**,src/cs/**/tests/**,src/cs/**/*.test.ts,src/cs/**/*.integrationTest.ts,test/**,scripts/**/*.test.ts,scripts/run-*-tests.mjs,scripts/test-*.mjs,scripts/verify/**,.github/workflows/**,package.json,tsconfig.tests.json}"
---

# Writing tests

## Runner boundary

- `node:test` is the sole API for declaring suites, tests, hooks, timeouts,
  skips, and test concurrency. Import every API explicitly; do not rely on
  test globals.
- Use `node:assert/strict` for assertions.
- Playwright is a Browser and Electron automation driver. A test that drives a
  real page or application still uses `node:test` for registration and
  lifecycle; it does not introduce a second test-runner lifecycle.
- Do not use Mocha, Sinon, Playwright Test declarations, module-level test
  globals, or runner-specific `this` contexts.
- Do not retry a failing test. A retry can be used manually to diagnose a
  failure, but it never converts the original failure into a pass.
- A timeout is a hard failure with diagnostics. Do not catch a timeout and
  continue through alternate behavior.

## Test types and ownership

| Type | Location and suffix | Boundary |
|---|---|---|
| Unit | `src/cs/**/test/**/*.test.ts`, `src/cs/**/tests/**/*.test.ts`, or an established adjacent `*.test.ts` | One module or small collaborating set with controlled dependencies |
| Integration | `src/cs/**/*.integrationTest.ts` | A real Comet boundary such as storage, IPC, a child process, or a local server |
| Test infrastructure | `scripts/**/*.test.ts` | Test discovery, build, execution, and repository verification |
| Application smoke | `test/smoke/src/**/*.test.ts` | The built Electron application driven through `test/automation` and Playwright APIs |

Integration tests use deterministic local infrastructure, temporary
directories, and local servers. A test that requires public network access,
credentials, or a mutable third-party service belongs to an explicit opt-in
lane and never gates the normal hermetic suite.

Every test source belongs to exactly one declared test lane. Repository
verification fails for an unassigned test, a test assigned to several lanes,
or an empty required lane. Support modules do not use a test-file suffix.
Importing a test indirectly from a hand-maintained index is not test
discovery.

## Running tests

Use the narrowest owning lane while iterating, then run every affected lane:

- `npm run test:base-common`
- `npm run test:valid-layers-check`
- `npm run test:workbench-browser`
- `npm run test:editor`
- `npm run test:pdf-selection`
- `npm run test:library-store`
- `npm run test:electron-main`
- `npm run test:agent`
- `npm run test:smoke`
- `npm run test:coverage`
- `npm run typecheck:tests`
- `npm run verify`

A narrow passing lane is not evidence that downstream integration or smoke
behavior still works. Run the lanes that exercise every changed runtime and
process boundary.

## Required behavioral depth

Start from the public contract and its state transitions, not from private
methods. Cover every applicable row below. One scenario may prove several
rows, and a row is inapplicable only when the production contract has no such
boundary.

| Risk area | Required proof |
|---|---|
| Input partitions | Representative valid values, empty and boundary values, malformed values, and unsupported values |
| State transitions | Every legal transition, every rejected transition, repeated operations, and terminal-state behavior |
| Failure and atomicity | Dependency failure before and after the commit point, the exact surfaced error, and the exact post-failure state promised by the contract; no uncontracted partial state |
| Async ordering | Cancellation before start and during work, timeout, late completion, duplicate completion, re-entry, and competing operations |
| Lifetime | Normal disposal, repeated disposal, replacement, ownership transfer, failure during cleanup, and no surviving resource |
| Persistence | Round trip, restart restoration, corrupt input, unsupported version, and interrupted write or activation |
| Protocol and IPC | Serialization, correlation, out-of-order or duplicate messages, disconnect, process exit, and idempotency where promised |
| Security boundary | Permission denial, untrusted path or content, validation before side effects, and redaction of secrets from errors and artifacts |
| User-visible flow | Semantic UI outcome, focus and selection, reload or reopen behavior, and relevant process-loss recovery |

For a bug fix, add a regression test that fails against the faulty behavior
and passes because of the fix. When a defect crossed layers, reproduce it at
the lowest layer that owns the invariant and retain an integration or smoke
test for the boundary that allowed it to escape.

Coverage is a gap detector, not a correctness claim. The authoritative lane
manifest assigns executable source roots to coverage-producing lanes. CI
merges their source-mapped coverage and rejects an uncovered reachable branch
introduced or changed by the patch. Missing source maps, source ownership, or
merge-base data fail the coverage command; they do not produce an empty pass.
A percentage never replaces the behavioral matrix or failure injection.

## Assertions and fixtures

- Assert externally observable results and complete invariants. Do not test a
  private method merely because it is easier to reach.
- A logical scenario may contain all assertions needed to prove its final
  state. Do not reduce assertions at the cost of leaving state, ownership, or
  error behavior unverified.
- Prefer one explicit `deepStrictEqual` for a structured state when it makes
  missing or unexpected fields visible. Use focused assertions when their
  failure messages identify the violated invariant more clearly.
- Assert stable error types, codes, and structured data. Do not couple tests to
  localized prose unless that prose is itself the public result.
- Keep expected protocol and state objects explicit. A checked-in golden or
  textual input fixture is deterministic UTF-8, free of user content and
  secrets, and at most 64 KiB. A minimal hand-authored synthetic HTML fixture
  is valid for parser behavior; a captured real-world page is not. Do not
  check in PDFs, images, transcript histories, selections, attachment payloads,
  or captured user documents. Generate large and binary fixtures in the test
  and assert structural metadata, bounded excerpts, and digests. Golden files
  are reviewed as code and never regenerated merely to make a failure
  disappear.
- Use small project-owned fakes passed through real dependency-injection
  seams. Do not patch globals, mock modules, reach through service locators, or
  add a production fallback for a test.
- Give randomized and property-style cases a recorded deterministic seed so a
  failure is exactly reproducible.

## Time, concurrency, and synchronization

- Unit tests use an injected clock, scheduler, or explicit completion signal.
  Do not use wall-clock sleeps as correctness synchronization.
- Integration and smoke tests wait for a named observable condition with a
  bounded deadline and capture the last observed state on timeout. A fixed
  delay is permitted only when elapsed time is the input under test; the
  assertion still waits on the resulting condition.
- Exercise concurrency deliberately with controlled barriers so both relevant
  orderings are proven. Do not depend on scheduler luck.
- Tests using a process-wide disposable tracker, application singleton,
  shared port, or shared user-data directory run serially. Do not enable
  `concurrency` for such a suite.
- Platform-specific tests call `TestContext.skip(reason)` and return. The
  repository must have a CI lane on the addressed platform; an unconditional
  skip is not coverage.

## Cleanup and leak detection

Suites that create Comet lifecycle owners install
`ensureNoDisposablesAreLeakedInTestSuite()` from
`cs/base/test/common/testUtils`. Register expected test-owned resources in the
returned store immediately:

```typescript
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { ensureNoDisposablesAreLeakedInTestSuite } from 'cs/base/test/common/testUtils';

suite('ExampleModel', { concurrency: false }, () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects a failed commit without publishing partial state', async () => {
		const model = disposables.add(new ExampleModel());

		await assert.rejects(model.commitInvalidState(), InvalidStateError);
		assert.deepStrictEqual(model.snapshot(), { phase: 'idle', value: null });
	});
});
```

The leak checker covers project-owned disposables that participate in Comet
lifecycle tracking; it does not own external processes, servers, Browser
contexts, timers, temporary files, or third-party objects. Register those with
`TestContext.after`, an owning test fixture, or a `finally` block. Cleanup runs
after setup failure as well as assertion failure, and cleanup errors remain
visible.

Use `markAsSingleton` only for an intentional process-lifetime singleton. It
must never exempt a test-local object from leak detection.

## Application smoke tests

- Give every test a fresh user-data directory, temporary root, application
  instance, and owned local server. Do not share mutable application state
  between tests.
- Run application smoke files serially because they own desktop process and
  automation resources.
- A fixture writes artifacts to a per-test staging directory and emits one
  machine-readable `test:diagnostic` record containing an opaque staging token
  before fallible startup. Because the smoke runner is serial, the result
  reporter associates that token with exactly one active leaf test and derives
  its canonical ID from the final event's file, suite path, name, and test
  number. Zero or multiple active owners is an infrastructure failure. A
  fixture hook never decides pass or failure. The reporter removes staging on
  the final pass event and promotes it on failure, timeout, teardown failure,
  cancellation, or test-process loss.
- Failure artifacts contain only synthetic fixture data and redacted
  diagnostics. Keep at most 1 MiB of tail logs per process, one 8 MiB
  screenshot, 64 KiB of metadata-only diagnostic JSON, and a 32 MiB Playwright
  trace without source files, credentials, cookies, authorization headers,
  query secrets, transcript text, selections, or attachment content. The
  entire per-test bundle is capped at 48 MiB; exceeding a cap is an additional
  test-infrastructure failure. A disallowed or oversized payload is never
  uploaded; retain only a bounded metadata rejection record with its file
  role, size, and reason.
- The reporter consumes internal staging diagnostics. Test output prints only
  a retained failure manifest path. CI uploads promoted failed bundles for
  seven days and never uploads successful staging data.
- Use semantic roles, stable product-owned identifiers, and public automation
  commands. Do not infer state from foreign DOM classes or walk across Part
  ownership boundaries.
- Assert both the user-visible outcome and the lifecycle consequence when a
  flow opens, hides, reloads, crashes, reconnects, or closes a resource.
- Smoke tests do not retry. Flakiness is a synchronization, isolation, or
  product defect and is fixed at its source.
