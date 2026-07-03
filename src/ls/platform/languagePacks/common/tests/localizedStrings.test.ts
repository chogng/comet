import assert from 'node:assert/strict';
import test from 'node:test';

test('language pack smoke strings use nls default messages', async () => {
	const { default: localizedStrings } = await import(
		'ls/platform/languagePacks/common/localizedStrings'
	);

	assert.deepEqual(localizedStrings, {
		open: 'open',
		close: 'close',
		find: 'find',
	});
});
