import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextView, ContextViewDOMPosition } from 'cs/base/browser/ui/contextview/contextview';

test('browser runtime executes Comet DOM code in a real browser page', async () => {
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

test('browser runtime exposes native DOM events and layout APIs', () => {
	const button = document.createElement('button');
	let clicked = false;
	button.addEventListener('click', () => {
		clicked = true;
	});
	document.body.append(button);
	button.click();

	assert.equal(clicked, true);
	assert.equal(button instanceof HTMLButtonElement, true);
	assert.equal(typeof window.getComputedStyle(button).display, 'string');
	document.body.replaceChildren();
});
