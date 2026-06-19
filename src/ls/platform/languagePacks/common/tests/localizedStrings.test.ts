import assert from 'node:assert/strict';
import test from 'node:test';

import { setNLSLanguage } from 'ls/nls';

test('language pack smoke strings are localized through nls', async () => {
  setNLSLanguage('zh');

  const { default: localizedStrings } = await import(
    'ls/platform/languagePacks/common/localizedStrings'
  );

  assert.deepEqual(localizedStrings, {
    open: '\u6253\u5f00',
    close: '\u5173\u95ed',
    find: '\u67e5\u627e',
  });

  setNLSLanguage('en');
});
