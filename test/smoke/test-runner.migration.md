# Smoke test runner migration

## Temporary scope

This migration owns only the application smoke declaration and runner cutover:

- `test/smoke/src/**/*.test.ts` where tests use Mocha declarations or shared
  Mocha lifecycle state;
- `test/smoke/package.json`, `test/smoke/tsconfig.json`, and
  `test/smoke/README.md`;
- root `package.json` and `package-lock.json` for the public smoke command and
  removal of Mocha packages;
- `.github/workflows/ci.yml` for smoke invocation and the Linux/macOS smoke
  matrix; and
- the runner, declaration, timeout, and platform-skip rules in
  `.github/instructions/writing-test.instructions.md`; and
- smoke runner conformance tests.

It does not own smoke artifact promotion or automation reliability; those are
scoped by [Smoke reliability](test-reliability.migration.md).

## Boundary being replaced

Application smoke tests are the only repository suites using Mocha globals,
Mocha's `this` context, a suite-shared fixture, and a Mocha-only skip path. CI
also bypasses the public root command and invokes the package's `mocha` script
directly under Xvfb. Only Ubuntu runs, so the macOS-only reopen scenario is
permanently skipped in CI.

Playwright remains the Electron and Browser driver. It does not require Mocha
or Playwright Test to own declaration and lifecycle.

## Final project-owned target

Smoke sources import `suite`, `test`, and the required hooks from `node:test`,
plus `node:assert/strict`. Each test:

- declares `{ timeout: 120_000 }` on its own test registration;
- accepts `TestContext` only when it needs skip, diagnostics, or test-local
  cleanup;
- creates a fresh test-local fixture and registers cleanup immediately; and
- uses `context.skip(reason)` followed by an explicit return for an unsupported
  platform.

There is no suite-shared application, server, user-data directory, or mutable
context. Smoke files and cases execute serially.

`test/smoke/package.json` runs the compiled `out` directory with
`node --test --test-concurrency=1 out`. The root `npm run test:smoke` command is
the only public smoke entry point and performs the required application build,
smoke compilation, and test execution in that order. No removed Mocha command
is retained as an alias.

CI invokes the root command. A smoke matrix includes:

- Ubuntu, wrapping the root command with
  `xvfb-run --auto-servernum`; and
- macOS, invoking the root command directly and executing the macOS-only reopen
  scenario.

Both matrix entries use the same Node version and dependency lockfile. A skip
on the platform that owns a platform-only scenario is a failure of the test
contract, not accepted coverage.

## Direct migration steps

1. Convert both smoke suites to explicit `node:test` imports and options.
   Delete Mocha `this` usage instead of translating it through a wrapper.
2. Replace suite-shared state with one fixture constructed inside each test.
   Register fixture cleanup before the first fallible startup operation.
3. Replace `this.skip()` with `TestContext.skip(reason)` and an explicit
   return. Keep the macOS-only reopen assertion active on macOS.
4. Change the smoke package script to Node's runner over `out`, preserving
   serial execution and source-level per-test timeouts.
5. Update the root command directly, remove `mocha`, `@types/mocha`, Mocha
   types, and the Mocha-named package script from manifests and lockfiles.
6. Replace CI's direct package invocation with the public root command and add
   the macOS smoke matrix entry. Preserve build-before-compile-before-run
   ordering inside the root command.
7. Run smoke on Ubuntu/Xvfb and macOS, then delete this document after every
   criterion holds.

## Required conformance cases

- A smoke source with only explicit `node:test` imports is compiled and run.
- The runner executes multiple compiled files serially.
- The 120-second option belongs to every test and a timeout fails directly.
- Setup failure before application readiness still invokes the registered
  test-local cleanup.
- Two tests cannot share an application, server, port, temporary root, or
  user-data directory.
- The macOS-only case reports skipped on Ubuntu and executes on macOS.
- A compile error, spawn error, signal, or non-zero child exit fails the root
  command.
- CI calls `npm run test:smoke`; no workflow calls an internal package script.

## Completion and deletion criteria

This migration is complete only when no source, TypeScript configuration,
manifest, lockfile, script, or workflow contains a Mocha dependency, global,
type, command, or compatibility declaration; smoke runs serially through the
root command on Ubuntu and macOS; the macOS-only scenario executes in CI; and
all runner conformance cases pass.

Delete this document in the same change that satisfies these criteria.
