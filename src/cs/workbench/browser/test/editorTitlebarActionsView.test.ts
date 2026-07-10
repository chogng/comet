/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

const domEnvironment = installDomTestEnvironment();

const labels = {
	headerAddAction: 'Add editor',
	createDraft: 'Create draft',
	createBrowser: 'Create browser',
	createFile: 'Create file',
	expandEditor: 'Expand editor',
	collapseEditor: 'Collapse editor',
};

beforeEach(() => {
	document.body.replaceChildren();
});

after(() => {
	domEnvironment.cleanup();
});

test('editor titlebar actions open editors and toggle the editor layout', async () => {
	const { createEditorTitlebarActionsView } = await import(
		'cs/workbench/browser/parts/editor/editorTitlebarActionsView'
	);
	const openRequests: object[] = [];
	let toggleCount = 0;
	const view = createEditorTitlebarActionsView({
		isEditorCollapsed: true,
		labels,
		onOpenEditor: request => {
			openRequests.push(request);
		},
		onToggleEditorCollapse: () => {
			toggleCount += 1;
		},
	});
	document.body.append(view.getElement());

	try {
		const toggleButton = document.body.querySelector('[aria-label="Expand editor"]');
		assert(toggleButton instanceof HTMLButtonElement);
		toggleButton.click();
		assert.equal(toggleCount, 1);

		const addButton = document.body.querySelector('[aria-label="Add editor"]');
		assert(addButton instanceof HTMLButtonElement);
		addButton.click();
		await new Promise(resolve => setTimeout(resolve, 0));

		const draftItem = Array.from(
			document.body.querySelectorAll('.comet-dropdown-menu-item'),
		).find(element => element.textContent?.trim() === labels.createDraft);
		assert(draftItem instanceof HTMLElement);
		draftItem.click();
		assert.deepEqual(openRequests, [
			{
				kind: 'draft',
				disposition: 'reveal-or-open',
			},
		]);
	} finally {
		view.dispose();
	}
});

test('editor titlebar actions preserve one element across collapsed and expanded hosts', async () => {
	const { createEditorTitlebarActionsView } = await import(
		'cs/workbench/browser/parts/editor/editorTitlebarActionsView'
	);
	const collapsedHost = document.createElement('div');
	const expandedHost = document.createElement('div');
	const view = createEditorTitlebarActionsView({
		isEditorCollapsed: true,
		labels,
		onOpenEditor: () => {},
		onToggleEditorCollapse: () => {},
	});
	const actionsElement = view.getElement();

	try {
		collapsedHost.append(actionsElement);
		expandedHost.append(actionsElement);
		assert.equal(collapsedHost.childElementCount, 0);
		assert.equal(expandedHost.firstElementChild, actionsElement);

		view.setProps({
			isEditorCollapsed: false,
			labels,
			onOpenEditor: () => {},
			onToggleEditorCollapse: () => {},
		});
		assert(actionsElement.querySelector('[aria-label="Collapse editor"]'));
		assert(actionsElement.querySelector('.lx-icon-layout-sidebar-right'));
	} finally {
		view.dispose();
	}
});
