# Test contract audit migration

## Temporary scope

This migration owns adoption of the behavioral-depth, assertion, deterministic
time, and checked-in fixture rules in
`.github/instructions/writing-test.instructions.md`. Its code scope is every
surviving project-owned unit and integration suite and the minimal production
test seams required to control time, ordering, dependency failure, and process
lifetime. It also owns checked-in test data under those suites and the focused
fixture and sleep verifiers and their tests under `scripts/verify/**`.

It does not own unit discovery or coverage, lifecycle tracking, Observable
kernel semantics, or application smoke reliability. Those belong to their
focused migration documents. Sessions tests for legacy `default` provider and
`mainChat` sources are deleted by the
[Agent Host migration](../src/cs/sessions/agent-host.migration.md), not expanded
to keep doomed behavior alive. Final Agent Host, Comet, Session, Chat, SDK, and
tool contracts are audited directly.

## Boundary being replaced

Existing suites are uneven: many prove a useful success path, while some public
state machines, persistence boundaries, protocols, and process lifetimes do
not yet exercise every rejected, post-commit failure, cancellation, re-entry,
restart, and cleanup transition. Coverage can find an unexecuted branch, but it
cannot establish the promised state after that branch.

The repository also has no mechanical bound for checked-in expected data and
text fixtures, and no repository-wide check against using a wall-clock sleep as
correctness synchronization.

## Final project-owned target

### Contract-based behavioral matrices

Each surviving public contract has a focused test matrix covering every
applicable partition in the permanent instruction. The matrix is derived from
public states and commit points rather than private methods or a coverage
percentage.

Failure tests assert the exact error and exact promised post-failure state.
They do not impose universal rollback: a contract that commits before an error,
such as a finalized Observable transaction, proves its committed state; a
contract that promises atomic rejection proves its unchanged state. Failures
are injected immediately before and after each meaningful commit boundary.

Async and process tests control both relevant orderings with barriers,
cancellation handles, fake clocks, or explicit completion signals. They cover
late and duplicate completion, timeout, re-entry, process exit, disconnect,
and cleanup failure without relying on scheduler luck.

Persistence and protocol tests cover round trip, restart, corrupt and
unsupported input, interrupted activation or write, correlation, duplicate and
out-of-order messages, and terminal disconnect behavior where applicable.
Security-boundary tests prove validation before side effects and redaction of
errors and diagnostics.

### Deterministic fixtures and expected data

Every checked-in golden and textual input fixture is deterministic UTF-8,
synthetic, free of secrets and user content, and no larger than 64 KiB.
Minimal hand-authored HTML used to prove parser behavior is allowed; captured
real-world pages and user documents are not. PDFs, images, large documents,
transcripts, selections, and attachment payloads are generated in the test.
Assertions use structural metadata, bounded excerpts, and stable digests where
the entire generated value is intentionally not checked in.

A repository verifier inventories checked-in test data, validates UTF-8 and
size, rejects disallowed binary or captured-content classes, and requires every
fixture to have an owning test. The verifier never rewrites a golden.

### Deterministic time and ordering

Unit tests use injected clocks, schedulers, barriers, or completion signals.
Integration tests use bounded named-condition waits with last-state
diagnostics. A verifier rejects direct sleep-for-readiness patterns such as an
awaited timer whose result is ignored. A real delay remains only behind a
project-owned helper whose contract makes elapsed time the test input; the test
still waits on and asserts the resulting state.

No production fallback, test-only alternate behavior, global patch, module
mock, retry, or swallowed cleanup error is introduced to make a case pass.

## Direct migration sequence

1. Add focused verifier tests for fixture size and encoding, prohibited fixture
   classes, unowned fixtures, direct wall-clock sleeps, and the explicit
   elapsed-time helper boundary. Wire them into `npm run verify`.
2. Inventory high-risk surviving contracts by owning suite and runtime and record their
   legal states, rejected states, commit point, failure state, ordering edges,
   lifetime owner, and persistence or protocol boundary in this temporary
   document while the audit is active.
3. Audit Base and Platform contracts not already owned by the Observable or
   Disposable migrations, then storage, IPC, child-process, and Electron-main
   boundaries.
4. Audit Editor, Browser, PDF, fetch/parser, and Workbench contracts. Replace
   captured or oversized fixtures with minimal synthetic text or generated
   binary data without weakening parser and rendering assertions.
5. Audit final Agent Host, Comet, optional SDK lifecycle, tool invocation,
   Session, Chat, attachment, and context contracts after legacy sources are
   deleted.
6. For every fixed defect encountered during the audit, retain a regression
   test that demonstrably fails against the faulty behavior and passes because
   of the direct fix.
7. Run every affected unit, integration, and application runtime, test type checking, changed-branch coverage, and
   repository verification, then delete this document after all criteria hold.

## Required audit evidence

For every applicable contract, tests prove:

- valid, empty, boundary, malformed, and unsupported inputs;
- every legal, rejected, repeated, and terminal state transition;
- dependency failure before and after the commit point with exact final state;
- cancellation before start and during work, timeout, late completion,
  duplicate completion, re-entry, and controlled competing orderings;
- ordinary disposal, repeated disposal, replacement, ownership transfer,
  partial construction, and cleanup failure;
- persistence round trip, restart, corruption, unsupported version, and
  interrupted write or activation;
- protocol serialization, correlation, duplicate/out-of-order messages,
  disconnect, and process exit;
- validation and permission denial before side effects plus diagnostic
  redaction; and
- externally visible UI, focus, selection, reopen, and recovery behavior when
  the contract has a user-facing boundary.

An inapplicable row is omitted only because the public contract has no such
boundary, not because the branch is hard to arrange.

## Completion and deletion criteria

This migration is complete only when:

- every surviving public contract has its applicable audit evidence in the
  owning unit or integration suite;
- every known defect fixed during the audit has a failing-before regression
  test;
- no test uses scheduler luck or a wall-clock sleep for readiness;
- every checked-in golden and textual fixture passes ownership, encoding,
  content, and size verification, and no prohibited binary or captured user
  document remains;
- no test seam introduces alternate production behavior or compatibility code;
- legacy Agent Host tests are deleted and final Agent/SDK/Session/Chat tests
  cover the target contracts directly; and
- all affected test runtimes, `npm run typecheck:tests`,
  `npm run test:coverage`, and `npm run verify` pass.

Delete this document in the same change that satisfies these criteria.
