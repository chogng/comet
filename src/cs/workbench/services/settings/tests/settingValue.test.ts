import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areSettingValuesEqual,
  cloneSettingValue,
  createSettingValue,
  deriveUserSettingValue,
} from 'cs/workbench/services/settings/settingValue';

test('createSettingValue resolves to user value when present', () => {
  const settingValue = createSettingValue(
    { value: 'default' },
    { value: 'user' },
    (value) => ({ ...value }),
  );

  assert.deepEqual(settingValue.defaultValue, { value: 'default' });
  assert.deepEqual(settingValue.userValue, { value: 'user' });
  assert.deepEqual(settingValue.value, { value: 'user' });
});

test('deriveUserSettingValue returns null when resolved matches default', () => {
  const userValue = deriveUserSettingValue(
    { value: 'default' },
    { value: 'default' },
    (value) => ({ ...value }),
    (previous, next) => previous.value === next.value,
  );

  assert.equal(userValue, null);
});

test('areSettingValuesEqual compares all layers', () => {
  const previous = createSettingValue(
    { value: 'default' },
    { value: 'user' },
    (value) => ({ ...value }),
  );
  const next = createSettingValue(
    { value: 'default' },
    { value: 'user' },
    (value) => ({ ...value }),
  );

  assert.equal(
    areSettingValuesEqual(
      previous,
      next,
      (previousValue, nextValue) => previousValue.value === nextValue.value,
    ),
    true,
  );
});

test('cloneSettingValue clones nested layers', () => {
  const original = createSettingValue(
    { value: 'default' },
    { value: 'user' },
    (value) => ({ ...value }),
  );
  const cloned = cloneSettingValue(original, (value) => ({ ...value }));

  assert.notEqual(cloned.defaultValue, original.defaultValue);
  assert.notEqual(cloned.userValue, original.userValue);
  assert.notEqual(cloned.value, original.value);
  assert.deepEqual(cloned, original);
});
