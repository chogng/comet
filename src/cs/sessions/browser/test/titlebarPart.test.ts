/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter } from 'cs/base/common/event';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import {
	resolveSessionsStatusbarVisibility,
	SessionsTitlebarPart,
} from 'cs/sessions/browser/parts/titlebar/titlebarPart';
import { getWorkbenchPartDomSnapshot } from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';

let cleanupDomEnvironment: (() => void) | undefined;

test.before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

test('Sessions statusbar visibility requires the Editor Part to be visible', () => {
	assert.equal(resolveSessionsStatusbarVisibility(true, true), true);
	assert.equal(resolveSessionsStatusbarVisibility(true, false), false);
	assert.equal(resolveSessionsStatusbarVisibility(false, true), false);
});

test('Sessions Titlebar Part owns shell chrome and statusbar placement', () => {
	const container = document.createElement('div');
	const shell = document.createElement('div');
	const statusbar = document.createElement('section');
	const settingsListeners = new Set<() => void>();
	const layoutEmitter = new Emitter<void>();
	let settingsSnapshot = {
		hasLoadedSettings: true,
		statusbarVisible: true,
		useMica: false,
	};
	let isEditorCollapsed = false;
	const titlebarPart = new SessionsTitlebarPart(
		container,
		shell,
		statusbar,
		{ canInvoke: () => false } as never,
		{
			getSnapshot: () => settingsSnapshot,
			subscribe: (listener: () => void) => {
				settingsListeners.add(listener);
				return () => settingsListeners.delete(listener);
			},
		} as never,
		{
			getLayoutState: () => ({ isEditorCollapsed }),
			onDidChangeLayoutState: layoutEmitter.event,
		} as never,
	);

	try {
		assert(container.classList.contains('comet-has-statusbar'));
		assert.equal(container.classList.contains('comet-has-leading-window-controls'), false);
		assert.equal(container.style.getPropertyValue('--workbench-leading-window-controls-width'), '');
		assert.equal(container.children[0], titlebarPart.getElement());
		assert.equal(container.children[1], shell);
		assert.equal(container.children[2], statusbar);
		assert(titlebarPart.getElement().classList.contains('comet-titlebar-chrome'));
		assert.equal(
			getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.titlebar],
			titlebarPart.getElement(),
		);
		assert.equal(getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.statusbar], statusbar);

		isEditorCollapsed = true;
		layoutEmitter.fire();
		assert.equal(statusbar.parentElement, null);
		assert.equal(getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.statusbar], null);
		isEditorCollapsed = false;
		settingsSnapshot = { ...settingsSnapshot, statusbarVisible: false };
		for (const listener of [...settingsListeners]) {
			listener();
		}
		assert.equal(statusbar.parentElement, null);
	} finally {
		titlebarPart.dispose();
		layoutEmitter.dispose();
	}
	assert.equal(settingsListeners.size, 0);
});
