// Common lifecycle primitives shared by browser, node, and electron-main code.
// Keep this module free of DOM dependencies.

export interface DisposableLike {
  dispose(): void;
}

export interface IDisposable extends DisposableLike {}

export type Disposer = () => void;

export type DisposableHandle = DisposableLike & Disposer;

export type DisposableInput = DisposableLike | Disposer | null | undefined;

type DisposableValue = Exclude<DisposableInput, null | undefined>;

function throwDisposeErrors(errors: unknown[]): void {
  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(errors, 'Encountered errors while disposing resources.');
}

function disposeValue(input: DisposableValue): void {
  if (typeof input === 'function') {
    input();
    return;
  }

  input.dispose();
}

export function isDisposableLike(value: unknown): value is DisposableLike {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'dispose' in value &&
    typeof (value as { dispose?: unknown }).dispose === 'function'
  );
}

export function isDisposable<E>(thing: E): thing is E & IDisposable {
  return isDisposableLike(thing);
}

export function toDisposable(disposer: Disposer): DisposableHandle {
  let disposed = false;

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    disposer();
  };

  const handle = dispose as DisposableHandle;
  handle.dispose = () => {
    dispose();
  };
  return handle;
}

function isIterableDisposableInput(
  input: DisposableInput | Iterable<DisposableInput>,
): input is Iterable<DisposableInput> {
  return (
    typeof input !== 'function' &&
    typeof input === 'object' &&
    input !== null &&
    Symbol.iterator in input
  );
}

export function dispose<T extends DisposableInput>(input: T): T;
export function dispose<T extends Iterable<DisposableInput>>(input: T): T;
export function dispose<T extends DisposableInput | Iterable<DisposableInput>>(
  input: T,
): T {
  if (!input) {
    return input;
  }

  if (isIterableDisposableInput(input)) {
    disposeAll(input);
    return input;
  }

  disposeValue(input);
  return input;
}

export function disposeAll(inputs: Iterable<DisposableInput>): void {
  const values = Array.from(inputs).filter(
    (input): input is DisposableValue => input !== null && input !== undefined,
  );
  const errors: unknown[] = [];

  for (let index = values.length - 1; index >= 0; index -= 1) {
    try {
      disposeValue(values[index]);
    } catch (error) {
      errors.push(error);
    }
  }

  throwDisposeErrors(errors);
}

export function combinedDisposable(...inputs: DisposableInput[]): DisposableHandle {
  return toDisposable(() => {
    disposeAll(inputs);
  });
}

export class DisposableStore implements DisposableLike {
  private readonly entries = new Set<DisposableLike>();
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add<T extends null | undefined>(input: T): T;
  add<T extends DisposableLike>(input: T): T;
  add(input: Disposer): DisposableHandle;
  add(input: DisposableInput): DisposableInput | DisposableHandle {
    if (!input) {
      return input;
    }

    if (typeof input === 'function') {
      const disposable = toDisposable(input);
      if (this.disposed) {
        disposable.dispose();
        return disposable;
      }

      this.entries.add(disposable);
      return disposable;
    }

    const disposable = input;
    if (disposable === this) {
      throw new Error('Cannot register a disposable on itself.');
    }

    if (this.disposed) {
      disposable.dispose();
      return input;
    }

    this.entries.add(disposable);
    return input;
  }

  clear(): void {
    if (this.entries.size === 0) {
      return;
    }

    const entries = Array.from(this.entries);
    this.entries.clear();
    disposeAll(entries);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clear();
  }
}

export class MutableDisposable<T extends DisposableValue = DisposableLike>
  implements DisposableLike
{
  private currentValue: T | undefined;
  private disposed = false;

  get value(): T | undefined {
    return this.disposed ? undefined : this.currentValue;
  }

  set value(nextValue: T | undefined) {
    if (this.disposed) {
      dispose(nextValue);
      return;
    }

    if (nextValue === this.currentValue) {
      return;
    }

    const previousValue = this.currentValue;
    this.currentValue = nextValue;
    dispose(previousValue);
  }

  clear(): void {
    this.value = undefined;
  }

  clearAndLeak(): T | undefined {
    const leakedValue = this.currentValue;
    this.currentValue = undefined;
    return leakedValue;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const currentValue = this.currentValue;
    this.currentValue = undefined;
    dispose(currentValue);
  }
}

export const DisposableNone = Object.freeze<IDisposable>({
  dispose() {},
});

export function markAsSingleton<T extends IDisposable>(singleton: T): T {
  return singleton;
}

export abstract class Disposable implements IDisposable {
  private readonly _store = new DisposableStore();

  protected _register<T extends null | undefined>(input: T): T;
  protected _register<T extends DisposableLike>(input: T): T;
  protected _register(input: Disposer): DisposableHandle;
  protected _register<T extends DisposableInput>(input: T): T | DisposableHandle {
    if (!input) {
      return input;
    }

    if (typeof input === 'function') {
      return this._store.add(input);
    }

    if (Object.is(input, this)) {
      throw new Error('Cannot register a disposable on itself.');
    }

    this._store.add(input);
    return input;
  }

  dispose(): void {
    this._store.dispose();
  }
}
