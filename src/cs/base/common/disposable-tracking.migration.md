# Disposable tracking core migration

## Temporary scope

This migration owns the lifecycle instrumentation needed to detect leaked
Comet disposables:

- `src/cs/base/common/lifecycle.ts`;
- `src/cs/base/common/test/lifecycle.test.ts`;
- the new `src/cs/base/test/common/testUtils.ts` and its focused tests;
- the durable Disposable rules in
  `.github/instructions/coding-guidelines.instructions.md` and
  `.github/instructions/disposable.instructions.md`; and
- the Node unit runtime only as needed to execute those focused tests.

It does not audit every structural disposable or convert every test suite.
That repository-wide adoption belongs to
[Disposable tracking adoption](../../../../test/disposable-tracking-adoption.migration.md).

## Boundary being replaced

Comet lifecycle primitives currently perform real cleanup but do not report
their creation, parent ownership, transfer, or terminal disposal to a test
tracker. `markAsSingleton` has no observable tracking effect. Consequently a
suite cannot distinguish a deliberately process-lived resource from a leaked
test-owned root.

The upstream tracker is useful evidence for creation stacks, parent graphs,
ownership transfer, terminal disposal, and singleton marking. Its Mocha-bound
test helper and its exact lifecycle implementation are not copied. Comet adds
the instrumentation directly to its own lifecycle primitives and binds the
helper to `node:test`.

## Final project-owned target

`cs/base/common/lifecycle` exposes one optional process-wide
`IDisposableTracker`, installed through `setDisposableTracker`. The real
lifecycle primitives always execute the same cleanup implementation; tracker
hooks only report that implementation's state when a tracker is installed.
There is no tracked wrapper and no alternate cleanup path.

The tracker protocol records:

- creation through `trackDisposable`;
- current parent ownership and explicit ownership transfer;
- first terminal disposal through `markAsDisposed`; and
- deliberate process lifetime through `markAsSingleton`.

`toDisposable`, `DisposableStore`, `DisposableMap`, `MutableDisposable`, and
`Disposable` participate directly. Stores and holders update parentage when a
child is added, replaced, removed, cleared, leaked, or transferred. A leak
operation transfers responsibility to its caller; it never hides or disposes
the value. Repeated disposal remains idempotent and does not emit a second
terminal transition.

`DisposableTracker` retains enough creation and parent information to report
only surviving roots with readable ownership paths. Installing a second
tracker while one is active throws. Uninstalling the active tracker in a
`finally` block restores the process to an untracked state even when the test
or leak assertion fails.

`ensureNoDisposablesAreLeakedInTestSuite()` is a `node:test` suite helper. It:

- installs a fresh tracker before each test and removes it after each test;
- rejects concurrent tests in the suite contract;
- returns a store for resources the test deliberately gives to the helper;
- disposes that store before checking for surviving roots;
- preserves both the original test error and a cleanup or leak error; and
- never treats pre-hook module state as test-owned state.

Tests create owned disposables inside the test after tracker installation.
Intentional process singletons are created lazily and explicitly marked; a
module-level test fixture is not exempted merely because it predates a hook.

## Direct migration steps

1. Add the tracker protocol, installation guard, creation/disposal functions,
   parent updates, and singleton marking to `lifecycle.ts`.
2. Instrument each lifecycle primitive at the point where it already creates,
   owns, transfers, and disposes a resource. Do not wrap an old primitive or
   duplicate its cleanup state machine.
3. Add focused lifecycle tests for tracking disabled and enabled behavior,
   creation stacks, idempotent disposal, nested ownership, replacement,
   transfer, leak operations, singleton marking, reverse cleanup order, and
   cleanup errors.
4. Add the `node:test` leak helper and prove its hook ordering, serial guard,
   cleanup, error preservation, and tracker reset.
5. Run the focused Base common tests, test type checking, and repository verification,
   then delete this document once every completion criterion holds.

## Required conformance cases

- A clean owned resource produces no leak.
- An undisposed root reports its creation site.
- An undisposed child is reported beneath its surviving real owner.
- Disposing an owner removes its disposed descendants from the report.
- Replacing, removing, `deleteAndLeak`, and `clearAndLeak` transfer ownership
  exactly once and never create a false exemption.
- An intentional singleton is ignored while an ordinary root is not.
- Repeated disposal and repeated store clearing do not double-report.
- Cleanup failures remain visible without preventing later cleanup attempts.
- A failing test plus a leak or cleanup failure reports both causes.
- Tracker state is removed after success, test failure, hook failure, and leak
  assertion failure.
- Overlapping tracker installation and concurrent use fail deterministically.
- With no tracker installed, cleanup order, errors, and ownership behavior are
  unchanged.

## Completion and deletion criteria

This migration is complete only when all scoped lifecycle primitives report
their real ownership transitions, the helper detects every conformance case,
no Mocha hook or compatibility wrapper exists, and the focused Base common tests,
`npm run typecheck:tests`, and `npm run verify` pass.

Delete this document in the same change that satisfies these criteria.
