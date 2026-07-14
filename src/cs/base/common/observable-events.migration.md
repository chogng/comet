# Observable event bridge migration

## Temporary scope

This migration starts after the
[Observable graph kernel](observable.migration.md) is complete. It owns:

- additive public event, signal, and disposable-value contracts in
  `src/cs/base/common/observable.ts`;
- their implementation nodes under `observableInternal/**`;
- focused tests under `src/cs/base/common/test/**`;
- direct consumers of the new factories; and
- the event and signal section of
  `.github/instructions/observables.instructions.md`.

## Final project-owned target

The existing public Observable module adds:

- change-aware observable and observer contracts where an adapter has a
  meaningful change payload;
- `disposableObservableValue`;
- `observableFromEvent`;
- `observableSignalFromEvent`;
- `observableSignal`; and
- `IObservableSignal`.

These additions use the kernel's observer protocol, transaction validation,
reader ownership, equality, and disposal. They do not create a second graph or
an event-specific runner.

`disposableObservableValue` disposes its previous value exactly once on a
meaningful replacement and its current value exactly once when the observable
is disposed.

An event-backed value subscribes on its first observer, unsubscribes on its
last observer, computes current state for an unobserved `get()` without leaving
a subscription, and suppresses equality-neutral events. An event-backed signal
invalidates on every event. An explicit signal stores no history and triggers
inside the addressed transaction.

An external source event opens one Observable transaction root. Emitting that
source from an active Observable transaction, derived, or autorun is rejected;
the adapter does not start a nested or recovery transaction.

## Direct migration steps

1. Add failing conformance cases for disposable replacement, lazy event
   subscription, value equality, every-event signals, change payloads,
   re-entry, and disposal.
2. Add the public contracts and nodes directly to the one graph kernel.
3. Migrate real consumers to the semantically matching factory. Do not convert
   commands or control flow into observable state.
4. Run the Base tests and every affected consumer test, then delete this document once
   all completion criteria hold.

## Completion and deletion criteria

This migration is complete only when all event adapters use the one graph,
subscriptions are lazy and leak-free, value and signal semantics are proven
distinct, disposable replacement is exact, re-entry is rejected, every direct
consumer uses the final factory without wrappers, and all affected test runtimes,
type checking, coverage, and verification pass.

Delete this document in the same change that satisfies these criteria.
