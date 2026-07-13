---
description: Comet observable state, derivation, transaction, event bridge, and lifetime rules.
applyTo: "src/cs/**/*.{ts,tsx}"
---

# Observables

`cs/base/common/observable` is the public Observable API. Consumers never
import implementation modules under `observableInternal`.

## State and ownership

- Use `observableValue(owner, initialValue)` for ordinary mutable state.
- Use `disposableObservableValue(owner, initialValue)` when the stored value is
  disposable. Replacing the value disposes the previous value, and disposing
  the observable disposes its current value.
- Pass the object that owns the state as `owner`. Use an explicit debug name
  only for genuinely ownerless module state and focused test fixtures.
- Use `constObservable(value)` only when a public contract requires an
  observable whose value never changes.
- Prefer one observable aggregate when several fields form one authoritative
  state value. Do not duplicate authority across observables and then use a
  transaction to hide the duplication.

## Tracked and untracked reads

- Use `observable.read(reader)` inside `derived` and `autorun`. The read records
  a dependency and makes the computation react to later changes.
- Use `observable.get()` only at an imperative boundary where no reader exists
  and no reactive dependency is intended.
- A `derived` computation is pure observable state derivation. It does not set
  another observable, dispatch control flow, or invoke an external mutation.
- The reader passed to `derived` exposes dependency reads only. Resource stores
  are not part of the derived reader contract.
- The `IReaderWithStore` passed to `autorun` exposes `store` and
  `delayedStore`. `store` owns resources until just before the next run;
  `delayedStore` keeps previous resources through the replacement run and
  disposes them immediately afterwards. Both dispose with the autorun.

## Updates and transactions

- A single independent value may be updated with `set(value, undefined)`.
- Use `transaction(tx => { ... })` whenever multiple observable writes form
  one synchronous state transition, and pass `tx` to every participating
  write.
- Transactions are synchronous. Do not retain a transaction, pass it to an
  asynchronous callback, or hold it across `await`.
- Do not start a second transaction inside an active transaction. Pass the
  addressed `ITransaction` to nested mutation methods so the whole operation
  has one commit boundary.
- Reusing a finished transaction is a programming error. It fails directly;
  the Observable layer does not create a recovery transaction.
- If a transaction callback throws, the transaction still finalizes and the
  original error propagates after observers receive the committed state.
- Reactions observe the committed state, never an intermediate combination of
  values. A dependency diamond does not expose a glitch, and one transaction
  does not rerun the same reaction once per participating write.
- Equality-neutral derived results do not invalidate downstream reactions.
  The default comparator is `Object.is`; use an explicit equality comparator
  only when the value's semantic equality differs.

## Derivations and reactions

- Use `derived(owner, reader => value)` to combine or transform observable
  state. Use `derivedOpts` only when a stable debug name or equality comparator
  is required.
- A derived value is lazy. It is cached while observed, tracks dynamic
  dependencies, and releases its dependencies when it becomes unobserved.
- `autorun` executes immediately and again after a tracked dependency commits
  a meaningful change. Register its disposable immediately with the owning
  `Disposable` or `DisposableStore`.
- An autorun is an imperative sink. It may update DOM or another external
  resource, but it does not write to the Observable graph directly or through
  another service. Use `derived` for reactive values and an explicit domain
  mutation for state changes.
- Disposing an autorun removes every dependency and disposes both reader
  stores. One failing reaction is reported through the unexpected-error
  handler and does not prevent other reactions from observing the commit.

## UI effects and owned resources

- Reactive DOM mutation is an `autorun` effect owned by the live view. Do not
  encode class, style, attribute, child, focus, or ref mutation in `derived`.
- A DOM builder may store private effect definitions while detached. It starts
  their autoruns only when the element becomes live and disposes them when the
  live owner is removed.
- Keep independent DOM properties in independent effects. A class change must
  not rebuild children, and a child attribute change must not rerun the parent
  child-structure effect.
- One live root owns one structure effect that validates the full candidate
  child tree before mutating DOM. Reconcile effect ownership by node identity:
  retained or moved children stay active, removed children are disposed, and
  new children activate under the root. Reject duplicate nodes, cycles, and a
  second simultaneous live root for the same node.
- Constructing, replacing, or disposing a widget is an effect. A derived may
  select a constructor or data value, but it never creates or owns a widget,
  DOM node, editor, process, subscription, or other disposable resource.
- Install a replacement before disposing the resource it replaces when the UI
  contract requires continuous visible content. Register both the reaction and
  its current resource with their real lifetime owner.

## Events and signals

- Use `observableFromEvent(owner, event, computeValue)` when the event exposes
  state and dependents should rerun only when the computed value changes.
- Use `observableSignalFromEvent(owner, event)` when every event occurrence is
  an invalidation, even if a separately computed value remains equal.
- Use `observableSignal(owner)` for explicit invalidation without a stored
  value, and call `trigger(tx)` inside the state transition that caused it.
- Event-backed observables subscribe on their first observer and unsubscribe
  on their last observer. An unobserved `get()` computes current state without
  leaving a subscription behind.
- An event adapter is a transaction root for an external event. Do not fire its
  source event from inside an Observable transaction or reaction. State born
  inside an Observable transition stays in the graph or triggers an explicit
  signal with the addressed transaction.
- Events continue to represent occurrences. Do not convert command or control
  flow into observable state merely to sequence components.

## Example

```ts
class ExampleModel extends Disposable {
	private readonly width = observableValue(this, 0);
	private readonly height = observableValue(this, 0);
	readonly area = derived(this, reader => (
		this.width.read(reader) * this.height.read(reader)
	));

	constructor(private readonly render: (area: number) => void) {
		super();
		this._register(autorun(reader => {
			this.render(this.area.read(reader));
		}));
	}

	resize(width: number, height: number): void {
		transaction(tx => {
			this.width.set(width, tx);
			this.height.set(height, tx);
		});
	}
}
```
