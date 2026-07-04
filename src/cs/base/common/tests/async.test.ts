import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CancellationTokenSource,
  Delayer,
  Promises,
  RunOnceScheduler,
  createCancelablePromise,
  timeout,
} from 'cs/base/common/async';

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
