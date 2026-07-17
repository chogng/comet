/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let ProgressBar: typeof import('cs/base/browser/ui/progressbar/progressbar').ProgressBar;
let setProgressAccessibilitySignalScheduler: typeof import('cs/base/browser/ui/progressbar/progressAccessibilitySignal').setProgressAccessibilitySignalScheduler;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ ProgressBar } = await import('cs/base/browser/ui/progressbar/progressbar'));
	({ setProgressAccessibilitySignalScheduler } = await import('cs/base/browser/ui/progressbar/progressAccessibilitySignal'));
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

test('progressbar updates discrete progress state', () => {
	const container = document.createElement('div');
	document.body.append(container);
	const progressBar = new ProgressBar(container, { progressBarBackground: 'rgb(1, 2, 3)' });

	try {
		assert.equal(container.querySelector('.monaco-progress-container') instanceof HTMLElement, true);
		assert.equal(progressBar.getContainer().getAttribute('role'), 'progressbar');
		assert.equal(progressBar.getContainer().getAttribute('aria-label'), 'Progress');

		progressBar.total(200).worked(50).setWorked(125);

		const progressBit = progressBar.getContainer().querySelector('.progress-bit') as HTMLElement | null;
		assert(progressBit);
		assert.equal(progressBar.hasTotal(), true);
		assert.equal(progressBar.getContainer().classList.contains('discrete'), true);
		assert.equal(progressBar.getContainer().getAttribute('aria-valuemax'), '200');
		assert.equal(progressBar.getContainer().getAttribute('aria-valuenow'), '125');
		assert.equal(progressBit.style.width, '62.5%');
		assert.equal(progressBit.style.backgroundColor, 'rgb(1, 2, 3)');
	} finally {
		progressBar.dispose();
		document.body.replaceChildren();
	}
});

test('progressbar schedules accessibility signal while shown', () => {
	const container = document.createElement('div');
	document.body.append(container);
	const progressBar = new ProgressBar(container);
	let disposeCount = 0;
	const delayTimes: number[] = [];

	setProgressAccessibilitySignalScheduler((msDelayTime) => {
		delayTimes.push(msDelayTime);
		return {
			dispose() {
				disposeCount += 1;
			},
		};
	});

	try {
		progressBar.show();
		progressBar.hide();

		assert.deepEqual(delayTimes, [3000]);
		assert.equal(disposeCount, 1);
	} finally {
		progressBar.dispose();
		setProgressAccessibilitySignalScheduler(() => ({ dispose() {} }));
		document.body.replaceChildren();
	}
});
