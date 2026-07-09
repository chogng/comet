import 'cs/sessions/browser/parts/media/sessionView.css';
import { $ } from 'cs/base/browser/dom';

export class SessionHeaderView {
	private readonly element = $<HTMLElementTagNameMap['header']>('header.comet-session-header');
	private disposed = false;

	constructor() {
		this.element.hidden = true;
	}

	getElement() {
		return this.element;
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.element.replaceChildren();
	}
}

export function createSessionHeaderView() {
	return new SessionHeaderView();
}
