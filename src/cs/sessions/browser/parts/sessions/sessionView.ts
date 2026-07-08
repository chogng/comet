import {
	SessionChatView,
	type SessionChatViewProps,
} from 'cs/sessions/browser/parts/sessions/chatView';
import {
	createSessionHeaderView,
	type SessionHeaderView,
} from 'cs/sessions/browser/parts/sessions/sessionHeader';
import { $ } from 'cs/base/browser/dom';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionViewProps = {
	chatProps: SessionChatViewProps;
	headerTrailingActionsElement?: HTMLElement | null;
};

export class SessionView {
	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-session-view');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-session-view-content');
	private readonly headerView: SessionHeaderView;
	private readonly chatView: SessionChatView;
	private disposed = false;

	constructor(
		props: SessionViewProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.headerView = createSessionHeaderView({
			trailingActionsElement: props.headerTrailingActionsElement ?? null,
		});
		this.chatView = instantiationService.createInstance(
			SessionChatView,
			props.chatProps,
		);
		this.contentElement.append(this.chatView.getElement());
		this.element.append(this.headerView.getElement(), this.contentElement);
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionViewProps) {
		if (this.disposed) {
			return;
		}

		this.headerView.setProps({
			trailingActionsElement: props.headerTrailingActionsElement ?? null,
		});
		this.chatView.setProps(props.chatProps);
	}

	focus() {
		this.chatView.focus();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.headerView.dispose();
		this.chatView.dispose();
		this.element.replaceChildren();
	}
}
