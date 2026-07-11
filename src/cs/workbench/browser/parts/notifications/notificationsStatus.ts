/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/workbench/browser/parts/notifications/media/notificationsActions.css';
import { $, append } from 'cs/base/browser/dom';
import { createButtonView, type ButtonView } from 'cs/base/browser/ui/button/button';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type {
	IStatusMessageChangeEvent,
	NotificationsModel,
} from 'cs/workbench/common/notifications';
import type { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';

export class NotificationsStatus {
	private readonly element = $('div.comet-notifications-status.comet-is-hidden');
	private readonly button: ButtonView;
	private readonly statusMessageElement = $('span.comet-notifications-status-message');
	private readonly disposables = new DisposableStore();
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly model: NotificationsModel,
		private readonly center: NotificationsCenter,
	) {
		this.button = this.disposables.add(createButtonView());
		append(this.element, this.statusMessageElement, this.button.getElement());
		append(this.container, this.element);

		this.disposables.add(this.model.onDidChangeNotification(() => this.update()));
		this.disposables.add(this.model.onDidChangeStatusMessage(this.handleStatusMessageChange));
		this.update();
	}

	getElement() {
		return this.element;
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.disposables.dispose();
		this.element.remove();
	}

	private readonly handleStatusMessageChange = (_event: IStatusMessageChangeEvent) => {
		this.update();
	};

	private update() {
		const count = this.model.notifications.length;
		const statusMessage = this.model.statusMessage?.messageText ?? '';
		this.statusMessageElement.textContent = statusMessage;
		const label = count > 0
			? localize('notificationCount', "Notifications ({0})", count)
			: localize('notifications', "Notifications");
		this.button.setProps({
			className: 'comet-notifications-status-button',
			variant: 'ghost',
			size: 'sm',
			leftIcon: createLxIcon(count > 0 ? 'bell-dot' : 'bell'),
			content: label,
			ariaLabel: count > 0
				? localize('notificationCount', "Notifications ({0})", count)
				: localize('notificationsEmpty', "No new notifications"),
			onClick: () => this.center.toggle(),
		});
		this.element.classList.toggle('comet-is-hidden', count === 0 && statusMessage.length === 0);
	}
}

export function createNotificationsStatus(
	container: HTMLElement,
	model: NotificationsModel,
	center: NotificationsCenter,
) {
	return new NotificationsStatus(container, model, center);
}
