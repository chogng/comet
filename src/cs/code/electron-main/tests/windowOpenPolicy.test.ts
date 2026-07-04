import assert from 'node:assert/strict';
import test from 'node:test';

import { registerWindowOpenPolicy } from 'cs/platform/window/electron-main/windowOpenPolicy';

test('window open policy denies unmanaged Electron popup windows', () => {
	let registeredListener:
		| ((event: unknown, contents: {
			setWindowOpenHandler(handler: (details: unknown) => { action: 'deny' }): void;
		}) => void)
		| undefined;

	registerWindowOpenPolicy({
		on: (eventName, listener) => {
			assert.equal(eventName, 'web-contents-created');
			registeredListener = listener;
		},
	});

	let registeredHandler: ((details: unknown) => { action: 'deny' }) | undefined;
	registeredListener?.({}, {
		setWindowOpenHandler: (handler) => {
			registeredHandler = handler;
		},
	});

	assert.deepEqual(registeredHandler?.({ url: 'https://www.nature.com/articles/example' }), {
		action: 'deny',
	});
});
