import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import {
	createSessionView,
	type SessionView,
	type SessionViewProps,
} from 'cs/sessions/browser/parts/sessions/sessionView';

import 'cs/sessions/browser/parts/media/sessionView.css';

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
) {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	return element;
}

export type SessionsPartViewProps = SessionViewProps;

export class SessionsPartView {
	readonly id = SESSION_PART_IDS.sessions;

	private readonly element = createElement('section', 'sessions-part');
	private readonly sessionView: SessionView;
	private disposed = false;

	constructor(props: SessionsPartViewProps) {
		this.sessionView = createSessionView(props);
		this.element.append(this.sessionView.getElement());
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionsPartViewProps) {
		if (this.disposed) {
			return;
		}

		this.sessionView.setProps(props);
	}

	focus() {
		this.sessionView.focus();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.sessionView.dispose();
		this.element.replaceChildren();
	}
}

export function createSessionsPartView(props: SessionsPartViewProps) {
	return new SessionsPartView(props);
}
