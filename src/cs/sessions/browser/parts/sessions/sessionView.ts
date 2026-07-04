import {
	createSessionChatView,
	type SessionChatView,
	type SessionChatViewProps,
} from 'cs/sessions/browser/parts/sessions/chatView';
import type { Event } from 'cs/base/common/event';
import type { ChatOpenLinkRequest } from 'cs/workbench/contrib/chat/browser/chat';
import {
	createSessionHeaderView,
	type SessionHeaderView,
} from 'cs/sessions/browser/parts/sessions/sessionHeader';
import { $ } from 'cs/base/browser/dom';

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
	readonly onDidRequestOpenLink: Event<ChatOpenLinkRequest>;
	private disposed = false;

	constructor(props: SessionViewProps) {
		this.headerView = createSessionHeaderView({
			trailingActionsElement: props.headerTrailingActionsElement ?? null,
		});
		this.chatView = createSessionChatView(props.chatProps);
		this.onDidRequestOpenLink = this.chatView.onDidRequestOpenLink;
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

export function createSessionView(props: SessionViewProps) {
	return new SessionView(props);
}
