# Disposable tracking adoption migration

## Temporary scope

This migration begins after the
[Disposable tracking core](../src/cs/base/common/disposable-tracking.migration.md)
is complete. It owns:

- every surviving project-owned class under `src/cs/**` that declares a
  `dispose()` method or owns a disposable field;
- raw project-owned object literals that implement cleanup through a
  `dispose()` member;
- `src/cs/base/common/lifecycle.ts` for deletion of the transitional
  `DisposableLike`, callable `DisposableHandle`, `DisposableInput`, and raw
  disposer-function store overloads after their call sites migrate;
- unit and integration suites that create tracked Comet disposables; and
- an AST-based disposable-contract verifier and its tests under
  `scripts/verify/**`.

Sessions files also in the
[Agent Host migration](../src/cs/sessions/agent-host.migration.md) follow that
migration's deletion boundary. Legacy `default` provider and `mainChat` code
is deleted, not instrumented merely to preserve it. Surviving Agent Host,
Comet, Session, and Chat code adopts the final lifetime contract directly.

## Boundary being replaced

TypeScript structural typing allows a class or object literal with a
`dispose()` member to be consumed as `IDisposable` without declaring the
contract or participating in tracking. Searching only for explicit
`implements IDisposable` therefore misses precisely the resources most likely
to evade leak detection.

Requiring every owner to extend `Disposable` is also incorrect: classes such
as editor panes already have a required base class. The durable rule must
cover both inheritance shapes without introducing a facade or compatibility
base.

## Final project-owned target

Every surviving project-owned class with a `dispose()` method participates
explicitly in `IDisposable` through `Disposable`, another lifecycle-tracked
required base, or its own `implements IDisposable`.

`IDisposable` is the one object-lifetime contract. `DisposableStore`,
`DisposableMap`, `MutableDisposable`, `Disposable`, `dispose`, and
`combinedDisposable` accept `IDisposable` values rather than a parallel
`DisposableLike` shape or a disposer-function union. `toDisposable(fn)` is the
single conversion from a cleanup function to `IDisposable`; its result is not
also callable. The old names and overloads are deleted after direct call-site
migration, not retained as aliases.

- A class extends `Disposable`, or retains another lifecycle-tracked required
  base, and registers owned resources immediately without duplicating inherited
  tracking.
- A class whose required base is not lifecycle-tracked implements
  `IDisposable` directly, owns children in a `DisposableStore`, calls
  `trackDisposable(this)` at creation, and calls `markAsDisposed(this)` at its
  first terminal disposed state.
- A function-backed cleanup uses `toDisposable`; production code does not
  return a raw `{ dispose() { ... } }` object or pass a cleanup function
  directly to an ownership primitive.
- Every disposable field has an explicit owner, is registered immediately,
  and is disposed or transferred at a named lifetime boundary.

The verifier uses the TypeScript AST and resolved class hierarchy. It finds
method declarations, property-assigned dispose functions, inherited required
base classes, explicit interfaces, inherited or direct lifecycle tracking,
raw cleanup objects, and disposable fields. Text matching explicit
`implements` clauses is not the acceptance mechanism, and duplicate direct
hooks on an already tracked base are rejected.

Every non-concurrent unit or integration suite that creates tracked Comet
resources installs `ensureNoDisposablesAreLeakedInTestSuite()`. Process,
Browser, server, timer, and third-party lifetimes remain owned by their real
fixtures and are asserted separately; they are not disguised as Comet
disposables to satisfy the helper.

## Direct migration sequence

1. Add and test the AST verifier before changing call sites. Its fixtures cover
   structural classes, required-base classes, inherited dispose methods, raw
   cleanup objects and functions, tracked direct implementations, and
   legitimate `toDisposable` use.
2. Migrate Base and Platform owners and their tests. Replace structural
   cleanup directly and install leak checking in the owning serial suites.
3. Migrate Editor and Workbench owners without changing their required base
   classes. Add direct stores and lifecycle hooks where needed.
4. Migrate surviving Sessions, Agent Host, Comet, and Code owners after
   deleting the legacy paths assigned to the Agent Host migration.
5. Audit disposable fields and ownership transfers across all surviving
   layers. Wrap every function-backed cleanup explicitly with `toDisposable`.
   Exercise replacement, failure, cancellation, and terminal disposal in
   focused tests.
6. Delete `DisposableLike`, `DisposableHandle`, `DisposableInput`, the
   `isDisposableLike` public guard, and raw function overloads from lifecycle.
   Update all addressed imports and calls directly in the same cutover.
7. Run every affected lane, test type checking, and repository verification,
   then delete this document after all criteria hold.

## Required conformance cases

- The verifier rejects a structural-only disposable class.
- It rejects a raw production cleanup object and accepts `toDisposable`.
- It rejects a cleanup function passed directly to an ownership primitive.
- It accepts a `Disposable` or other lifecycle-tracked subclass with immediate
  child registration and no duplicate direct hooks.
- It accepts a non-tracked required-base class only with explicit
  `IDisposable`, creation tracking, terminal marking, and owned-child cleanup.
- It rejects an owned disposable field with no disposal or transfer path.
- Leak checking catches a direct owner, a nested owner, and a transferred
  owner outside `lifecycle.ts`.
- Normal disposal, repeated disposal, replacement, cancellation, failed
  construction, and cleanup failure leave the contractually correct tracked
  state.
- A suite cannot enable concurrency while it owns the process-wide tracker.

## Completion and deletion criteria

This migration is complete only when the AST verifier finds no structural-only
survivor, raw ownership function, or unowned disposable field; the removed
lifecycle names and overloads have no declaration or call site; every
applicable surviving suite uses the leak helper; every conformance case passes;
legacy Agent Host paths are deleted rather than adapted; and all affected
lanes, `npm run typecheck:tests`, and `npm run verify` pass.

Delete this document in the same change that satisfies these criteria.
