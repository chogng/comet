/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

test('context view renders at its anchor', async () => {
	const { ContextView, ContextViewDOMPosition } = await import('cs/base/browser/ui/contextview/contextview');
	const contextView = new ContextView(document.body, ContextViewDOMPosition.FIXED);

	try {
		contextView.show({
			getAnchor: () => ({ x: 24, y: 48 }),
			render: container => {
				container.textContent = 'Context view';
				return null;
			},
		});
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

		assert.equal(document.body.querySelector('.context-view')?.textContent, 'Context view');
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('context view invokes its hide callback', async () => {
	const { ContextView, ContextViewDOMPosition } = await import('cs/base/browser/ui/contextview/contextview');
	const contextView = new ContextView(document.body, ContextViewDOMPosition.FIXED);
	let didHide = false;

	try {
		contextView.show({
			getAnchor: () => ({ x: 24, y: 48 }),
			render: () => null,
			onHide: () => {
				didHide = true;
			},
		});
		contextView.hide();
		assert.equal(didHide, true);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});
