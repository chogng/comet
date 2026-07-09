/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { Dialog } from 'cs/base/browser/ui/dialog/dialog';
import {
	DisposableStore,
	toDisposable,
} from 'cs/base/common/lifecycle';
import {
	getMenuActions,
	MenuId,
	MenuItemAction,
} from 'cs/platform/actions/common/actions';
import { getLocaleMessages } from 'language/i18n';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';

interface WorkbenchCommandPaletteItem {
	readonly action: MenuItemAction;
	readonly label: string;
	readonly category: string | undefined;
	readonly id: string;
	readonly searchText: string;
}

function localizeOptionalValue(value: string | { value: string } | undefined) {
	if (!value) {
		return undefined;
	}

	if (typeof value === 'string') {
		return value;
	}

	return value.value;
}

function formatCommandLabel(item: WorkbenchCommandPaletteItem) {
	return item.category ? `${item.category}: ${item.label}` : item.label;
}

function getCommandPaletteItems(): WorkbenchCommandPaletteItem[] {
	const menuActions = getMenuActions(MenuId.CommandPalette)
		.flatMap(([, actions]) => actions)
		.filter((action): action is MenuItemAction =>
			action instanceof MenuItemAction && action.enabled,
		);

	return menuActions
		.map(action => {
			const category = localizeOptionalValue(action.item.category);
			const label = action.label;
			const id = action.id;
			return {
				action,
				label,
				category,
				id,
				searchText: [label, category, id]
					.filter((value): value is string => Boolean(value))
					.join(' ')
					.toLowerCase(),
			};
		})
		.sort((left, right) =>
			formatCommandLabel(left).localeCompare(formatCommandLabel(right)),
		);
}

function getMatchingItems(
	items: readonly WorkbenchCommandPaletteItem[],
	query: string,
) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return [...items];
	}

	return items.filter(item => item.searchText.includes(normalizedQuery));
}

export function showWorkbenchCommandPalette(
	commandService: IWorkbenchCommandService,
) {
	const ui = getLocaleMessages(localeService.getLocale());
	const items = getCommandPaletteItems();
	const dialog = new Dialog({
		title: ui.commandPaletteTitle,
		message: '',
		buttons: [{
			label: ui.toastClose,
		}],
		cancelId: 0,
		closeLabel: ui.toastClose,
		renderBody: (container, controls) => {
			const disposables = new DisposableStore();
			const buttonDisposables = disposables.add(new DisposableStore());
			const body = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-body');
			const input = $<HTMLElementTagNameMap['input']>('input.comet-workbench-command-palette-input') as HTMLInputElement;
			const list = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-list');
			let activeItems = getMatchingItems(items, '');
			let selectedIndex = activeItems.length > 0 ? 0 : -1;

			input.type = 'search';
			input.placeholder = ui.commandPaletteSearchPlaceholder;
			input.setAttribute('aria-label', ui.commandPaletteSearchPlaceholder);

			const runItem = (item: WorkbenchCommandPaletteItem) => {
				controls.close(0);
				commandService.executeCommand(item.action.id);
			};

			const renderList = () => {
				buttonDisposables.clear();
				list.replaceChildren();
				activeItems = getMatchingItems(items, input.value);
				selectedIndex = activeItems.length > 0
					? Math.max(0, Math.min(selectedIndex, activeItems.length - 1))
					: -1;

				if (activeItems.length === 0) {
					list.append($<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-empty', undefined, ui.commandPaletteNoCommands));
					return;
				}

				activeItems.forEach((item, index) => {
					const content = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-text');
					const label = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-label', undefined, formatCommandLabel(item));
					const shortcut = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-shortcut', undefined, item.id);
					content.append(label, shortcut);

					const button = buttonDisposables.add(new ButtonView({
						className: 'comet-workbench-command-palette-item',
						content,
						onClick: () => runItem(item),
					}));
					button.getElement().classList.toggle('is-selected', index === selectedIndex);
					list.append(button.getElement());
				});
			};

			disposables.add(toDisposable(() => {
				input.removeEventListener('input', handleInput);
				input.removeEventListener('keydown', handleKeyDown);
			}));

			const handleInput = () => {
				selectedIndex = 0;
				renderList();
			};

			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					event.stopPropagation();
					if (activeItems.length > 0) {
						selectedIndex = Math.min(selectedIndex + 1, activeItems.length - 1);
						renderList();
					}
					return;
				}

				if (event.key === 'ArrowUp') {
					event.preventDefault();
					event.stopPropagation();
					if (activeItems.length > 0) {
						selectedIndex = Math.max(selectedIndex - 1, 0);
						renderList();
					}
					return;
				}

				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					const item = activeItems[selectedIndex];
					if (item) {
						runItem(item);
					}
				}
			};

			input.addEventListener('input', handleInput);
			input.addEventListener('keydown', handleKeyDown);

			const animationFrame = requestAnimationFrame(() => input.focus());
			disposables.add(toDisposable(() => cancelAnimationFrame(animationFrame)));

			renderList();
			body.append(input, list);
			container.append(body);
			return disposables;
		},
	});
	void dialog.show().finally(() => dialog.dispose());
	return true;
}
