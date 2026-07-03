import assert from 'node:assert/strict';
import test from 'node:test';

import { parse, ParseErrorCode, type ParseError } from 'ls/base/common/json';
import { getParseErrorMessage } from 'ls/base/common/jsonErrorMessages';
import { parse as parseJsonc } from 'ls/base/common/jsonc';
import { localize, setNLSLanguage } from 'ls/nls';

test('jsonc parses comments and trailing commas', () => {
  const parsed = parseJsonc<{ enabled: boolean; values: number[] }>(`
    {
      // comments are accepted in migrated config files
      "enabled": true,
      "values": [1, 2,],
    }
  `);

  assert.deepEqual(parsed, {
    enabled: true,
    values: [1, 2],
  });
});

test('json parser reports localized parse errors through nls', () => {
  const errors: ParseError[] = [];
  parse('{ "name" }', errors);

  assert.equal(errors[0]?.error, ParseErrorCode.ColonExpected);

  setNLSLanguage('en');
  assert.equal(getParseErrorMessage(errors[0].error), 'Colon expected');

  setNLSLanguage('zh');
  assert.equal(getParseErrorMessage(errors[0].error), '需要冒号');
});

test('nls localize uses locale messages and reports missing keys', () => {
  setNLSLanguage('en');
  assert.equal(localize('error.valueExpected', 'fallback'), 'Value expected');
  assert.equal(localize('severityPrefix.error', 'Error: {0}', 'Failure'), 'Error: Failure');
  assert.equal(
    localize('errorUnknownCommand', 'Unknown command: {command}', { command: 'ls.open' }),
    'Unknown command: ls.open',
  );
  assert.throws(() => localize('severityPrefix.error', 'Error: {0}'), /Missing localized value/);
  assert.throws(() => localize('missing.key', 'Hello {0}', 'Literature Studio'), /Missing localized string/);
});
