# Comet Studio Automation Package

This package contains the reusable Playwright Electron driver and Comet Studio
page objects used by `test/smoke`. It provides application control and
observation; it does not declare tests, decide test results, retry failures, or
promote diagnostic artifacts.

## Build

Compile the package from the repository root:

```sh
npm --prefix test/automation run compile
```

The root `npm run test:smoke` command performs this compilation automatically.
The Workbench-side driver contract lives in
`src/cs/workbench/services/driver/common/driver.ts` and is copied into this
package during compilation.

## Responsibilities

- `Application` owns Electron launch, Workbench readiness, reload, and stop for
  one application instance.
- `PlaywrightDriver` implements the typed Workbench driver operations over one
  Playwright Electron application and its current main window.
- `Code` exposes test-facing commands, evaluation, and named condition waits.
- `Workbench` exposes semantic application actions and readiness checks.
- Logger implementations route automation diagnostics without deciding whether
  a test passed or failed.

Feature-specific page operations belong in the page object that owns that
surface. Smoke tests use those operations instead of duplicating launch,
readiness, reload, or low-level driver behavior.

## Lifecycle

Every consumer supplies a unique user-data directory and logs directory. The
owning smoke fixture registers cleanup before calling `Application.start()` and
owns the application together with any server, process, port, temporary root,
and cancellation state created for the test.

`Application.start()` publishes its `Code` and `Workbench` handles only for the
live application and stops the application if readiness fails. `stop()` is safe
after partial startup and repeated cleanup. Closing, reloading, or reopening a
window preserves the same explicit fixture ownership; it never transfers
resources to another test.

## Interaction and waits

Use semantic page-object operations, stable Comet-owned identifiers, and the
public Workbench driver contract. Do not reach through foreign DOM structures
or add another Browser or Electron control path beside this package.

Use `Code.waitForCondition()` with a description, bounded deadline, state read,
and acceptance predicate for correctness synchronization. A timeout reports the
last value or error. `Code.wait()` is only for a test whose explicit input is
elapsed time; it is not a readiness mechanism.
