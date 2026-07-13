---
description: Guidelines for writing code using IDisposable
applyTo: "src/cs/**/*.{ts,tsx}"
---

Core symbols:
* `IDisposable`
	* `dispose(): void` - dispose the object
* `Disposable` (implements `IDisposable`) - base class for disposable objects
	* `this._store: DisposableStore`
	* `this._register<T extends IDisposable>(t: T): T`
		* Try to immediately register created disposables! E.g. `const someDisposable = this._register(new SomeDisposable())`
* `DisposableStore` (implements `IDisposable`)
	* `add<T extends IDisposable>(t: T): T`
	* `clear()`
* `toDisposable(fn: () => void): IDisposable` - the only conversion from a
  cleanup function to an owned disposable; the returned value is not callable

* `MutableDisposable` (implements `IDisposable`)
	* `value: IDisposable | undefined`
	* `clear()`
	* A value that enters a mutable disposable (at least once) will be disposed the latest when the mutable disposable is disposed (or when the value is replaced or cleared).

Project-owned lifetime rules:

* Every class with a `dispose()` method participates explicitly in
  `IDisposable` through `Disposable`, another lifecycle-tracked required base,
  or its own `implements IDisposable`.
* Extend `Disposable` when the class hierarchy permits it and register owned
  resources immediately. Do not duplicate tracking inherited from a
  lifecycle-tracked base.
* A class whose required base is not lifecycle-tracked implements
  `IDisposable`, owns child resources in a `DisposableStore`, calls
  `trackDisposable(this)` when it is created, and calls
  `markAsDisposed(this)` at its first terminal disposed state.
* A disposable field has one explicit owner and is disposed or transferred at
  a named lifetime boundary.
* Use `toDisposable` for function-backed cleanup. Do not rely on a raw object
  with a structural `dispose()` member.
* `deleteAndLeak` and `clearAndLeak` transfer disposal responsibility to the
  caller; they neither dispose nor exempt the returned value.
* `markAsSingleton` is only for a deliberate process-lifetime singleton, never
  for test-local state.
