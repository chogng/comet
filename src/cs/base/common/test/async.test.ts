import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CancellationTokenSource,
  Delayer,
  LazyStatefulPromise,
  LatestAsyncOperation,
  Limiter,
  Promises,
  ResourceQueue,
  RunOnceScheduler,
  createCancelablePromise,
  timeout,
} from 'cs/base/common/async';
import { URI } from 'cs/base/common/uri';

test('createCancelablePromise rejects when cancelled', async () => {
  const promise = createCancelablePromise(async (token) => {
    await timeout(100);
    return token.isCancellationRequested;
  });

  promise.cancel();
  await assert.rejects(promise, /Canceled/);
});

test('race timeout token rejects when cancelled', async () => {
  const source = new CancellationTokenSource();
  const promise = timeout(100, source.token);
  source.cancel();

  await assert.rejects(promise, /Canceled/);
});

test('Delayer runs latest task', async () => {
  const delayer = new Delayer<string>(1);
  const first = delayer.trigger(() => 'first');
  const second = delayer.trigger(() => 'second');

  assert.equal(await second, 'second');
  assert.equal(await first, 'second');
});

test('Promises.settled waits for all promises before rejecting', async () => {
  let secondSettled = false;
  const firstError = new Error('first');
  const first = Promise.reject(firstError);
  const second = timeout(1).then(() => {
    secondSettled = true;
    throw new Error('second');
  });

  await assert.rejects(Promises.settled([first, second]), firstError);
  assert.equal(secondSettled, true);
});

test('Promises.settled returns fulfilled values', async () => {
  assert.deepEqual(
    await Promises.settled([Promise.resolve(1), Promise.resolve(2)]),
    [1, 2],
  );
});

test('RunOnceScheduler flushes scheduled runner', () => {
  let count = 0;
  const scheduler = new RunOnceScheduler(() => {
    count += 1;
  }, 100);

  scheduler.schedule();
  scheduler.flush();

  assert.equal(count, 1);
  assert.equal(scheduler.isScheduled(), false);
});

test('LatestAsyncOperation invalidates previous operations', () => {
  const operation = new LatestAsyncOperation();
  const first = operation.begin();

  assert.equal(first.isCurrent(), true);

  const second = operation.begin();

  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});

test('Limiter reports size until running work drains', async () => {
  const limiter = new Limiter<void>(1);
  let releaseTask!: () => void;
  const blockedTask = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });

  const queued = limiter.queue(() => blockedTask);
  const idle = limiter.whenIdle();

  assert.equal(limiter.size, 1);

  releaseTask();
  await queued;
  await idle;

  assert.equal(limiter.size, 0);
});

test('ResourceQueue serializes matching resources independently from others', async () => {
  const queue = new ResourceQueue();
  const firstResource = URI.parse('file:///tmp/first.txt');
  const secondResource = URI.parse('file:///tmp/second.txt');
  const order: string[] = [];
  let releaseFirst!: () => void;
  const blockedFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.queueFor(firstResource, async () => {
    order.push('first:start');
    await blockedFirst;
    order.push('first:end');
  });
  const second = queue.queueFor(firstResource, async () => {
    order.push('second');
  });
  const other = queue.queueFor(secondResource, async () => {
    order.push('other');
  });

  await other;

  assert.equal(queue.queueSize(firstResource), 2);
  assert.deepEqual(order, ['first:start', 'other']);

  releaseFirst();
  await Promise.all([first, second]);
  await queue.whenDrained();

  assert.equal(queue.queueSize(firstResource), 0);
  assert.deepEqual(order, ['first:start', 'other', 'first:end', 'second']);
});

test('LazyStatefulPromise computes on demand and exposes current value', async () => {
  let computeCount = 0;
  const lazy = new LazyStatefulPromise(async () => {
    computeCount += 1;
    return 42;
  });

  assert.equal(lazy.currentValue, undefined);
  assert.equal(computeCount, 0);

  const promise = lazy.getPromise();

  assert.equal(computeCount, 1);
  assert.strictEqual(lazy.getPromise(), promise);
  assert.equal(await promise, 42);
  assert.equal(lazy.currentValue, 42);
  assert.equal(lazy.requireValue(), 42);
});
