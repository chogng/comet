/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';

export type ChatInputToolbarActionItem = ActionBarItem;

export type ChatInputToolbarActionOptions = {
	readonly label: string;
	readonly icon: LxIconName;
	readonly disabled?: boolean;
	readonly progress?: ArticleBatchTaskProgress | null;
	readonly onClick: () => void | Promise<void>;
};

function normalizeProgress(progress: ArticleBatchTaskProgress) {
	const total = Math.max(0, progress.total);
	const current = Math.max(0, Math.min(progress.current, total));
	const percent = total > 0 ? Math.round((current / total) * 100) : 0;
	return { current, total, percent };
}

function renderChatInputToolbarActionProgress(
	label: string,
	progress: ArticleBatchTaskProgress,
) {
	const { current, total, percent } = normalizeProgress(progress);
	const content = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-content.comet-is-progress');
	const progressTrack = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-progress');
	const progressFill = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-progress-fill');
	const progressCount = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-progress-count');
	progressFill.style.width = `${percent}%`;
	progressCount.textContent = `${current}/${total}`;
	content.setAttribute('aria-label', `${label} ${progressCount.textContent}`);
	progressTrack.append(progressFill);
	content.append(createLxIcon('pause'), progressTrack, progressCount);
	return content;
}

export function renderChatInputToolbarActionContent(
	label: string,
	icon: LxIconName,
	trailingIcon?: LxIconName,
) {
	const content = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-content');
	const labelElement = $<HTMLSpanElement>('span.comet-chat-composer-input-toolbar-action-label');
	labelElement.textContent = label;
	content.append(createLxIcon(icon), labelElement);
	if (trailingIcon) {
		content.append(createLxIcon(trailingIcon, 'comet-chat-composer-input-toolbar-action-trailing-icon'));
	}
	return content;
}

export function createChatInputToolbarActionItem({
	label,
	icon,
	disabled,
	progress,
	onClick,
}: ChatInputToolbarActionOptions): ChatInputToolbarActionItem {
	const normalizedProgress = progress ? normalizeProgress(progress) : null;
	return {
		label,
		title: normalizedProgress ? `${label} ${normalizedProgress.current}/${normalizedProgress.total}` : label,
		mode: 'text',
		content: () => {
			if (progress) {
				return renderChatInputToolbarActionProgress(label, progress);
			}

			return renderChatInputToolbarActionContent(label, icon);
		},
		buttonClassName: 'comet-chat-composer-input-toolbar-action',
		disabled: progress ? false : disabled,
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
