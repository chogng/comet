import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CancellationTokenSource,
  Delayer,
  RunOnceScheduler,
  createCancelablePromise,
  timeout,
} from 'ls/base/common/async';

test('createCancelablePromise observes cancellation', async () => {
  const promise = createCancelablePromise(async (token) => {
    await timeout(1);
    return token.isCancellationRequested;
  });

  promise.cancel();
  assert.equal(await promise, true);
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
