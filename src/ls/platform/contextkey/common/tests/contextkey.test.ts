import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContextKeyExpr,
  ContextKeyServiceImpl,
  RawContextKey,
} from 'ls/platform/contextkey/common/contextkey';

test('ContextKeyService stores bound keys and evaluates expressions', () => {
  const service = new ContextKeyServiceImpl();
  const activePageKey = new RawContextKey('workbench.activePage', 'content');
  const activePage = activePageKey.bindTo(service);
  const primarySidebarVisible = new RawContextKey<boolean>(
    'workbench.primarySidebarVisible',
    true,
  ).bindTo(service);

  assert.equal(activePage.get(), 'content');
  assert.equal(
    service.contextMatchesRules(
      ContextKeyExpr.and(
        activePageKey.isEqualTo('content'),
        ContextKeyExpr.has('workbench.primarySidebarVisible'),
      ),
    ),
    true,
  );

  primarySidebarVisible.set(false);

  assert.equal(
    service.contextMatchesRules(
      ContextKeyExpr.has('workbench.primarySidebarVisible'),
    ),
    false,
  );
});

test('ContextKeyService emits changed keys when values update', () => {
  const service = new ContextKeyServiceImpl();
  const changedKeys: string[] = [];
  service.onDidChangeContext((event) => {
    changedKeys.push(...event.keys);
  });

  const key = new RawContextKey<boolean>('test.enabled', false).bindTo(service);
  key.set(false);
  key.set(true);
  key.reset();

  assert.deepEqual(changedKeys, ['test.enabled', 'test.enabled']);
});
