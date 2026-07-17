/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { DisposableStore } from 'cs/base/common/lifecycle';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import type { IQuickInputButton, IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';

test('quick pick renders and dispatches header, separator, and item buttons', async () => {
	const domEnvironment = installDomTestEnvironment();
	const disposables = new DisposableStore();
	const { QuickInputController } = await import('cs/platform/quickinput/browser/quickInputController');
	const controller = disposables.add(new QuickInputController());
	const picker = disposables.add(controller.createQuickPick<IQuickPickItem>());
	const headerButton: IQuickInputButton = { iconClass: 'codicon codicon-trash', tooltip: 'Clear all' };
	const separatorButton: IQuickInputButton = { iconClass: 'codicon codicon-trash', tooltip: 'Clear day' };
	const itemButton: IQuickInputButton = { iconClass: 'codicon codicon-close', tooltip: 'Remove item' };
	const triggered: string[] = [];

	try {
		picker.buttons = [headerButton];
		picker.items = [
			{ type: 'separator', label: 'Today', buttons: [separatorButton] },
			{ label: 'Example', buttons: [itemButton] },
		];
		disposables.add(picker.onDidTriggerButton(button => triggered.push(button.tooltip ?? '')));
		disposables.add(picker.onDidTriggerSeparatorButton(({ button, separator }) => {
			triggered.push(`${separator.label}:${button.tooltip}`);
		}));
		disposables.add(picker.onDidTriggerItemButton(({ button, item }) => {
			triggered.push(`${item.label}:${button.tooltip}`);
		}));
		picker.show();

		const headerActions = document.querySelectorAll<HTMLButtonElement>('.comet-quick-input-header-row .comet-quick-input-action');
		const separatorActions = document.querySelectorAll<HTMLButtonElement>('.quick-input-separator .comet-quick-input-action');
		const itemActions = document.querySelectorAll<HTMLButtonElement>('.quick-input-item .comet-quick-input-action');
		headerActions[0].click();
		separatorActions[0].click();
		itemActions[0].click();
		picker.items = [{ label: 'Updated' }];

		assert.deepEqual({
			actionCounts: [headerActions.length, separatorActions.length, itemActions.length],
			triggered,
			labels: [...document.querySelectorAll('.quick-input-label')].map(element => element.textContent),
		}, {
			actionCounts: [1, 1, 1],
			triggered: ['Clear all', 'Today:Clear day', 'Example:Remove item'],
			labels: ['Updated'],
		});
	} finally {
		disposables.dispose();
		domEnvironment.cleanup();
	}
});
