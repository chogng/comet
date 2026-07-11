/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createContextViewController: typeof import('cs/base/browser/ui/contextview/contextview').createContextViewController;
let ContextViewDOMPosition: typeof import('cs/base/browser/ui/contextview/contextview').ContextViewDOMPosition;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ createContextViewController, ContextViewDOMPosition } = await import('cs/base/browser/ui/contextview/contextview'));
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

test('contextview runs delegate layout focus dom event and layer hooks', () => {
	const contextView = createContextViewController();
	const order: string[] = [];
	const domEvents: string[] = [];
	const activeElementClassNames: Array<string | null> = [];

	try {
		contextView.show({
			anchor: {
				x: 24,
				y: 48,
				width: 80,
				height: 20,
			},
			layer: 7,
			render: () => {
				const button = document.createElement('button');
				button.className = 'contextview-focus-target';
				return button;
			},
			layout: () => {
				order.push('layout');
			},
			focus: () => {
				order.push('focus');
				const button = document.body.querySelector('.contextview-focus-target');
				if (!(button instanceof HTMLElement)) {
					throw new Error('Expected focus target.');
				}
				button.focus();
			},
			onDOMEvent: (event, activeElement) => {
				domEvents.push(event.type);
				activeElementClassNames.push(activeElement?.className ?? null);
			},
		});

		assert.deepEqual(order, ['layout', 'focus']);
		assert.equal(contextView.getViewElement().style.zIndex, '1007');
		assert.equal(
			document.activeElement instanceof HTMLElement
				? document.activeElement.className
				: null,
			'contextview-focus-target',
		);

		document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		assert.equal(contextView.isVisible(), true);
		assert.deepEqual(domEvents, ['mousedown']);
		assert.deepEqual(activeElementClassNames, ['contextview-focus-target']);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('contextview can be shown again after being hidden', () => {
	const contextView = createContextViewController();
	const options = {
		anchor: { x: 24, y: 48, width: 80, height: 20 },
		render: () => document.createElement('div'),
	};

	try {
		contextView.show(options);
		contextView.hide();
		contextView.show(options);

		assert.equal(contextView.isVisible(), true);
		assert.equal(contextView.getViewElement().isConnected, true);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('contextview does not mount an empty element before it is shown', () => {
	const contextView = createContextViewController();

	try {
		assert.equal(document.body.querySelector('.comet-context-view'), null);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('contextview keeps canRelayout false visible for initial layout and hides on relayout', () => {
	const contextView = createContextViewController();

	try {
		contextView.show({
			canRelayout: false,
			anchor: {
				x: 24,
				y: 48,
				width: 80,
				height: 20,
			},
			render: () => document.createElement('div'),
		});

		assert.equal(contextView.isVisible(), true);

		contextView.layout();
		assert.equal(contextView.isVisible(), false);
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('contextview supports a fixed custom container', () => {
	const contextView = createContextViewController();
	const container = document.createElement('div');
	document.body.append(container);

	try {
		contextView.setContainer(container, ContextViewDOMPosition.Fixed);
		contextView.show({
			anchor: { x: 24, y: 48, width: 80, height: 20 },
			render: () => document.createElement('div'),
		});

		assert.equal(contextView.getViewElement().parentElement, container);
		assert.equal(contextView.getViewElement().style.position, 'fixed');
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});

test('contextview supports a fixed shadow container', () => {
	const contextView = createContextViewController();
	const container = document.createElement('div');
	document.body.append(container);

	try {
		contextView.setContainer(container, ContextViewDOMPosition.FixedShadow);
		contextView.show({
			anchor: { x: 24, y: 48, width: 80, height: 20 },
			render: () => document.createElement('div'),
		});

		const host = container.querySelector('.comet-shadow-root-host');
		assert(host instanceof HTMLElement);
		assert(host.shadowRoot);
		assert.equal(contextView.getViewElement().getRootNode(), host.shadowRoot);
		assert.equal(contextView.getViewElement().style.position, 'fixed');
	} finally {
		contextView.dispose();
		document.body.replaceChildren();
	}
});
