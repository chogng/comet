import 'cs/sessions/browser/parts/media/sessionView.css';
import { $ } from 'cs/base/browser/dom';

export type SessionHeaderViewProps = {
	trailingActionsElement?: HTMLElement | null;
};

export class SessionHeaderView {
	private props: SessionHeaderViewProps;
	private readonly element = $<HTMLElementTagNameMap['header']>('header.comet-session-header');
	private readonly trailingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-header-trailing');
	private disposed = false;

	constructor(props: SessionHeaderViewProps) {
		this.props = props;
		this.element.append(this.trailingElement);
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionHeaderViewProps) {
		if (this.disposed) {
			return;
		}

		this.props = props;
		this.render();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.element.replaceChildren();
	}

	private render() {
		this.syncTrailingActions(this.props.trailingActionsElement ?? null);
	}

	private syncTrailingActions(actionsElement: HTMLElement | null) {
		this.element.hidden = !actionsElement;
		const currentElement = this.trailingElement.firstElementChild;
		if (actionsElement) {
			if (currentElement !== actionsElement) {
				this.trailingElement.replaceChildren(actionsElement);
			}
			return;
		}

		if (currentElement) {
			this.trailingElement.replaceChildren();
		}
	}
}

export function createSessionHeaderView(props: SessionHeaderViewProps) {
	return new SessionHeaderView(props);
}
