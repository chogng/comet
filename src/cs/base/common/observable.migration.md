# Observable graph kernel migration

## Temporary scope

This migration owns the atomic replacement of the Observable graph kernel and
the direct call-site changes required by that public API:

- `src/cs/base/common/observable.ts`;
- implementation modules created under
  `src/cs/base/common/observableInternal/**`;
- kernel cases in `src/cs/base/common/test/observable.test.ts` and compile-time
  Reader cases in `src/cs/base/common/test/observable.types.test.ts`;
- `ObserverNode` and its focused tests under `src/cs/base/browser/**`;
- `DomWidget` and its focused tests under `src/cs/platform/domWidget/**`;
- mechanical signature and import changes in every surviving source that
  imports `cs/base/common/observable`; and
- the kernel, read, transaction, derivation, reaction, and UI-effect sections
  of `.github/instructions/observables.instructions.md`.

It does not add event bridges, signals, or disposable observable values; those
belong to [Observable event bridges](observable-events.migration.md). It also
does not decide every domain's aggregate-versus-transaction boundary; that
belongs to [Observable state audit](observable-state-audit.migration.md).

Sessions files also in the
[Agent Host migration](../../sessions/agent-host.migration.md) follow that
migration's deletion boundary. Legacy `default` provider and `mainChat` code is
deleted, not ported to preserve it. Surviving Agent Host, Comet, Session, and
Chat sources call the final Observable API directly.

## Prerequisites and ownership

The directly discovered Node runtime described by
[Unit tests](../../../../test/unit/README.md) must execute the Base kernel
conformance suite before the kernel cutover. The lifecycle hooks and
`node:test` leak helper from
[Disposable tracking core](disposable-tracking.migration.md) must exist before
graph resources are accepted as leak-free.

Those migrations own discovery and lifecycle instrumentation. This migration
alone owns Observable kernel conformance; there is no reciprocal dependency or
private test runner.

## Boundary being replaced

The current implementation accepts an `unknown` transaction and ignores it,
walks observers immediately for every write, recomputes derived values on
every read, and has no begin/end update protocol. Related writes expose
intermediate states, dependency diamonds can rerun redundantly, and a derived
node notifies before knowing whether its value changed.

The current `IObservableReader` also combines dependency reads with `store`
and `delayedStore`, so `derived` and `autorun` receive the same resource
capability. Reader stores are allocated eagerly, a captured reader remains
usable after its callback returns, and tracked reads depend on a concrete
`ObservableReader` `instanceof` check instead of the public reader contract.
The current `read` also accepts `undefined` and silently becomes untracked,
while ownerless derived overloads leave class state without its real debug
identity.

The current `ObserverNode` also copies the upstream pattern of storing DOM
mutations in `derived` nodes, composing child effects through `readEffect`, and
keeping the root alive through `recomputeInitiallyAndOnChange`. Upstream's
model is internally coherent because its Observable API intentionally permits
an effectful derived to be held alive as an update mechanism. It is not the
Comet target: Comet defines `derived` as pure state and `autorun` as the
imperative sink. Copying that pattern would make the permanent purity rule
false at a foundational DOM call site.

`DomWidget.createObservable` and `instantiateObservable` similarly construct
and own disposable widgets inside `derived`. Repository search shows their
only consumers are the class's append helpers, so retaining those public
factories would preserve an abstraction with the wrong ownership semantics.

## Upstream reference decision

The upstream Observable kernel provides a sound starting point for the Reader
mechanics: its store-capable reader extends the dependency reader, its
concrete observer nodes act as readers only while their callbacks run, stores
are allocated lazily, and dependency reconciliation avoids temporarily
unobserving retained inputs. Comet adopts those mechanics under project-owned
names.

Comet does not adopt upstream's store-capable derived reader,
`derivedWithStore` compatibility helpers, or effectful-derived ownership.
It also does not retain the optional-Reader convenience that lets a tracked
read silently become untracked. Derived values remain pure and have no
resource store at either the public type or concrete runtime node. Comet also
gives a failed autorun replacement stronger ownership semantics: resources
created by the failed run are disposed, while the previous delayed resources
and recoverable dependencies remain owned until a later successful run or
final disposal.

## Atomic Reader cutover boundary

Renaming the current combined Reader is not completion. The capability split
lands atomically with every call site whose behavior depends on the old shape:

- `ObserverNode` stops obtaining cleanup ownership from a derived Reader and
  moves DOM/ref work to its live-tree autoruns;
- `DomWidget` stops constructing disposable widgets in derived computations
  and owns replacement directly in its append autorun;
- surviving Sessions projections stop implementing only `{ get, read }` and
  become ordinary kernel-derived values; projections owned by the Agent Host
  migration are deleted with their legacy sources;
- every optional Reader boundary chooses tracked `read(reader)` or untracked
  `get()` explicitly; and
- every ownerless derived call receives its real owner or an explicit string
  identity.

The same change removes Store members from `IObservableReader`, introduces
`IObservableReaderWithStore`, deletes the standalone Reader wrapper and
concrete-class tracking check, and migrates tests to the final signatures.
There is no intermediate overload, alias, cast, or effectful-derived exception
that lets an old call site survive the cutover.

## Final project-owned target

### One graph kernel

`cs/base/common/observable` is the sole public Observable module. It defines
its public contracts and factories directly; it does not re-export an internal
barrel. Implementation nodes under `observableInternal` import Comet's real
errors, lifecycle, and equality primitives. Consumers never import an internal
node, dependency facade, second implementation, compatibility overload, or
legacy alias.

The kernel consists of:

- `IObservable`, `ISettableObservable`, `IObserver`, `IObservableReader`,
  `IObservableReaderWithStore`, and `ITransaction`;
- `observableValue` and `constObservable`;
- `derived` and `derivedOpts`;
- `autorun`;
- synchronous `transaction`; and
- `isObservable`, tracked `read`, and untracked `get`.

The kernel invariants are:

- every transaction brackets affected observers with balanced begin/end
  updates, including when its callback throws;
- writes made before a throwing callback exits remain the committed state,
  reactions observe that stable state, and the original callback error then
  propagates;
- nested mutation methods receive the addressed transaction; there is no
  implicit global, nested replacement, asynchronous, or reusable transaction;
- a dependency diamond is glitch-free and one reaction runs once for one
  meaningful committed result;
- derived nodes receive dependency-only `IObservableReader` instances, are
  lazy, cache only while observed, reconcile dynamic dependencies, compare
  before notifying, and release dependencies when unobserved;
- ordinary and derived values use `Object.is` unless `derivedOpts` supplies a
  semantic comparator;
- only `IObservableReaderWithStore` passed to `autorun` exposes resource stores;
  `store` is disposed before the next run and `delayedStore` immediately after
  the replacement run;
- `autorun` executes immediately, owns its dependencies and both stores, and
  cannot prevent sibling reactions after one callback fails;
- a derived computation never mutates observable or external state;
- an autorun may mutate an external sink but never writes the Observable graph
  directly or through a service; and
- re-entry, writes from a derived or reaction, and reuse of a finished
  transaction throw synchronously. No recovery transaction is started.

Class-owned state and derivations use their owning object as debug identity.
An explicit string remains valid only for ownerless module state and focused
fixtures.

### Reader capabilities and reaction resources

The public Reader capability hierarchy, Observable subscription boundary, and
callback signatures are exact:

```ts
export interface IObserver {
	beginUpdate<T>(observable: IObservable<T>): void;
	endUpdate<T>(observable: IObservable<T>): void;
	handlePossibleChange<T>(observable: IObservable<T>): void;
	handleChange<T>(observable: IObservable<T>): void;
}

export interface IObservableReader {
	readObservable<T>(observable: IObservable<T>): T;
}

export interface IObservableReaderWithStore extends IObservableReader {
	readonly store: DisposableStore;
	readonly delayedStore: DisposableStore;
}

export interface IObservable<T> {
	get(): T;
	read(reader: IObservableReader): T;
	reportChanges(): void;
	addObserver(observer: IObserver): void;
	removeObserver(observer: IObserver): void;
}

export interface DerivedOptions<T> {
	readonly owner: object | string;
	readonly debugName?: string | (() => string);
	readonly equals?: EqualityComparer<T>;
}

derived<T>(
	owner: object | string,
	compute: (reader: IObservableReader) => T,
): IObservable<T>;
derivedOpts<T>(
	options: DerivedOptions<T>,
	compute: (reader: IObservableReader) => T,
): IObservable<T>;
autorun(run: (reader: IObservableReaderWithStore) => void): IDisposable;
```

These are capability interfaces, not two interchangeable Reader services. The
concrete derived node implements only `IObservableReader`; the concrete
autorun observer implements `IObservableReaderWithStore`. Both participate
directly in the one observer protocol while their callback is active. No
standalone Reader wrapper, compatibility implementation, or second graph is
introduced.

The extended interface is named for the capability it adds, not for the side
effect performed by its caller. There is no `IObservableEffectReader`: reading
still only tracks dependencies, while `autorun` defines the effect boundary
and owns the Stores. If another final reaction primitive needs the same
resource lifetime, it can consume `IObservableReaderWithStore` without
inventing a second effect protocol.

Every concrete Observable implements the same observer protocol.
`observable.read(reader)` delegates tracking to `reader.readObservable(this)`.
It never accepts `undefined` or falls back to an untracked read; callers use
`get()` explicitly when they do not intend to track. The active Reader
subscribes before obtaining the value so an observed derived can cache during
the read, then reconciles the dependency without temporarily unsubscribing a
retained input. Tracking never checks for a concrete Reader class.

A kernel-provided Reader rejects reads before or after its active callback and
after its owner has been disposed. The autorun Reader applies the same validity
rule to Store access. Disposing an autorun from inside its callback does not
turn later reads into untracked fallback reads; the callback must return
without using that Reader again. Consumers use the Reader supplied to their
callback; they do not implement one or retain a Reader or either Store for
later mutation.

Derived nodes own dependency subscriptions and cached values only. They do not
contain, allocate, or expose `store` or `delayedStore`. Autorun stores are
created only when requested. On a successful rerun, the previous `store` is
disposed before the callback and the previous `delayedStore` after the
callback. Final disposal releases both exactly once.

A failed autorun run is not a successful resource replacement. The unexpected
error is reported without blocking sibling reactions; resources registered in
the failed run's new `store` or `delayedStore` are disposed immediately, the
previous delayed resources remain owned, and previous plus newly read
dependencies remain observed so a later change can retry. A dependency whose
`get()` throws remains in that owned retry set; a failed read never leaves an
unowned subscription. The next successful run disposes the retained delayed
resources after installing its replacement. Disposing the autorun releases
them even if no retry succeeds.

An observed derived computation follows the same dependency rule when it
throws: it publishes and caches no candidate value, propagates the error to
the current reader, and retains its previous plus attempted dependencies until
a successful retry or its last observer is removed. An unobserved `get()` has
no live graph owner, so its temporary subscriptions are always removed in a
`finally` block, including when computation throws.

This ownership rule does not roll back arbitrary external mutations already
performed by the callback. An effect that requires atomic replacement first
constructs and validates its candidate, commits the external mutation only
after that succeeds, and registers the committed resource in the appropriate
Store. The ordinary Store from the previous run is already disposed before a
rerun; continuous replacement therefore uses `delayedStore` deliberately.

Store cleanup is attempt-all. During an internal rerun, disposal errors from
the previous ordinary Store, a failed candidate, or the replaced delayed Store
are reported without skipping the callback, abandoning owned dependencies, or
blocking sibling reactions. If the callback and cleanup both fail, each error
is preserved and reported in deterministic lifecycle order. Explicit final
`autorun.dispose()` first removes every dependency, then attempts both Stores,
and propagates the lifecycle aggregate to its caller after cleanup completes.

### Direct `ObserverNode` effect model

`ObserverNode` stores private property-effect definitions and its child
description, not effectful `IObservable` instances. Construction applies
non-reactive class, style, attributes, handlers, and statically known child
structure once. Reactive class, each reactive style property, each reactive
attribute, `tabIndex`, and `obsRef` remain separate effect definitions so one
dependency does not rerun unrelated DOM work.

`keepUpdated(store)` creates one private live-tree runtime for that root. The
runtime activates property definitions with owned `autorun` instances only
when their nodes are live. Before live activation, no reactive dependency is
observed and no `obsRef` is published. A node belongs to at most one live-tree
runtime; a second simultaneous root activation is rejected. Disposing the
runtime stops every effect, removes every dependency, releases nested nodes,
clears the active-runtime markers, and publishes each `obsRef(null)` exactly
once.

One structure autorun owned by the live-tree runtime recursively reads only
observables that decide the whole child tree and builds a candidate snapshot.
Before mutating DOM it rejects cycles and repeated object children, whether an
`ObserverNode` or a raw DOM node, so a bad snapshot leaves the previous tree
and ownership intact. It then compares each parent's child identities, updates
only changed child lists, and reconciles one activation store per
`ObserverNode` across the whole root. A retained or moved child keeps its
effect owner, a removed child is disposed after the DOM update, and a new child
is activated under the root runtime. Child attribute changes run the child's
property effects without rerunning the structure autorun.

`readEffect` and `recomputeInitiallyAndOnChange` are deleted from this path.
No public effect-compatibility helper replaces them.

### Direct `DomWidget` ownership

`createAppend` and `instantiateAppend` are the only widget construction
entries. With hot reload disabled they construct, append, and register one
widget directly. With hot reload enabled, an owned `autorun` reads the current
constructor, creates the widget, replaces the previous element atomically, and
uses delayed-store ownership so the previous widget is disposed only after its
replacement is in the DOM.

`createObservable` and `instantiateObservable` are deleted together with their
type members and call sites. A derived value never constructs or owns a
`DomWidget`.

## Direct migration steps

1. Expand the directly discovered kernel conformance suite and install the
   project leak helper. Cover transactions, dynamic dependencies, diamond
   propagation, equality-neutral results, Reader capability types, invocation
   validity, Store success and failure ordering, reactions, rejected graph
   writes, re-entry, errors, and disposal before replacing mechanics.
2. Replace the ignored transaction and immediate observer protocol with typed
   begin/end updates, possible-change versus actual-change propagation, and
   `finally` finalization. Delete the old graph classes in the same cutover.
3. Split the dependency-only `IObservableReader` passed to deriveds from the
   `IObservableReaderWithStore` passed to autoruns. Implement lazy cached
   derived nodes and the reaction node as their respective Readers over the
   one observer protocol. Delegate tracked reads through the Reader interface,
   lazily allocate autorun stores, invalidate escaped Readers, and reject graph
   mutation from active computations and reactions.
4. Migrate every surviving import and mechanical call shape directly:
   class-owned factories receive their owner, reactive callbacks use
   `.read(reader)`, imperative boundaries use `.get()`, set calls receive
   `ITransaction | undefined`, and every autorun is registered immediately.
   Do not add overloads for the old signatures.
5. Replace `ObserverNode`'s derived-effect storage with private property effects
   and one live-tree structure runtime. Reconcile node identity across the
   entire root and validate candidate snapshots before DOM mutation. Delete
   `readEffect` and all `recomputeInitiallyAndOnChange` use.
6. Delete the two observable-producing `DomWidget` methods. Implement hot
   replacement directly in the append autoruns and preserve replacement-before-
   disposal ordering.
7. Delete legacy Agent Host consumers through their owning migration and
   compile surviving Sessions consumers directly against the kernel.
8. Run the Base common, Base browser, Platform DOM widget, and all other
   affected tests, test type checking, and layer verification. Delete this
   document after every criterion holds.

## Call-site decisions

| Existing pattern | Direct target |
|---|---|
| class field `observableValue('name', value)` | `observableValue(this, value)` |
| class-owned `derived(reader => value)` | `derived(this, reader => value)` |
| ownerless `derived(reader => value)` | `derived('debugIdentity', reader => value)` |
| `.get()` inside `derived` or `autorun` | `.read(reader)` |
| `.read(optionalReader)` | an explicit `reader === undefined ? observable.get() : observable.read(reader)` boundary |
| locally created unregistered autorun | immediate registration by its real owner |
| `reader.store` or `reader.delayedStore` inside `derived` | move the resource and its external mutation into an owned `autorun` |
| Reader retained beyond its callback | retain the computed value or an explicitly owned resource instead |
| hand-built `{ get, read }` Observable projection | a kernel-derived value, or a real graph primitive implementing the complete observer protocol |
| effectful `derived` | pure `derived` data plus an owned `autorun` sink |
| `ObserverNode.readEffect` composition | one private live-tree runtime with property effects and whole-tree identity reconciliation |
| `DomWidget.createObservable` or `instantiateObservable` | direct owned construction in the append method |
| legacy source already scheduled for deletion | deletion by its owning migration |

## Required conformance cases

### Graph kernel

- compile-time signatures expose dependency reads only in `derived` and expose
  both stores in `autorun`; accessing a Store from a derived Reader fails test
  type checking without an alias, overload, or cast in production code;
- ownerless `derived(compute)` and `derivedOpts` without an owner object or
  explicit ownerless string identity fail test type checking;
- `read(undefined)` fails test type checking; an untracked read uses `get()`
  explicitly;
- `observable.read(reader)` delegates through the public Reader contract, and
  tracked reads do not depend on a concrete-class identity check;
- tracked reads subscribe before `get()`, retain caching across the read, and
  reconcile successful dynamic dependencies without an observe/unobserve gap;
- concrete derived nodes have no Store capability or Store allocation, while
  autorun stores are allocated only when requested;
- a captured derived or autorun Reader rejects reads after its callback, and a
  captured autorun Reader also rejects later Store access;
- disposing an autorun during its callback makes every later Reader or Store
  access in that callback fail instead of silently becoming untracked;
- balanced finalization after success and callback throw;
- committed pre-throw writes followed by propagation of the original error;
- nested addressed mutation, finished-transaction reuse, re-entry, and
  rejected writes from deriveds and autoruns;
- dynamic dependency removal and observed-cache release;
- glitch-free diamonds and one reaction per meaningful commit;
- equality-neutral value and derived changes;
- immediate autorun, both Reader Store disposal orders, idempotent reaction
  disposal, and sibling progress after a failing reaction;
- a throwing rerun cleanup is reported after attempting all entries and does
  not skip the replacement callback, lose dependencies, or block siblings;
- explicit final reaction disposal removes dependencies, attempts both Stores,
  and propagates cleanup failures only after completing all cleanup;
- a failed initial autorun disposes every resource it registered, while a
  failed rerun disposes its new resources, retains the previous delayed
  resources and recoverable dependency union, and releases the retained
  resources after the next successful run or final disposal;
- a dependency `get()` that throws leaves no subscription outside the
  reaction's owned retry set;
- a throwing observed derived publishes no candidate value and retains its
  recoverable dependency union, while a throwing unobserved `get()` removes
  every temporary subscription; and
- no tracked graph node, reader resource, or reaction surviving its test.

### `ObserverNode`

- static DOM is correct before live activation without observing reactive
  inputs;
- reactive class, individual style, attribute, `tabIndex`, and child changes
  update only their addressed effects;
- `obsRef` publishes on activation and clears exactly once on disposal;
- retained dynamic children keep their effects, removed children stop
  updating, and new children activate;
- moving a child between parents in one committed tree keeps one activation
  owner regardless of reaction order;
- child attribute updates do not rebuild parent children;
- duplicate placement, child cycles, and simultaneous root activation are
  rejected before changing the previous live tree, and a later valid snapshot
  can still commit; and
- disposing the live element prevents every later DOM update.

### `DomWidget`

- normal construction appends and disposes one widget;
- hot replacement installs the new element before disposing the previous
  widget;
- constructor or instantiation failure leaves the previous live widget and
  reports the error according to the hot-reload contract; and
- append-owner disposal removes and disposes the final widget exactly once.

## Behavior that must be preserved

- Existing public DOM creation and live-element APIs keep their user-visible
  behavior.
- Static DOM work remains eager; reactive DOM work remains lazy until live.
- Dynamic child dependencies remain fine-grained and stop after removal.
- Hot reload replaces widgets without a blank intermediate DOM state.
- `constObservable`, `derivedOpts`, `isObservable`, tracked `read`, and
  untracked `get` remain available as final kernel contracts.

## Completion and deletion criteria

This migration is complete only when:

- `ISettableObservable.set` uses `ITransaction | undefined` and one graph
  implements every kernel invariant;
- no old graph class, alternate import path, facade, global or async
  transaction, ignored transaction, or compatibility overload remains;
- the exact Reader capability signatures type-check, tracking delegates
  through `IObservableReader`, no concrete Reader identity check remains, and
  `read(undefined)` and escaped Readers fail outside their valid contracts;
- all surviving call sites use final owner/read/registration signatures and no
  consumer imports `observableInternal`;
- no derived mutates the graph or an external sink and no autorun writes the
  graph, and the derived reader exposes no resource store;
- `ObserverNode` contains no side-effecting derived, `readEffect`, or
  `recomputeInitiallyAndOnChange` path and passes its full conformance matrix;
- `DomWidget` contains neither observable-producing factory and passes its
  ownership matrix;
- legacy `default` and `mainChat` consumers are deleted rather than adapted;
- every scoped test, test type checking, coverage, and layer verification
  passes; and
- the durable Observable instruction describes only the implemented target.

Delete this document in the same change that satisfies these criteria.
