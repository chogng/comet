# Comet Studio Smoke Tests

Smoke tests launch the built Electron application through `test/automation` and
exercise user-visible Workbench behavior across real renderer, main-process,
storage, BrowserView, and process-lifecycle boundaries.

Follow the repository's
[test-writing guidelines](../../.github/instructions/writing-test.instructions.md)
for assertions and behavioral depth. This document owns the application-specific
runner, fixture, platform, and diagnostic rules.

## Run

Run the complete smoke suite from the repository root:

```sh
npm run test:smoke
```

This is the only public smoke entry point. It builds the desktop application,
compiles `test/automation` and the smoke sources, and then executes the compiled
test files serially. Do not invoke an internal package runner directly.

Linux runs the command under `xvfb-run --auto-servernum`. macOS runs it directly
and owns the window-reopen scenarios that are platform-specific to macOS.

## Test structure

- Put a test under `src/areas/<feature>/` and name it `*.test.ts`.
- Import declarations from `node:test` and assertions from
  `node:assert/strict`; Playwright remains the Electron and Browser driver, not
  a second test runner.
- Give every leaf test `{ timeout: 120_000 }`. A timeout is a failure and is
  never caught or retried.
- Create a fresh smoke fixture inside each test and register its cleanup before
  the first fallible startup operation. Tests never share an application,
  server, port, temporary root, user-data directory, or mutable context.
- Use `TestContext.skip(reason)` followed by an explicit return when the current
  platform is unsupported. A platform-specific test must execute on its owning
  CI platform.
- Drive the application through `test/automation`, semantic roles, stable
  product identifiers, and public automation commands. Do not infer behavior
  from foreign DOM classes or walk across Part ownership boundaries.
- Assert both the user-visible result and the lifecycle consequence when a flow
  opens, hides, reloads, crashes, reconnects, or closes a resource.

## Isolation and synchronization

One test fixture owns its application, local servers, processes, ports,
temporary root, user-data directory, automation handles, and cancellation
state. Cleanup is ordered and idempotent after partial startup, renderer loss,
shared-process exit, timeout, assertion failure, and repeated disposal.

Correctness waits use a named observable condition with a bounded deadline.
Timeout errors include the last observed state. A fixed delay is allowed only
when elapsed time is the explicit test input; the assertion still waits for the
named outcome.

## Failure diagnostics

The result reporter, not the fixture, decides whether staged diagnostics are
retained. A final pass removes the test's staging data. Assertion failure,
timeout, setup or teardown failure, cancellation, and test-process loss retain
the addressed test's available failure bundle.

Retained diagnostics are synthetic, bounded, and redacted. One test may retain:

- at most 1 MiB of tail logs for each owned process;
- one screenshot no larger than 8 MiB;
- one metadata-only diagnostic JSON file no larger than 64 KiB;
- one Playwright trace no larger than 32 MiB and containing no source files;
  and
- at most 48 MiB for the complete bundle.

Credentials, cookies, authorization headers, secret query values, local user
paths, Article or PDF content, Chat transcripts, selections, and attachment
payloads are omitted or redacted before retention. Invalid, unredacted,
missing, or oversized diagnostics fail the smoke run as an infrastructure
error. CI uploads only retained failure bundles and keeps them for seven days.
