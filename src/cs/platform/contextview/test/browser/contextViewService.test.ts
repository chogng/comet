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

test('context view uses stable document coordinates when no container is provided', async () => {
	const { PlatformContextViewService } = await import('cs/platform/contextview/browser/contextViewService');
	const contextViewService = new PlatformContextViewService();

	try {
		contextViewService.showContextView({
			getAnchor: () => ({ x: 24, y: 48 }),
			render: () => null,
		});

		const contextView = contextViewService.getContextViewElement();
		assert.equal(contextView.style.position, 'absolute');
		const left = contextView.style.left;
		const top = contextView.style.top;

		contextViewService.layout();

		assert.equal(contextView.style.left, left);
		assert.equal(contextView.style.top, top);
	} finally {
		contextViewService.dispose();
		document.body.replaceChildren();
	}
});

test('context menu closes when focus moves out of the workbench window', async () => {
	const { PlatformContextViewService } = await import('cs/platform/contextview/browser/contextViewService');
	const { ContextMenuHandler } = await import('cs/platform/contextview/browser/contextMenuHandler');
	const contextViewService = new PlatformContextViewService();
	const contextMenuHandler = new ContextMenuHandler(contextViewService);
	let didCancel: boolean | undefined;

	try {
		contextMenuHandler.showContextMenu({
			getAnchor: () => ({ x: 24, y: 48 }),
			getActions: () => [{
				id: 'test.action',
				label: 'Test Action',
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => undefined,
			}],
			onHide: value => {
				didCancel = value;
			},
		});

		window.dispatchEvent(new Event('blur'));

		assert.equal(didCancel, true);
		assert.equal(contextMenuHandler.isVisible(), false);
		assert.equal(contextViewService.getContextViewElement().style.display, 'none');
	} finally {
		contextMenuHandler.dispose();
		contextViewService.dispose();
		document.body.replaceChildren();
	}
});

test('context menu closes on an outside primary-button press', async () => {
	const { PlatformContextViewService } = await import('cs/platform/contextview/browser/contextViewService');
	const { ContextMenuHandler } = await import('cs/platform/contextview/browser/contextMenuHandler');
	const contextViewService = new PlatformContextViewService();
	const contextMenuHandler = new ContextMenuHandler(contextViewService);
	const outside = document.body.appendChild(document.createElement('button'));

	try {
		contextMenuHandler.showContextMenu({
			getAnchor: () => ({ x: 24, y: 48 }),
			getActions: () => [{
				id: 'test.action',
				label: 'Test Action',
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => undefined,
			}],
		});

		contextViewService.getContextViewElement().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
		assert.equal(contextMenuHandler.isVisible(), true);

		outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

		assert.equal(contextMenuHandler.isVisible(), false);
		assert.equal(contextViewService.getContextViewElement().style.display, 'none');
	} finally {
		contextMenuHandler.dispose();
		contextViewService.dispose();
		document.body.replaceChildren();
	}
});
