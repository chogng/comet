import assert from 'node:assert/strict';
import test from 'node:test';

import { parse, ParseErrorCode, type ParseError } from 'ls/base/common/json';
import { getParseErrorMessage } from 'ls/base/common/jsonErrorMessages';
import { parse as parseJsonc } from 'ls/base/common/jsonc';
import { localize, localize2 } from 'ls/nls';

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

test('json parser reports parse errors through nls default messages', () => {
	const errors: ParseError[] = [];
	parse('{ "name" }', errors);

	assert.equal(errors[0]?.error, ParseErrorCode.ColonExpected);
	assert.equal(getParseErrorMessage(errors[0].error), 'Colon expected');
});

test('nls localize follows upstream default-message behavior', () => {
	assert.equal(localize('error.valueExpected', 'Value expected'), 'Value expected');
	assert.equal(localize('severityPrefix.error', 'Error: {0}', 'Failure'), 'Error: Failure');
	assert.deepEqual(
		localize2('welcome', 'Welcome {0}', 'Reader'),
		{
			value: 'Welcome Reader',
			original: 'Welcome Reader',
		},
	);
});

test('nls localize reads indexed built messages from global nls table', () => {
	const previousMessages = globalThis._VSCODE_NLS_MESSAGES as string[] | undefined;
	const builtLocalize = localize as unknown as (
		index: number,
		message: string | null,
		...args: (string | number | boolean | undefined | null)[]
	) => string;
	const builtLocalize2 = localize2 as unknown as (
		index: number,
		message: string,
		...args: (string | number | boolean | undefined | null)[]
	) => { value: string; original: string };

	globalThis._VSCODE_NLS_MESSAGES = ['Translated {0}'];

	try {
		assert.equal(builtLocalize(0, 'Default {0}', 'Reader'), 'Translated Reader');
		assert.deepEqual(builtLocalize2(0, 'Default {0}', 'Reader'), {
			value: 'Translated Reader',
			original: 'Default Reader',
		});
	} finally {
		if (previousMessages === undefined) {
			Reflect.deleteProperty(globalThis, '_VSCODE_NLS_MESSAGES');
		} else {
			globalThis._VSCODE_NLS_MESSAGES = previousMessages;
		}
	}
});
