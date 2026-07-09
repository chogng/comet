import assert from 'node:assert/strict';
import test from 'node:test';
import { Action, ActionRunner, Separator, toAction } from 'cs/base/common/actions';

test('Action fires change events and runs callback', async () => {
  let ran = false;
  const action = new Action('test.action', 'Test', undefined, true, () => {
    ran = true;
  });
  const changes: string[] = [];
  const disposable = action.onDidChange((event) => {
    if (event.label) {
      changes.push(event.label);
    }
  });

  action.label = 'Changed';
  await action.run();

  assert.equal(ran, true);
  assert.deepEqual(changes, ['Changed']);
  disposable.dispose();
});

test('ActionRunner skips disabled actions', async () => {
  let ran = false;
  const runner = new ActionRunner();
  await runner.run(toAction({ id: 'disabled', label: 'Disabled', enabled: false, run: () => {
    ran = true;
  } }));

  assert.equal(ran, false);
});

test('Separator cleans leading trailing and duplicate separators', () => {
  const first = toAction({ id: 'a', label: 'A', run: () => {} });
  const second = toAction({ id: 'b', label: 'B', run: () => {} });
  const actions = [new Separator(), first, new Separator(), new Separator(), second, new Separator()];

  assert.deepEqual(Separator.clean(actions).map((action) => action.id), ['a', Separator.ID, 'b']);
});
