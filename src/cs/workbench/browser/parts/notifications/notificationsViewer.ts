/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from 'cs/base/browser/dom';
import { createActionBarView, type ActionBarActionItem } from 'cs/base/browser/ui/actionbar/actionbar';
import {
	createLxIcon,
	type LxIconName,
} from 'cs/base/browser/ui/lxicons/lxicons';
import type { IAction } from 'cs/base/common/actions';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import {
	Severity,
} from 'cs/platform/notification/common/notification';
import type { NotificationViewItem } from 'cs/workbench/common/notifications';

export function getNotificationSeverityClassName(severity: Severity) {
	switch (severity) {
		case Severity.Error:
			return 'comet-notification-severity-error';
		case Severity.Warning:
			return 'comet-notification-severity-warning';
		case Severity.Info:
			return 'comet-notification-severity-info';
		default:
			return 'comet-notification-severity-ignore';
	}
}

export function getNotificationSeverityLabel(severity: Severity) {
	switch (severity) {
		case Severity.Error:
			return localize('notificationError', "Error");
		case Severity.Warning:
			return localize('notificationWarning', "Warning");
		case Severity.Info:
			return localize('notificationInfo', "Info");
		default:
			return localize('notification', "Notification");
	}
}

function getNotificationSeverityIconName(severity: Severity): LxIconName {
	switch (severity) {
		case Severity.Error:
			return 'error';
		case Severity.Warning:
			return 'warning';
		case Severity.Info:
			return 'info';
		default:
			return 'bell';
	}
}

export function getNotificationSourceLabel(item: NotificationViewItem) {
	if (!item.source) {
		return '';
	}

	return typeof item.source === 'string' ? item.source : item.source.label;
}

function createNotificationActionItem(
	action: IAction,
	primary: boolean,
	onDidRunAction?: (action: IAction) => void,
): ActionBarActionItem {
	return {
		id: action.id,
		label: action.tooltip || action.label,
		disabled: !action.enabled,
		mode: 'text',
		content: action.label,
		buttonClassName: primary
			? 'comet-notification-list-item-action comet-is-primary'
			: 'comet-notification-list-item-action comet-is-secondary',
		run: async () => {
			try {
				await action.run();
			} finally {
				onDidRunAction?.(action);
			}
		},
	};
}

export type NotificationRenderOptions = {
	compact?: boolean;
	onDidRunAction?: (action: IAction) => void;
	onDidClose?: () => void;
};

export function renderNotificationItem(
	item: NotificationViewItem,
	container: HTMLElement,
	options: NotificationRenderOptions = {},
) {
	const disposables = new DisposableStore();
	clearNode(container);
	container.className = [
		'comet-notification-list-item',
		getNotificationSeverityClassName(item.severity),
		options.compact ? 'comet-is-compact' : '',
	]
		.filter(Boolean)
		.join(' ');

	const mainRow = $('div.comet-notification-list-item-main-row');
	const icon = $('span.comet-notification-list-item-icon');
	icon.setAttribute('aria-label', getNotificationSeverityLabel(item.severity));
	append(icon, createLxIcon(getNotificationSeverityIconName(item.severity)));

	const message = $('div.comet-notification-list-item-message');
	message.textContent = item.messageText;

	const closeLabel = localize('closeNotification', "Close Notification");
	const closeActionBar = disposables.add(createActionBarView({
		ariaLabel: localize('notificationActions', "Notification Actions"),
		className: 'comet-notification-list-item-close',
		items: [{
			id: 'close',
			label: closeLabel,
			content: createLxIcon('close'),
			run: () => {
				options.onDidClose?.();
				item.close();
			},
		}],
	}));

	append(mainRow, icon, message, closeActionBar.getElement());
	append(container, mainRow);

	const sourceLabel = getNotificationSourceLabel(item);
	if (sourceLabel) {
		const source = $('div.comet-notification-list-item-source');
		source.textContent = sourceLabel;
		append(container, source);
	}

	const primaryActions = item.actions?.primary ?? [];
	const secondaryActions = options.compact ? [] : item.actions?.secondary ?? [];
	if (primaryActions.length > 0 || secondaryActions.length > 0) {
		const actions = disposables.add(createActionBarView({
			ariaLabel: localize('notificationCommands', "Notification Commands"),
			className: 'comet-notification-list-item-actions',
			items: [
				...primaryActions.map(action => createNotificationActionItem(action, true, options.onDidRunAction)),
				...secondaryActions.map(action => createNotificationActionItem(action, false, options.onDidRunAction)),
			],
		}));
		append(container, actions.getElement());
	}

	if (item.hasProgress) {
		const progress = $('div.comet-notification-list-item-progress');
		const bar = $('div.comet-notification-list-item-progress-bar');
		const state = item.progress.state;
		if (typeof state.total === 'number' && typeof state.worked === 'number') {
			bar.style.width = `${Math.max(0, Math.min(100, (state.worked / state.total) * 100))}%`;
		}
		append(progress, bar);
		append(container, progress);
	}

	return disposables;
}
