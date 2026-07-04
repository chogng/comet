import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let HoverService: typeof import('cs/platform/hover/browser/hoverService').HoverService;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ HoverService } = await import('cs/platform/hover/browser/hoverService'));
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

test('hover service can show and hide instant hovers', async () => {
	const target = document.createElement('button');
	document.body.append(target);
	const hoverService = new HoverService();
	const hover = hoverService.showInstantHover(target, {
		content: 'Instant service hover',
		delay: 0,
	});

	try {
		assert(hover);
		await delay(0);

		const overlayContent = document.querySelector('.comet-hover-content');
		assert(overlayContent instanceof HTMLElement);
		assert.equal(overlayContent.textContent, 'Instant service hover');

		hoverService.hideHover();
		assert.equal(document.querySelector('.comet-hover-card'), null);
	} finally {
		hover?.dispose();
	}
});

test('hover service cancels pending delayed hovers when the pointer leaves', async () => {
	const target = document.createElement('button');
	document.body.append(target);
	const hoverService = new HoverService();
	const binding = hoverService.setupDelayedHover(target, {
		content: 'Cancelled service hover',
		delay: 40,
	});

	try {
		target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
		await delay(80);

		assert.equal(document.querySelector('.comet-hover-card'), null);
	} finally {
		binding.dispose();
		hoverService.hideHover();
	}
});

test('hover service can anchor delayed hovers at the mouse position', async () => {
	const target = document.createElement('button');
	document.body.append(target);
	const hoverService = new HoverService();
	const binding = hoverService.setupDelayedHoverAtMouse(target, {
		content: 'Mouse anchored hover',
		delay: 0,
	});

	try {
		target.dispatchEvent(
			new MouseEvent('mouseenter', {
				bubbles: true,
				clientX: 75,
				clientY: 45,
			}),
		);
		await delay(0);

		const overlayContent = document.querySelector('.comet-hover-content');
		assert(overlayContent instanceof HTMLElement);
		assert.equal(overlayContent.textContent, 'Mouse anchored hover');
	} finally {
		binding.dispose();
		hoverService.hideHover();
	}
});
