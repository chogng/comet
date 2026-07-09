import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let HoverService: typeof import('cs/platform/hover/browser/hoverService').HoverService;

const HOVER_EXIT_ANIMATION_WAIT_MS = 120;

async function waitForHoverToUnmount() {
	await delay(HOVER_EXIT_ANIMATION_WAIT_MS);
	assert.equal(document.querySelector('.comet-hover-card'), null);
}

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ HoverService } = await import('cs/platform/hover/browser/hoverService'));
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

afterEach(async () => {
	await delay(HOVER_EXIT_ANIMATION_WAIT_MS);
	document.body.replaceChildren();
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
		const closingOverlay = document.querySelector('.comet-hover-card');
		assert(closingOverlay instanceof HTMLElement);
		assert.equal(closingOverlay.classList.contains('comet-is-closing'), true);
		await waitForHoverToUnmount();
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

		await waitForHoverToUnmount();
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

test('hover service waits long enough for the pointer to enter an action hover', async () => {
	const target = document.createElement('button');
	document.body.append(target);
	const hoverService = new HoverService();
	const hover = hoverService.showInstantHover(target, {
		content: 'Action service hover',
		delay: 0,
		actions: [
			{
				label: 'Run',
				run: () => {},
			},
		],
	});

	try {
		assert(hover);
		await delay(0);

		const overlay = document.querySelector('.comet-hover-card');
		assert(overlay instanceof HTMLElement);

		target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
		await delay(150);
		assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);

		overlay.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		await delay(80);

		assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);
	} finally {
		hover?.dispose();
		hoverService.hideHover();
	}
});
