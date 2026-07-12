/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let BrowserOverlayManager: typeof import('cs/workbench/contrib/browserView/electron-browser/overlayManager').BrowserOverlayManager;
let BrowserOverlayType: typeof import('cs/workbench/contrib/browserView/electron-browser/overlayManager').BrowserOverlayType;

function createDomRect(x: number, y: number, width: number, height: number) {
	return {
		x,
		y,
		top: y,
		left: x,
		right: x + width,
		bottom: y + height,
		width,
		height,
		toJSON() {
			return this;
		},
	} as DOMRect;
}

function addElement(className: string, bounds: DOMRect, parent: ParentNode = document.body) {
	const element = document.createElement('div');
	element.className = className;
	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => bounds,
	});
	parent.append(element);
	return element;
}

function installHitTest(elements: Element[]) {
	const previousElementFromPoint = document.elementFromPoint;
	const previousElementsFromPoint = document.elementsFromPoint;
	document.elementFromPoint = (() => elements[0] ?? null) as typeof document.elementFromPoint;
	document.elementsFromPoint = (() => elements) as typeof document.elementsFromPoint;
	return () => {
		document.elementFromPoint = previousElementFromPoint;
		document.elementsFromPoint = previousElementsFromPoint;
	};
}

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({
		BrowserOverlayManager,
		BrowserOverlayType,
	} = await import('cs/workbench/contrib/browserView/electron-browser/overlayManager'));
});

afterEach(() => {
	document.body.replaceChildren();
});

after(() => {
	cleanupDomEnvironment?.();
});

test('browser overlay manager detects Comet overlays covering the browser host', () => {
	const overlayDefinitions = [
		{ className: 'comet-menu-submenu', type: BrowserOverlayType.Menu },
		{ className: 'comet-quick-input-widget', type: BrowserOverlayType.QuickInput },
		{ className: 'comet-hover-card', type: BrowserOverlayType.Hover },
		{ className: 'comet-dialog-modal-block', type: BrowserOverlayType.Dialog },
		{ className: 'comet-notifications-center', type: BrowserOverlayType.Notification },
		{ className: 'comet-notifications-toasts', type: BrowserOverlayType.Notification },
		{ className: 'comet-settings-overlay', type: BrowserOverlayType.Dialog },
		{ className: 'context-view', type: BrowserOverlayType.Unknown },
	];

	for (const overlayDefinition of overlayDefinitions) {
		const manager = new BrowserOverlayManager(window);
		const host = addElement('comet-browser-frame-placeholder', createDomRect(0, 0, 300, 300));
		const overlay = addElement(overlayDefinition.className, createDomRect(40, 40, 200, 200));
		const restoreHitTest = installHitTest([overlay, host]);

		try {
			const overlays = manager.getOverlappingOverlays(host);
			assert.deepEqual(overlays.map(foundOverlay => foundOverlay.type), [overlayDefinition.type]);
		} finally {
			restoreHitTest();
			manager.dispose();
			document.body.replaceChildren();
		}
	}
});

test('browser overlay manager follows the Settings overlay hidden lifecycle', async () => {
	const host = addElement('comet-browser-frame-placeholder', createDomRect(0, 0, 300, 300));
	const overlay = addElement('comet-settings-overlay', createDomRect(0, 0, 400, 400));
	overlay.hidden = true;
	const manager = new BrowserOverlayManager(window);
	const restoreHitTest = installHitTest([overlay, host]);
	let stateChangeCount = 0;
	const listener = manager.onDidChangeOverlayState(() => stateChangeCount++);

	try {
		assert.deepEqual(manager.getOverlappingOverlays(host), []);

		overlay.hidden = false;
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.deepEqual(
			manager.getOverlappingOverlays(host).map(foundOverlay => foundOverlay.type),
			[BrowserOverlayType.Dialog],
		);

		overlay.hidden = true;
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.deepEqual({ stateChangeCount, overlays: manager.getOverlappingOverlays(host) }, {
			stateChangeCount: 2,
			overlays: [],
		});
	} finally {
		listener.dispose();
		restoreHitTest();
		manager.dispose();
	}
});

test('browser overlay manager ignores non-overlapping overlays', () => {
	const manager = new BrowserOverlayManager(window);
	const host = addElement('comet-browser-frame-placeholder', createDomRect(0, 0, 100, 100));
	const overlay = addElement('comet-menu-submenu', createDomRect(500, 500, 100, 100));
	const restoreHitTest = installHitTest([overlay, host]);

	try {
		assert.deepEqual(manager.getOverlappingOverlays(host), []);
	} finally {
		restoreHitTest();
		manager.dispose();
	}
});

test('browser overlay manager skips context-view blocker hit targets', () => {
	const manager = new BrowserOverlayManager(window);
	const host = addElement('comet-browser-frame-placeholder', createDomRect(0, 0, 300, 300));
	const dialog = addElement('comet-dialog-modal-block', createDomRect(0, 0, 400, 400));
	const contextView = addElement('context-view', createDomRect(320, 320, 60, 60));
	const blocker = addElement('context-view-block', createDomRect(0, 0, 400, 400), contextView);
	const restoreHitTest = installHitTest([blocker, dialog, host]);

	try {
		const overlays = manager.getOverlappingOverlays(host);
		assert.deepEqual(overlays.map(overlay => overlay.type), [BrowserOverlayType.Dialog]);
	} finally {
		restoreHitTest();
		manager.dispose();
	}
});

test('browser overlay manager detects Comet overlays rendered inside a shadow root', () => {
	const manager = new BrowserOverlayManager(window);
	const host = addElement('comet-browser-frame-placeholder', createDomRect(0, 0, 300, 300));
	const shadowHost = addElement('comet-shadow-root-host', createDomRect(20, 20, 200, 200));
	const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
	const overlay = addElement('comet-quick-input-widget', createDomRect(20, 20, 200, 200), shadowRoot);
	const restoreHitTest = installHitTest([shadowHost, host]);
	const previousShadowElementFromPoint = shadowRoot.elementFromPoint;
	const previousShadowElementsFromPoint = shadowRoot.elementsFromPoint;
	shadowRoot.elementFromPoint = (() => overlay) as typeof shadowRoot.elementFromPoint;
	shadowRoot.elementsFromPoint = (() => [overlay]) as typeof shadowRoot.elementsFromPoint;

	try {
		const overlays = manager.getOverlappingOverlays(host);
		assert.deepEqual(overlays.map(foundOverlay => foundOverlay.type), [BrowserOverlayType.QuickInput]);
	} finally {
		shadowRoot.elementFromPoint = previousShadowElementFromPoint;
		shadowRoot.elementsFromPoint = previousShadowElementsFromPoint;
		restoreHitTest();
		manager.dispose();
	}
});
