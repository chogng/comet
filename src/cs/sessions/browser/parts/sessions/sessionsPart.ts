import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import {
	SessionView,
	type SessionViewProps,
} from 'cs/sessions/browser/parts/sessions/sessionView';
import { $ } from 'cs/base/browser/dom';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionsPartViewProps = SessionViewProps;

export class SessionsPartView {
	readonly id = SESSION_PART_IDS.sessions;

	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-sessions-part');
	private readonly sessionView: SessionView;
	private disposed = false;

	constructor(
		props: SessionsPartViewProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.sessionView = instantiationService.createInstance(SessionView, props);
		this.element.append(this.sessionView.getElement());
	}

	getElement() {
		return this.element;
	}

	getHeaderElement() {
		return this.sessionView.getHeaderElement();
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
