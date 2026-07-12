/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type { EditorStatusItem } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';

const hoverService = getHoverService();

export function createStatusbarItemElement(
	item: EditorStatusItem,
	commandService: IWorkbenchCommandService,
): HTMLElement {
	const itemElement = $<HTMLSpanElement>('span.comet-editor-statusbar-item');
	const canRunCommand = item.commandId !== undefined && item.commandEnabled !== false;
	const runCommand = () => {
		if (!item.commandId || item.commandEnabled === false) {
			throw new Error(`Statusbar item '${item.id}' does not expose an enabled command.`);
		}
		const result = commandService.executeCommand<boolean>(item.commandId);
		if (result === undefined) {
			throw new Error(`Statusbar command '${item.commandId}' is not registered.`);
		}
		return result;
	};

	itemElement.dataset.statusbarItemId = item.id;
	itemElement.dataset.statusbarItemValue = item.value;
	if (item.title) {
		itemElement.dataset.statusbarItemTitle = item.title;
	}
	itemElement.className = [
		'comet-editor-statusbar-item',
		item.tone ? `is-${item.tone}` : '',
		canRunCommand ? 'comet-is-actionable' : '',
	]
		.filter(Boolean)
		.join(' ');

	const labelElement = $<HTMLSpanElement>('span.comet-editor-statusbar-item-label');
	labelElement.textContent = item.label;

	const valueElement = $<HTMLSpanElement>('span.comet-editor-statusbar-item-value');
	valueElement.textContent = item.value;

	hoverService.createHover(itemElement, {
		content: item.label,
		subtitle: item.title ?? item.value,
		actions: canRunCommand
			? [{ label: item.label, run: runCommand }]
			: [],
	});

	if (canRunCommand) {
		itemElement.tabIndex = 0;
		itemElement.setAttribute('role', 'button');
		itemElement.addEventListener('click', runCommand);
		itemElement.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}

			event.preventDefault();
			runCommand();
		});
	}

	itemElement.append(labelElement, valueElement);
	return itemElement;
}
