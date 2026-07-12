/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ActionBarMenuItem } from 'cs/base/browser/ui/actionbar/actionbar';
import {
	DropdownMenuActionViewItem,
	type DropdownMenuActionViewItemOptions,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createFilterMenuHeader } from 'cs/base/browser/ui/dropdown/dropdownSearchHeader';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { ChatModelDropdownOption } from 'cs/workbench/contrib/chat/browser/chat';
import { $ } from 'cs/base/browser/dom';
import type { ContextMenuService } from 'cs/base/browser/contextmenu';
import type { DropdownContextViewProvider } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { LocaleMessages } from 'language/locales';

export interface IChatInputModelPickerProps {
	readonly activeModelLabel: string;
	readonly modelOptions: readonly ChatModelDropdownOption[];
	readonly selectedModelId: string | undefined;
	readonly onSelectModel: (modelId: string | undefined) => void;
	readonly ui: LocaleMessages;
}

export class ChatInputModelPickerActionViewItem {
	private props: IChatInputModelPickerProps;
	private modelDropdownActionViewItem: DropdownMenuActionViewItem | undefined;

	constructor(
		props: IChatInputModelPickerProps,
		private readonly contextMenuService: ContextMenuService,
		private readonly contextViewProvider: DropdownContextViewProvider,
	) {
		this.props = props;
	}

	setProps(props: IChatInputModelPickerProps): void {
		this.props = props;
		this.modelDropdownActionViewItem?.setOptions(this.createOptions());
	}

	render(container: HTMLElement): IDisposable {
		const viewItem = new DropdownMenuActionViewItem(this.createOptions());
		this.modelDropdownActionViewItem = viewItem;
		viewItem.render(container);
		return toDisposable(() => {
			viewItem.dispose();
			if (this.modelDropdownActionViewItem === viewItem) {
				this.modelDropdownActionViewItem = undefined;
			}
		});
	}

	private createOptions(): DropdownMenuActionViewItemOptions {
		const label = this.props.selectedModelId
			? this.props.modelOptions.find(option => option.value === this.props.selectedModelId)?.label
				?? this.props.activeModelLabel
			: this.props.ui.chatModelAuto;
		return {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewProvider,
			label,
			title: label,
			mode: 'custom',
			buttonClassName: 'comet-chat-model-switch-btn',
			className: 'comet-chat-model-switch',
			disabled: this.props.modelOptions.length === 0,
			minWidth: 236,
			menuClassName: 'comet-chat-model-menu',
			menuData: 'chat-model-menu',
			content: () => this.renderTrigger(label),
			menu: this.createMenuItems(''),
			menuHeader: createFilterMenuHeader({
				inputClassName: 'comet-chat-model-menu-search-input',
				placeholder: this.props.ui.chatModelSearch,
				ariaLabel: this.props.ui.chatModelSearch,
				getMenuItems: query => this.createMenuItems(query),
			}),
		};
	}

	private renderTrigger(labelText: string): HTMLElement {
		const trigger = $<HTMLElementTagNameMap['span']>('span.comet-chat-model-switch-trigger');
		const label = $<HTMLElementTagNameMap['span']>('span.comet-chat-model-switch-label');
		label.textContent = labelText;
		trigger.append(label, createLxIcon('chevron-down', 'comet-chat-model-switch-chevron'));
		return trigger;
	}

	private createMenuItems(query: string): readonly ActionBarMenuItem[] {
		const normalizedQuery = query.trim().toLowerCase();
		const matches = (option: ChatModelDropdownOption): boolean => !normalizedQuery
			|| [option.label, option.title, option.value]
				.filter((value): value is string => typeof value === 'string')
				.some(value => value.toLowerCase().includes(normalizedQuery));
		const autoLabel = this.props.ui.chatModelAuto;
		const items: ActionBarMenuItem[] = [];
		if (!normalizedQuery || autoLabel.toLowerCase().includes(normalizedQuery)) {
			items.push({
				label: autoLabel,
				title: this.props.ui.chatModelAutoTitle,
				checked: this.props.selectedModelId === undefined,
				onClick: () => this.props.onSelectModel(undefined),
			});
		}
		for (const option of this.props.modelOptions.filter(matches)) {
			items.push({
				label: option.label,
				title: option.title,
				icon: option.icon,
				disabled: option.disabled,
				checked: option.value === this.props.selectedModelId,
				onClick: () => this.props.onSelectModel(option.value),
			});
		}
		return items.length > 0 ? items : [{
			id: 'chat-model-empty',
			label: this.props.ui.chatModelSearchEmpty,
			disabled: true,
		}];
	}
}
