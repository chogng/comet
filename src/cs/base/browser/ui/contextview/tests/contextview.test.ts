/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createContextViewController: typeof import('cs/base/browser/ui/contextview/contextview').createContextViewController;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ createContextViewController } = await import('cs/base/browser/ui/contextview/contextview'));
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

test('contextview exposes available height for explicit below placement', () => {
	const contextView = createContextViewController();
	const anchorY = window.innerHeight - 150;

	try {
		contextView.show({
			anchor: {
				x: 24,
				y: anchorY,
				width: 80,
				height: 20,
			},
			position: 'below',
			offset: 8,
			render: () => document.createElement('div'),
		});

		const content = document.body.querySelector('.comet-context-view-content');
		if (!(content instanceof HTMLElement)) {
			throw new Error('Expected context view content.');
		}

		assert.equal(
			content.style.getPropertyValue('--comet-context-view-available-height'),
			'114px',
		);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});
