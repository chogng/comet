/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/workbench/browser/parts/notifications/media/notificationsCenter.css';
import 'cs/workbench/browser/parts/notifications/media/notificationsActions.css';
import { $, append } from 'cs/base/browser/dom';
import { createActionBarView, type ActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Disposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { NotificationsList } from 'cs/workbench/browser/parts/notifications/notificationsList';
import {
	CLEAR_ALL_NOTIFICATIONS,
	HIDE_NOTIFICATIONS_CENTER,
} from 'cs/workbench/browser/parts/notifications/notificationsCommands';
import type {
	INotificationChangeEvent,
	NotificationsModel,
} from 'cs/workbench/common/notifications';

export class NotificationsCenter extends Disposable {
	private readonly element = $('section.comet-notifications-center.bottom-right');
	private readonly titleElement = $('span.comet-notifications-center-header-title');
	private readonly toolbar: ActionBarView;
	private readonly list: NotificationsList;
	private visible = false;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly model: NotificationsModel,
	) {
		super();

		const header = $('header.comet-notifications-center-header');
		const toolbarElement = $('div.comet-notifications-center-header-toolbar');
		this.toolbar = this._register(createActionBarView());
		append(toolbarElement, this.toolbar.getElement());
		append(header, this.titleElement, toolbarElement);

		const listHost = $('div.comet-notifications-center-list-host');
		append(this.element, header, listHost);
		append(this.container, this.element);

		this.list = this._register(new NotificationsList(listHost, this.model, {
			emptyMessage: localize('notificationsEmpty', "No new notifications"),
		}));
		this._register(this.model.onDidChangeNotification(this.handleNotificationChange));
		this.updateHeader();
	}

	get isVisible() {
		return this.visible;
	}

	getElement() {
		return this.element;
	}

	show() {
		if (this.disposed) {
			return;
		}

		this.visible = true;
		this.element.classList.add('visible');
		for (const item of this.model.notifications) {
			item.updateVisibility(true);
		}
		this.list.focusFirst();
	}

	hide() {
		if (this.disposed) {
			return;
		}

		this.visible = false;
		this.element.classList.remove('visible');
		for (const item of this.model.notifications) {
			item.updateVisibility(false);
		}
	}

	toggle() {
		if (this.visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	override dispose() {
		if (this.disposed) {
			return;
		}

		if (this.visible) {
			this.hide();
		}
		this.disposed = true;
		this.element.remove();
		super.dispose();
	}

	private readonly handleNotificationChange = (_event: INotificationChangeEvent) => {
		this.updateHeader();
		if (this.visible && this.model.notifications.length === 0) {
			this.hide();
		}
	};

	private updateHeader() {
		const notificationsLabel = localize('notifications', "Notifications");
		const clearAllLabel = localize('clearAllNotifications', "Clear All Notifications");
		const hideLabel = localize('hideNotifications', "Hide Notifications");
		this.titleElement.textContent = this.model.notifications.length === 0
			? localize('notificationsEmpty', "No new notifications")
			: notificationsLabel;
		this.toolbar.setProps({
			ariaLabel: localize('notificationsToolbar', "Notification Center Actions"),
			className: 'comet-notifications-center-actions',
			items: [
				{
					id: CLEAR_ALL_NOTIFICATIONS,
					label: clearAllLabel,
					disabled: !this.model.notifications.some(item => !item.hasProgress),
					content: createLxIcon('trash'),
					run: () => this.model.clearAll(),
				},
				{
					id: HIDE_NOTIFICATIONS_CENTER,
					label: hideLabel,
					content: createLxIcon('close'),
					run: () => this.hide(),
				},
			],
		});
	}
}

export function createNotificationsCenter(
	container: HTMLElement,
	model: NotificationsModel,
) {
	return new NotificationsCenter(container, model);
}
