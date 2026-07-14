---
description: Comet unit and integration test writing guidelines for placement, execution, assertions, deterministic fixtures, and clean teardown.
applyTo: "{src/cs/**/test/**,src/cs/**/*.test.ts,src/cs/**/*.integrationTest.ts}"
---

# Writing tests

Comet tests use Node's built-in test runner and strict assertions. Keep each
test focused, but keep the owning suite complete for every applicable risk in
the changed public contract.

## Test types

| Type | Suffix and location | Use for |
|---|---|---|
| Unit | `*.test.ts` under `src/cs/**/test/` or next to the owning source | One module or a small collaborating set with controlled dependencies |
| Integration | `*.integrationTest.ts` next to the owning subsystem | A real boundary such as storage, IPC, a child process, or a local server |

<<<<<<< HEAD
Platform Agent Host contract and runtime tests and their support modules live under
`src/cs/platform/agentHost/test/{common,browser,electron-browser,node}/`,
partitioned by the runtime they exercise. They do not live under Agent Host
production runtime or component directories.

Product composition, concrete Electron process launchers, and product-owned
Agent runtime implementations keep their tests in the owning Code subtree's
sibling `test/` directory. Platform Agent Host tests never import `cs/code/**`
to exercise a product mock or product runtime.

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

Run the narrowest owning lane while iterating, then every lane affected by the
changed runtime or process boundary:

- `npm run test:base-common`
- `npm run test:valid-layers-check`
- `npm run test:workbench-browser`
- `npm run test:editor`
- `npm run test:pdf-selection`
- `npm run test:library-store`
- `npm run test:electron-main`
- `npm run test:agent`

Before completing a test change, run `npm run typecheck:tests`,
`npm run test:coverage`, and `npm run verify`. A passing unit lane does not
replace an affected integration lane.

## Test structure and behavior

Import declarations and assertions explicitly:

```typescript
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
```

- Do not use test globals, Mocha, Sinon, Playwright Test declarations, or a
  runner-specific `this` context.
- Name tests after observable behavior. Start from the public contract rather
  than private methods or implementation details.
- For behavior changes, prefer integration coverage when the repository already
  has an end-to-end path through the affected boundary. Add focused unit
  coverage where it gives more precise contract evidence.
- For a bug fix, add a regression test that fails against the faulty behavior
  and passes because of the fix.
- A timeout is a hard failure. Do not catch it, retry the test, or continue
  through alternate behavior.

Cover every applicable risk exposed by the changed public contract:

| Risk area | Required proof |
|---|---|
| Input and state | Representative valid, empty, boundary, malformed, and unsupported input; legal, rejected, repeated, and terminal transitions |
| Failure and ordering | Dependency failure immediately before and after meaningful commit points; exact surfaced error and promised final state; cancellation, timeout, late or duplicate completion, re-entry, and competing operations |
| Lifetime | Normal and repeated disposal, replacement, ownership transfer, partial construction, cleanup failure, and no surviving resource |
| Persistence and protocol | Round trip, restart, corruption, unsupported versions, interrupted writes, serialization, correlation, duplicate or out-of-order messages, disconnect, and process exit |
| Security and user-visible behavior | Validation and permission denial before side effects, diagnostic redaction, semantic outcomes, focus, selection, reopen, and recovery behavior |

Coverage identifies untested branches; it does not prove the contract. Cover
every new or changed reachable branch without replacing behavioral assertions
or failure injection with a percentage target.

## Assertions and test doubles

- Assert externally observable results and complete invariants. Prefer one
  `deepStrictEqual` when the complete structured state is the contract.
- Assert stable error types, codes, and structured data. Do not couple a test
  to localized prose unless that prose is itself the public result.
- Use small project-owned fakes through real dependency-injection seams. Do
  not patch globals, mock modules, or reach through a service locator.
- Never add a production fallback or test-only production path to make a test
  pass.
- Keep checked-in textual fixtures deterministic UTF-8, synthetic, free of
  secrets and user content, and no larger than 64 KiB. Generate binary and
  large fixtures in the test and assert structural metadata and stable
  digests.
- Record the seed for randomized or property-style cases so failures are
  reproducible.

## Time and concurrency

- Unit tests use an injected clock, scheduler, barrier, or explicit completion
  signal. Do not use a wall-clock sleep for correctness synchronization.
- Integration tests wait for a named observable condition with a bounded
  deadline and include the last observed state in timeout diagnostics.
- Exercise relevant orderings with controlled barriers instead of scheduler
  luck.
- Run a suite serially when it uses a process-wide disposable tracker,
  application singleton, shared port, or shared user-data directory.
- A platform-specific test calls `TestContext.skip(reason)` and returns. The
  addressed platform must have a lane that executes the test.

## Clean teardown

Suites that create Comet lifecycle owners install
`ensureNoDisposablesAreLeakedInTestSuite()` and register expected test-owned
resources immediately:

```typescript
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { ensureNoDisposablesAreLeakedInTestSuite } from 'cs/base/test/common/testUtils';

suite('ExampleModel', { concurrency: false }, () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects an invalid commit without changing state', async () => {
		const model = disposables.add(new ExampleModel());

		await assert.rejects(model.commitInvalidState(), InvalidStateError);
		assert.deepStrictEqual(model.snapshot(), { phase: 'idle', value: null });
	});
});
```

The leak checker owns only tracked Comet disposables. Register processes,
servers, Browser contexts, timers, temporary files, and third-party objects
with `TestContext.after`, an owning fixture, or a `finally` block. Cleanup must
run after setup failure as well as assertion failure, and cleanup errors must
remain visible.

Use `markAsSingleton` only for an intentional process-lifetime singleton. It
must never exempt test-local state from leak detection.
