import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Disposable,
  DisposableStore,
  MutableDisposable,
  combinedDisposable,
  dispose,
  disposeAll,
  isDisposableLike,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';

function createTrackedDisposable(label: string, log: string[]): DisposableLike {
  return {
    dispose() {
      log.push(label);
    },
  };
}

test('toDisposable only runs the disposer once', () => {
  let callCount = 0;
  const disposable = toDisposable(() => {
    callCount += 1;
  });

  disposable.dispose();
  disposable.dispose();

  assert.equal(callCount, 1);
});

test('dispose and disposeAll handle functions and disposable objects in reverse order', () => {
  const log: string[] = [];

  dispose(() => {
    log.push('single');
  });
  disposeAll([
    () => {
      log.push('first');
    },
    createTrackedDisposable('second', log),
    undefined,
    null,
    () => {
      log.push('third');
    },
  ]);

  assert.deepEqual(log, ['single', 'third', 'second', 'first']);
});

test('combinedDisposable disposes once and preserves reverse disposal order', () => {
  const log: string[] = [];
  const combined = combinedDisposable(
    () => {
      log.push('first');
    },
    createTrackedDisposable('second', log),
    () => {
      log.push('third');
    },
  );

  combined.dispose();
  combined.dispose();

  assert.deepEqual(log, ['third', 'second', 'first']);
});

test('DisposableStore clear is reusable and dispose is terminal', () => {
  const log: string[] = [];
  const store = new DisposableStore();

  const functionDisposable = store.add(() => {
    log.push('function');
  });
  const objectDisposable = store.add(createTrackedDisposable('object', log));

  assert.equal(isDisposableLike(functionDisposable), true);
  assert.equal(objectDisposable.dispose instanceof Function, true);

  store.clear();
  assert.deepEqual(log, ['object', 'function']);
  assert.equal(store.isDisposed, false);

  store.add(() => {
    log.push('after-clear');
  });
  store.dispose();

  assert.deepEqual(log, ['object', 'function', 'after-clear']);
  assert.equal(store.isDisposed, true);
});

test('DisposableStore add immediately disposes entries after the store is disposed', () => {
  const log: string[] = [];
  const store = new DisposableStore();

  store.dispose();
  const registered = store.add(() => {
    log.push('late');
  });

  assert.equal(isDisposableLike(registered), true);
  assert.deepEqual(log, ['late']);
});

test('MutableDisposable replaces, leaks, and disposes values predictably', () => {
  const log: string[] = [];
  const lifecycle = new MutableDisposable<DisposableLike>();
  const first = createTrackedDisposable('first', log);
  const second = createTrackedDisposable('second', log);

  lifecycle.value = first;
  lifecycle.value = second;
  assert.deepEqual(log, ['first']);

  const leaked = lifecycle.clearAndLeak();
  assert.equal(leaked, second);
  assert.deepEqual(log, ['first']);

  lifecycle.dispose();
  assert.deepEqual(log, ['first']);

  lifecycle.value = createTrackedDisposable('late', log);
  assert.deepEqual(log, ['first', 'late']);
});

test('Disposable registers child disposables on behalf of subclasses', () => {
  const log: string[] = [];

  class TestOwner extends Disposable {
    constructor() {
      super();
      this._register(() => {
        log.push('ctor');
      });
    }

    attach(label: string) {
      return this._register(() => {
        log.push(label);
      });
    }
  }

  const owner = new TestOwner();
  const child = owner.attach('method');

  assert.equal(isDisposableLike(child), true);

  owner.dispose();
  owner.dispose();

  assert.deepEqual(log, ['method', 'ctor']);
});
