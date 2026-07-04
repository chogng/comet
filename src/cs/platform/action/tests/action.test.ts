import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isICommandActionToggleInfo,
  isLocalizedString,
} from 'cs/platform/action/common/action';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';
import { ContextKeyExpr } from 'cs/platform/contextkey/common/contextkey';

test('platform action detects localized strings', () => {
  assert.equal(
    isLocalizedString({ value: 'Open', original: 'Open' }),
    true,
  );
  assert.equal(isLocalizedString({ value: 'Open' }), false);
});

test('platform action detects toggle info wrappers', () => {
  const expression = ContextKeyExpr.has('editorTextFocus');

  assert.equal(isICommandActionToggleInfo(expression), false);
  assert.equal(
    isICommandActionToggleInfo({ condition: expression, title: 'Enabled' }),
    true,
  );
});

test('platform action categories expose common command groups', () => {
  assert.equal(Categories.View.value, 'View');
  assert.equal(Categories.Developer.original, 'Developer');
});
