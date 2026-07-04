/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarActionItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';

export type ChatInputToolbarActionItem = ActionBarActionItem;

export type ChatInputToolbarActionOptions = {
	readonly label: string;
	readonly icon: LxIconName;
	readonly disabled?: boolean;
	readonly onClick: () => void | Promise<void>;
};

export function createChatInputToolbarActionItem({
	label,
	icon,
	disabled,
	onClick,
}: ChatInputToolbarActionOptions): ChatInputToolbarActionItem {
	return {
		label,
		title: label,
		mode: 'custom',
		content: () => {
			const content = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-content');
			const labelElement = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-label');
			labelElement.textContent = label;
			content.append(createLxIcon(icon), labelElement);
			return content;
		},
		buttonClassName: 'comet-chat-composer-input-toolbar-action',
		disabled,
		onClick: () => {
			void onClick();
		},
	};
}

/**
 * Renders the input-surface action dock, matching upstream plan-review docking where features own the content.
 */
export function renderChatInputToolbar(
	items: readonly ChatInputToolbarActionItem[],
	disposables: DisposableStore,
) {
	if (items.length === 0) {
		return undefined;
	}

	const toolbar = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-input-toolbar');
	const actionsView = createActionBarView({
		className: 'comet-chat-composer-input-toolbar-actions',
		ariaLabel: localize('chatInputToolbar', "Chat Input Toolbar"),
		items,
	});
	disposables.add(actionsView);
	toolbar.append(actionsView.getElement());
	return toolbar;
}
