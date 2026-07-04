import {
  type CancellationToken,
  CancellationTokenNone,
  CancellationTokenSource,
} from './cancellation.js';
import { BugIndicatingError, CancellationError, isCancellationError } from './errors.js';
import { Emitter, Event } from './event.js';
import { Lazy } from './lazy.js';
import {
  DisposableStore,
  isDisposable,
  toDisposable,
  type IDisposable,
} from './lifecycle.js';
import { extUri as defaultExtUri, type IExtUri } from './resources.js';
import { URI } from './uri.js';

/**
 * 提供 base/common 层可复用的异步控制工具：
 * - Promise 取消、超时竞态、延迟触发
 * - 串行执行、按 key 串行、限流与队列 drain 通知
 * - 按 URI 隔离的资源队列，避免同一资源并发写入
 * - idle 调度、DeferredPromise、StatefulPromise 与 lazy promise 状态读取
 */

export type Thenable<T> = PromiseLike<T>;

export function isThenable<T>(obj: unknown): obj is Promise<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'then' in obj &&
    typeof (obj as { then?: unknown }).then === 'function'
  );
}

export interface CancelablePromise<T> extends Promise<T> {
  cancel(): void;
}

export function createCancelablePromise<T>(
  callback: (token: CancellationToken) => Promise<T>,
): CancelablePromise<T> {
  const source = new CancellationTokenSource();

  const thenable = callback(source.token);
  let isCancelled = false;

  const promise = new Promise<T>((resolve, reject) => {
    const subscription = source.token.onCancellationRequested(() => {
      isCancelled = true;
      subscription.dispose();
      reject(new CancellationError());
    });

    Promise.resolve(thenable).then(
      (value) => {
        subscription.dispose();
        source.dispose();

        if (!isCancelled) {
          resolve(value);
        } else if (isDisposable(value)) {
          value.dispose();
        }
      },
      (error) => {
        subscription.dispose();
        source.dispose();
        reject(error);
      },
    );
  });

  return Object.assign(promise, {
    cancel() {
      source.cancel();
      source.dispose();
    },
  });
}

export function raceCancellation<T>(
  promise: Promise<T>,
  token: CancellationToken,
): Promise<T | undefined>;
export function raceCancellation<T>(
  promise: Promise<T>,
  token: CancellationToken,
  defaultValue: T,
): Promise<T>;
export function raceCancellation<T>(
  promise: Promise<T>,
  token: CancellationToken,
  defaultValue?: T,
): Promise<T | undefined> {
  if (token.isCancellationRequested) {
    return Promise.resolve(defaultValue);
  }

  return new Promise<T | undefined>((resolve, reject) => {
    const disposable = token.onCancellationRequested(() => {
      disposable.dispose();
      resolve(defaultValue);
    });

    promise.then(
      (value) => {
        disposable.dispose();
        resolve(value);
      },
      (error) => {
        disposable.dispose();
        reject(error);
      },
    );
  });
}

export function raceCancellationError<T>(
  promise: Promise<T>,
  token: CancellationToken,
): Promise<T> {
  if (token.isCancellationRequested) {
    return Promise.reject(new CancellationError());
  }

  return new Promise<T>((resolve, reject) => {
    const disposable = token.onCancellationRequested(() => {
      disposable.dispose();
      reject(new CancellationError());
    });

    promise.then(
      (value) => {
        disposable.dispose();
        resolve(value);
      },
      (error) => {
        disposable.dispose();
        reject(error);
      },
    );
  });
}

export function rejectIfNotCanceled(error: unknown): undefined {
  if (!isCancellationError(error)) {
    throw error;
  }

  return undefined;
}

export function notCancellablePromise<T>(
  promise: CancelablePromise<T>,
): Promise<T> {
  return promise.then((value) => value);
}

export function raceCancellablePromises<T>(
  cancellablePromises: (CancelablePromise<T> | Promise<T>)[],
): CancelablePromise<T> {
  const promise = Promise.race(cancellablePromises);
  return Object.assign(promise, {
    cancel() {
      for (const cancellablePromise of cancellablePromises) {
        if ('cancel' in cancellablePromise) {
          cancellablePromise.cancel();
        }
      }
    },
  });
}

export function raceTimeout<T>(
  promise: Promise<T>,
  timeoutMillis: number,
  onTimeout?: () => void,
): Promise<T | undefined> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    handle = setTimeout(() => {
      onTimeout?.();
      resolve(undefined);
    }, timeoutMillis);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (handle) {
      clearTimeout(handle);
    }
  });
}

export function asPromise<T>(callback: () => T | Thenable<T>): Promise<T> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export interface ITask<T> {
  (): T;
}

export interface ICancellableTask<T> {
  (token: CancellationToken): T;
}

export class Throttler implements IDisposable {
  private activePromise: Promise<unknown> | null = null;
  private queuedPromise: Promise<unknown> | null = null;
  private queuedPromiseFactory: ITask<Promise<unknown>> | null = null;

  queue<T>(promiseFactory: ITask<Promise<T>>): Promise<T> {
    if (this.activePromise) {
      this.queuedPromiseFactory = promiseFactory;
      if (!this.queuedPromise) {
        this.queuedPromise = new Promise((resolve, reject) => {
          this.activePromise?.then(() => {
            this.queuedPromise = null;
            const nextFactory = this.queuedPromiseFactory;
            this.queuedPromiseFactory = null;
            if (!nextFactory) {
              resolve(undefined);
              return;
            }
            this.queue(nextFactory).then(resolve, reject);
          }, reject);
        });
      }
      return this.queuedPromise as Promise<T>;
    }

    this.activePromise = promiseFactory();
    return this.activePromise.finally(() => {
      this.activePromise = null;
    }) as Promise<T>;
  }

  dispose(): void {
    this.queuedPromiseFactory = null;
  }
}

export class Sequencer {
  private current = Promise.resolve<unknown>(null);

  queue<T>(promiseTask: ITask<Promise<T>>): Promise<T> {
    const run = this.current.then(promiseTask, promiseTask);
    this.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class SequencerByKey<TKey> {
  private readonly promiseMap = new Map<TKey, Promise<unknown>>();

  queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
    const current = this.promiseMap.get(key) ?? Promise.resolve();
    const next = current.then(promiseTask, promiseTask);
    this.promiseMap.set(
      key,
      next.finally(() => {
        if (this.promiseMap.get(key) === next) {
          this.promiseMap.delete(key);
        }
      }),
    );
    return next;
  }
}

export interface LatestAsyncOperationToken {
  isCurrent(): boolean;
}

/**
 * Tracks the latest async operation so older callbacks can detect that they are stale.
 */
export class LatestAsyncOperation {
  private currentOperationId = 0;

  begin(): LatestAsyncOperationToken {
    const operationId = ++this.currentOperationId;
    return {
      isCurrent: () => this.currentOperationId === operationId,
    };
  }
}

export class Delayer<T> implements IDisposable {
  private completionPromise: Promise<T> | null = null;
  private doResolve: ((value: T | PromiseLike<T>) => void) | null = null;
  private doReject: ((error?: unknown) => void) | null = null;
  private task: ITask<T | Promise<T>> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(public defaultDelay: number) {}

  trigger(task: ITask<T | Promise<T>>, delay = this.defaultDelay): Promise<T> {
    this.task = task;
    this.cancelTimeout();

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T>((resolve, reject) => {
        this.doResolve = resolve;
        this.doReject = reject;
      }).finally(() => {
        this.completionPromise = null;
        this.doResolve = null;
        this.doReject = null;
      });
    }

    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      const currentTask = this.task;
      this.task = null;
      if (!currentTask) {
        return;
      }

      Promise.resolve(currentTask()).then(this.doResolve!, this.doReject!);
    }, delay);

    return this.completionPromise;
  }

  isTriggered(): boolean {
    return this.timeoutHandle !== null;
  }

  cancel(): void {
    this.cancelTimeout();
    this.completionPromise = null;
    this.task = null;
    this.doResolve = null;
    this.doReject = null;
  }

  dispose(): void {
    this.cancel();
  }

  private cancelTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}

export class ThrottledDelayer<T> {
  private readonly delayer: Delayer<T>;
  private readonly throttler = new Throttler();

  constructor(defaultDelay: number) {
    this.delayer = new Delayer(defaultDelay);
  }

  trigger(promiseFactory: ITask<Promise<T>>, delay?: number): Promise<T> {
    return this.delayer.trigger(
      () => this.throttler.queue(promiseFactory),
      delay,
    );
  }

  cancel(): void {
    this.delayer.cancel();
  }

  dispose(): void {
    this.delayer.dispose();
    this.throttler.dispose();
  }
}

export class Barrier {
  private readonly promiseState = promiseWithResolvers<boolean>();
  private openValue = false;

  isOpen(): boolean {
    return this.openValue;
  }

  open(): void {
    if (!this.openValue) {
      this.openValue = true;
      this.promiseState.resolve(true);
    }
  }

  wait(): Promise<boolean> {
    return this.promiseState.promise;
  }
}

export class AutoOpenBarrier extends Barrier {
  private readonly timeoutHandle: ReturnType<typeof setTimeout>;

  constructor(autoOpenTimeMs: number) {
    super();
    this.timeoutHandle = setTimeout(() => this.open(), autoOpenTimeMs);
  }

  override open(): void {
    clearTimeout(this.timeoutHandle);
    super.open();
  }
}

export function timeout(millis: number): CancelablePromise<void>;
export function timeout(
  millis: number,
  token: CancellationToken,
): Promise<void>;
export function timeout(
  millis: number,
  token?: CancellationToken,
): CancelablePromise<void> | Promise<void> {
  if (token) {
    return raceCancellationError(timeout(millis), token);
  }

  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, millis);
  });

  return Object.assign(promise, {
    cancel() {
      if (handle) {
        clearTimeout(handle);
      }
    },
  });
}

export function disposableTimeout(
  handler: () => void,
  timeoutMillis = 0,
  store?: DisposableStore,
): IDisposable {
  const handle = setTimeout(handler, timeoutMillis);
  const disposable = toDisposable(() => clearTimeout(handle));
  store?.add(disposable);
  return disposable;
}

export async function sequence<T>(
  promiseFactories: ITask<Promise<T>>[],
): Promise<T[]> {
  const result: T[] = [];
  for (const factory of promiseFactories) {
    result.push(await factory());
  }
  return result;
}

export async function first<T>(
  promiseFactories: ITask<Promise<T>>[],
  shouldStop: (value: T) => boolean = (value) => Boolean(value),
  defaultValue: T | null = null,
): Promise<T | null> {
  for (const factory of promiseFactories) {
    const result = await factory();
    if (shouldStop(result)) {
      return result;
    }
  }

  return defaultValue;
}

export async function firstParallel<T>(
  promiseList: Promise<T>[],
  shouldStop: (value: T) => boolean = (value) => Boolean(value),
  defaultValue: T | null = null,
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let pending = promiseList.length;
    if (pending === 0) {
      resolve(defaultValue);
      return;
    }

    for (const promise of promiseList) {
      promise.then(
        (value) => {
          pending -= 1;
          if (shouldStop(value)) {
            resolve(value);
          } else if (pending === 0) {
            resolve(defaultValue);
          }
        },
        reject,
      );
    }
  });
}

async function settled<T>(promises: Promise<T>[]): Promise<T[]> {
  let firstError: unknown;

  const result = await Promise.all(
    promises.map((promise) =>
      promise.then(
        (value) => value,
        (error) => {
          if (typeof firstError === 'undefined') {
            firstError = error;
          }

          return undefined;
        },
      ),
    ),
  );

  if (typeof firstError !== 'undefined') {
    throw firstError;
  }

  return result as T[];
}

export const Promises = {
  settled,
};

export interface ILimiter<T> {
  readonly size: number;
  readonly onDrained: Event<void>;
  whenIdle(): Promise<void>;
  queue(factory: ITask<Promise<T>>): Promise<T>;
}

type LimiterEntry<T> = {
  readonly factory: ITask<Promise<T>>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (error?: unknown) => void;
};

/**
 * Runs queued tasks up to a maximum concurrency and fires drain when all owned work is done.
 */
export class Limiter<T> implements ILimiter<T>, IDisposable {
  private sizeValue = 0;
  private disposed = false;
  private runningPromises = 0;
  private readonly outstandingPromises: LimiterEntry<T>[] = [];
  private readonly onDrainedEmitter = new Emitter<void>();

  constructor(private readonly maxDegreeOfParalellism: number) {}

  get size(): number {
    return this.sizeValue;
  }

  get onDrained(): Event<void> {
    return this.onDrainedEmitter.event;
  }

  whenIdle(): Promise<void> {
    if (this.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      Event.once(this.onDrained)(resolve);
    });
  }

  queue(factory: ITask<Promise<T>>): Promise<T> {
    if (this.disposed) {
      throw new Error('Object has been disposed');
    }

    this.sizeValue += 1;

    return new Promise<T>((resolve, reject) => {
      this.outstandingPromises.push({ factory, resolve, reject });
      this.consume();
    });
  }

  private consume(): void {
    if (this.disposed) {
      return;
    }

    while (
      this.outstandingPromises.length > 0 &&
      this.runningPromises < this.maxDegreeOfParalellism
    ) {
      const entry = this.outstandingPromises.shift()!;
      this.runningPromises += 1;
      entry.factory().then(entry.resolve, entry.reject).finally(() => {
        this.consumed();
      });
    }
  }

  private consumed(): void {
    if (this.disposed) {
      return;
    }

    this.runningPromises -= 1;
    this.sizeValue -= 1;
    if (this.sizeValue === 0) {
      this.onDrainedEmitter.fire();
    }
    this.consume();
  }

  clear(): void {
    if (this.disposed) {
      throw new Error('Object has been disposed');
    }

    this.outstandingPromises.length = 0;
    this.sizeValue = this.runningPromises;
  }

  dispose(): void {
    this.disposed = true;
    this.outstandingPromises.length = 0;
    this.sizeValue = 0;
    this.onDrainedEmitter.dispose();
  }
}

export class Queue<T> extends Limiter<T> {
  constructor() {
    super(1);
  }
}

/**
 * Maintains one serial queue per URI so matching resources run in order while different resources stay independent.
 */
export class ResourceQueue implements IDisposable {
  private readonly queues = new Map<string, Queue<void>>();
  private readonly drainers = new Set<DeferredPromise<void>>();
  private readonly drainListeners = new Map<string, IDisposable>();

  async whenDrained(): Promise<void> {
    if (this.isDrained()) {
      return;
    }

    const promise = new DeferredPromise<void>();
    this.drainers.add(promise);
    return promise.p;
  }

  queueSize(resource: URI, extUri: IExtUri = defaultExtUri): number {
    const key = extUri.getComparisonKey(resource);
    return this.queues.get(key)?.size ?? 0;
  }

  queueFor(
    resource: URI,
    factory: ITask<Promise<void>>,
    extUri: IExtUri = defaultExtUri,
  ): Promise<void> {
    const key = extUri.getComparisonKey(resource);

    let queue = this.queues.get(key);
    if (!queue) {
      queue = new Queue<void>();
      let drainListener: IDisposable;
      drainListener = Event.once(queue.onDrained)(() => {
        drainListener.dispose();
        queue?.dispose();
        this.queues.delete(key);
        this.drainListeners.delete(key);
        this.onDidQueueDrain();
      });
      this.drainListeners.set(key, drainListener);
      this.queues.set(key, queue);
    }

    return queue.queue(factory);
  }

  dispose(): void {
    for (const queue of this.queues.values()) {
      queue.dispose();
    }

    this.queues.clear();

    for (const listener of this.drainListeners.values()) {
      listener.dispose();
    }

    this.drainListeners.clear();
    this.releaseDrainers();
  }

  private isDrained(): boolean {
    for (const queue of this.queues.values()) {
      if (queue.size > 0) {
        return false;
      }
    }

    return true;
  }

  private onDidQueueDrain(): void {
    if (this.isDrained()) {
      this.releaseDrainers();
    }
  }

  private releaseDrainers(): void {
    for (const drainer of this.drainers) {
      drainer.complete();
    }

    this.drainers.clear();
  }
}

export type Task<T = void> = () => Promise<T> | T;
export type MaybePromise<T> = Promise<T> | T;

export class TaskQueue {
  private readonly queue = new Queue<unknown>();

  queueTask<T>(task: Task<T>): Promise<T> {
    return this.queue.queue(() => Promise.resolve(task())) as Promise<T>;
  }
}

export class TimeoutTimer implements IDisposable {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(runner?: () => void, timeoutMillis?: number) {
    if (runner && typeof timeoutMillis === 'number') {
      this.setIfNotSet(runner, timeoutMillis);
    }
  }

  dispose(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }

  cancelAndSet(runner: () => void, timeoutMillis: number): void {
    this.cancel();
    this.setIfNotSet(runner, timeoutMillis);
  }

  setIfNotSet(runner: () => void, timeoutMillis: number): void {
    if (this.handle) {
      return;
    }

    this.handle = setTimeout(() => {
      this.handle = null;
      runner();
    }, timeoutMillis);
  }
}

export class IntervalTimer implements IDisposable {
  private handle: ReturnType<typeof setInterval> | null = null;

  dispose(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  cancelAndSet(
    runner: () => void,
    intervalMillis: number,
    target: Pick<typeof globalThis, 'setInterval'> = globalThis,
  ): void {
    this.cancel();
    this.handle = target.setInterval(runner, intervalMillis);
  }
}

export class RunOnceScheduler<
  Runner extends (...args: unknown[]) => unknown = () => unknown,
> implements IDisposable {
  private timeoutToken: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly runner: Runner,
    private readonly timeoutMillis: number,
  ) {}

  dispose(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.timeoutToken) {
      clearTimeout(this.timeoutToken);
      this.timeoutToken = null;
    }
  }

  schedule(delay = this.timeoutMillis): void {
    this.cancel();
    this.timeoutToken = setTimeout(() => {
      this.timeoutToken = null;
      this.runner();
    }, delay);
  }

  isScheduled(): boolean {
    return this.timeoutToken !== null;
  }

  flush(): void {
    if (!this.timeoutToken) {
      return;
    }

    this.cancel();
    this.runner();
  }
}

export class RunOnceWorker<T> extends RunOnceScheduler<() => void> {
  private readonly units: T[] = [];

  constructor(
    runner: (units: T[]) => void,
    timeoutMillis: number,
  ) {
    super(() => {
      const units = this.units.splice(0, this.units.length);
      runner(units);
    }, timeoutMillis);
  }

  work(unit: T): void {
    this.units.push(unit);
    if (!this.isScheduled()) {
      this.schedule();
    }
  }
}

export interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleTarget = Window | typeof globalThis;

type RunWhenIdle = (
  target: IdleTarget,
  callback: (deadline: IdleDeadline) => void,
  timeout?: number,
) => IDisposable;

let runWhenIdleImpl: RunWhenIdle = (target, callback, timeoutMillis) => {
  const start = Date.now();
  const handle = target.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 16 - (Date.now() - start)),
    });
  }, timeoutMillis ?? 0);
  return toDisposable(() => clearTimeout(handle));
};

export function runWhenIdle(
  callback: (deadline: IdleDeadline) => void,
  timeoutMillis?: number,
): IDisposable {
  return runWhenIdleImpl(globalThis, callback, timeoutMillis);
}

export const _runWhenIdle: RunWhenIdle = (target, callback, timeoutMillis) =>
  runWhenIdleImpl(target, callback, timeoutMillis);

export function installFakeRunWhenIdle(fakeImpl: RunWhenIdle): IDisposable {
  const previous = runWhenIdleImpl;
  runWhenIdleImpl = fakeImpl;
  return toDisposable(() => {
    runWhenIdleImpl = previous;
  });
}

export abstract class AbstractIdleValue<T> {
  private didRun = false;
  private value?: T;

  protected constructor(executor: () => T);
  protected constructor(targetWindow: IdleTarget, executor: () => T);
  protected constructor(
    targetOrExecutor: IdleTarget | (() => T),
    executor?: () => T,
  ) {
    this.executor = typeof targetOrExecutor === 'function' ? targetOrExecutor : executor!;
  }

  private readonly executor: () => T;

  getValue(): T {
    if (!this.didRun) {
      this.didRun = true;
      this.value = this.executor();
    }

    return this.value as T;
  }
}

export class GlobalIdleValue<T> extends AbstractIdleValue<T> {
  constructor(executor: () => T) {
    super(executor);
  }
}

export type ValueCallback<T = unknown> = (value: T | Promise<T>) => void;

/**
 * Wraps a promise and records its settled value or error for synchronous reads after completion.
 */
export class StatefulPromise<T> {
  private currentValue: T | undefined;
  private currentError: unknown;
  private settled = false;
  private rejected = false;

  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise.then(
      (value) => {
        this.currentValue = value;
        this.settled = true;
        return value;
      },
      (error) => {
        this.currentError = error;
        this.settled = true;
        this.rejected = true;
        throw error;
      },
    );
  }

  get value(): T | undefined {
    return this.currentValue;
  }

  get error(): unknown {
    return this.currentError;
  }

  get isResolved(): boolean {
    return this.settled;
  }

  requireValue(): T {
    if (!this.settled) {
      throw new BugIndicatingError('Promise is not resolved yet');
    }

    if (this.rejected) {
      throw this.currentError;
    }

    return this.currentValue as T;
  }
}

/**
 * Creates the stateful promise only when the promise or resolved value is requested.
 */
export class LazyStatefulPromise<T> {
  private readonly promise = new Lazy(() => new StatefulPromise(this.compute()));

  constructor(private readonly compute: () => Promise<T>) {}

  requireValue(): T {
    return this.promise.value.requireValue();
  }

  getPromise(): Promise<T> {
    return this.promise.value.promise;
  }

  get currentValue(): T | undefined {
    return this.promise.rawValue?.value;
  }
}

export class DeferredPromise<T> {
  private readonly state = promiseWithResolvers<T>();
  private settled = false;

  readonly p = this.state.promise;

  get isSettled(): boolean {
    return this.settled;
  }

  complete(value: T | Promise<T>): void {
    this.settled = true;
    this.state.resolve(value);
  }

  error(error: unknown): void {
    this.settled = true;
    this.state.reject(error);
  }
}

export function createTimeout(ms: number, callback: () => void): IDisposable {
  const handle = setTimeout(callback, ms);
  return toDisposable(() => clearTimeout(handle));
}

export { CancellationTokenNone, CancellationTokenSource };
