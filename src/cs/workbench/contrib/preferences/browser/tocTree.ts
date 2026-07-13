/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import {
	getSettingsPageNavigationItems,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPageId } from 'cs/workbench/contrib/preferences/common/settings';
import type { SettingsTreeModel } from 'cs/workbench/contrib/preferences/browser/settingsTreeModel';
import {
	createSettingsElement,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import type { LocaleMessages } from 'language/locales';

type TOCTreeItem = {
	readonly kind: 'item';
	readonly id: SettingsPageId;
	readonly pageId: SettingsPageId;
	readonly label: string;
	readonly icon?: LxIconName;
};

type TOCTreeSpacer = {
	readonly kind: 'spacer';
	readonly id: string;
	readonly height: number;
};

type TOCTreeElement = TOCTreeItem | TOCTreeSpacer;

type TOCTreeOptions = {
	readonly title: string;
	readonly activePageId: SettingsPageId;
	readonly onDidSelectPage: (pageId: SettingsPageId) => void;
};

export class TOCTreeModel {
	private elements: readonly TOCTreeElement[] = [];

	constructor(
		labels: LocaleMessages,
		settingsTreeModel: SettingsTreeModel,
	) {
		this.update(labels, settingsTreeModel);
	}

	update(
		labels: LocaleMessages,
		settingsTreeModel: SettingsTreeModel,
	) {
		const visiblePageIds = settingsTreeModel.getVisiblePageIds();
		const items = getSettingsPageNavigationItems(labels).filter(item => visiblePageIds.includes(item.id));
		const elements: TOCTreeElement[] = [];

		for (const item of items) {
			elements.push({
				kind: 'item',
				id: item.id,
				pageId: item.id,
				label: item.label,
				icon: item.icon,
			});

			if (item.id === 'appearance') {
				elements.push({
					kind: 'spacer',
					id: 'appearance-spacer',
					height: 12,
				});
			}
		}

		this.elements = elements;
	}

	getChildren() {
		return this.elements;
	}

	getItems() {
		return this.elements.filter((element): element is TOCTreeItem => element.kind === 'item');
	}
}

export class TOCTree {
	private options: TOCTreeOptions;
	private pendingFocusItemId: SettingsPageId | null = null;
	private readonly renderDisposables = new DisposableStore();
	private readonly element = createSettingsElement('nav', 'comet-settings-toc');
	private readonly list = createSettingsElement('ul', 'comet-settings-toc-list');

	constructor(
		private model: TOCTreeModel,
		options: TOCTreeOptions,
	) {
		this.options = options;
		this.element.append(this.list);
		this.render();
	}

	getElement() {
		return this.element;
	}

	update(
		model: TOCTreeModel,
		options: TOCTreeOptions,
	) {
		this.model = model;
		this.options = options;
		this.render();
	}

	dispose() {
		this.renderDisposables.dispose();
		this.element.replaceChildren();
	}

	private render() {
		const focusedItemBeforeRender = this.getFocusedItemId();
		this.renderDisposables.clear();
		const focusTargetItemId = this.pendingFocusItemId ?? focusedItemBeforeRender;
		this.pendingFocusItemId = null;
		this.element.ariaLabel = this.options.title;
		this.list.replaceChildren(...this.model.getChildren().map(element => this.renderElement(element)));
		if (focusTargetItemId) {
			this.focusItemButton(focusTargetItemId);
		}
	}

	private renderElement(element: TOCTreeElement) {
		if (element.kind === 'spacer') {
			const spacer = createSettingsElement('li', 'comet-settings-toc-spacer');
			spacer.style.height = `${element.height}px`;
			spacer.setAttribute('aria-hidden', 'true');
			return spacer;
		}

		const entry = createSettingsElement('li', 'comet-settings-toc-entry');
		const button = createSettingsElement('button', 'comet-settings-toc-item');
		const label = createSettingsElement('span', 'comet-settings-toc-label');
		const isActive = element.pageId === this.options.activePageId;

		button.type = 'button';
		button.dataset.pageTarget = element.pageId;
		button.dataset.tocItemId = element.id;
		button.classList.toggle('active', isActive);
		if (isActive) {
			button.setAttribute('aria-current', 'page');
		}
		if (element.icon) {
			label.append(createLxIcon(element.icon, 'comet-settings-toc-icon'));
		}
		label.append(document.createTextNode(element.label));
		button.append(label);
		const handleKeyDown = (event: KeyboardEvent) => this.handleItemKeyDown(event, element);
		const handleClick = () => this.selectPage(element.pageId, true, element.id);
		button.addEventListener('keydown', handleKeyDown);
		button.addEventListener('click', handleClick);
		this.renderDisposables.add(toDisposable(() => {
			button.removeEventListener('keydown', handleKeyDown);
			button.removeEventListener('click', handleClick);
		}));
		entry.append(button);
		return entry;
	}

	private handleItemKeyDown(
		event: KeyboardEvent,
		item: TOCTreeItem,
	) {
		const items = this.model.getItems();
		if (items.length === 0) {
			return;
		}

		const currentIndex = items.findIndex(candidate => candidate.id === item.id);
		if (currentIndex < 0) {
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowRight': {
				const nextItem = items[(currentIndex + 1) % items.length];
				this.selectPage(nextItem.pageId, true, nextItem.id);
				event.preventDefault();
				break;
			}
			case 'ArrowUp':
			case 'ArrowLeft': {
				const previousItem = items[(currentIndex - 1 + items.length) % items.length];
				this.selectPage(previousItem.pageId, true, previousItem.id);
				event.preventDefault();
				break;
			}
			case 'Home': {
				const firstItem = items[0];
				this.selectPage(firstItem.pageId, true, firstItem.id);
				event.preventDefault();
				break;
			}
			case 'End': {
				const lastItem = items[items.length - 1];
				this.selectPage(lastItem.pageId, true, lastItem.id);
				event.preventDefault();
				break;
			}
			case 'Enter':
			case ' ': {
				this.selectPage(item.pageId, true, item.id);
				event.preventDefault();
				break;
			}
		}
	}

	private selectPage(
		pageId: SettingsPageId,
		restoreFocus: boolean,
		focusItemId: SettingsPageId,
	) {
		if (restoreFocus) {
			this.pendingFocusItemId = focusItemId;
		}
		if (pageId === this.options.activePageId) {
			this.focusItemButton(focusItemId);
			return;
		}
		this.options.onDidSelectPage(pageId);
	}

	private focusItemButton(itemId: SettingsPageId) {
		const buttons = this.element.querySelectorAll<HTMLButtonElement>('.comet-settings-toc-item');
		for (const button of buttons) {
			if (button.dataset.tocItemId === itemId) {
				button.focus({ preventScroll: true });
				return;
			}
		}
	}

	private getFocusedItemId() {
		const activeElement = document.activeElement;
		if (!(activeElement instanceof HTMLButtonElement) || !this.element.contains(activeElement)) {
			return null;
		}
		const tocItemId = activeElement.dataset.tocItemId;
		if (!tocItemId) {
			return null;
		}
		return tocItemId as SettingsPageId;
	}
}
