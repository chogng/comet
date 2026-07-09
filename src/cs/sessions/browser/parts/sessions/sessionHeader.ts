import 'cs/sessions/browser/parts/media/sessionView.css';
import { $ } from 'cs/base/browser/dom';

export type SessionHeaderViewProps = {
	leadingActionsElement?: HTMLElement | null;
	trailingActionsElement?: HTMLElement | null;
};

export class SessionHeaderView {
	private props: SessionHeaderViewProps;

	//#region Session header slots

	private readonly element = $<HTMLElementTagNameMap['header']>('header.comet-session-header');
	private readonly leadingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-header-leading');
	private readonly trailingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-header-trailing');

	//#endregion

	private disposed = false;

	constructor(props: SessionHeaderViewProps) {
		this.props = props;
		this.element.append(this.leadingElement, this.trailingElement);
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
		this.syncHeaderSlot(
			this.leadingElement,
			this.props.leadingActionsElement ?? null,
		);
		this.syncTrailingActions(this.props.trailingActionsElement ?? null);
	}

	//#region Session header actions

	private syncHeaderSlot(
		slotElement: HTMLElement,
		actionsElement: HTMLElement | null,
	) {
		const currentElement = slotElement.firstElementChild;
		if (actionsElement) {
			if (currentElement !== actionsElement) {
				slotElement.replaceChildren(actionsElement);
			}
			return;
		}

		if (currentElement) {
			slotElement.replaceChildren();
		}
	}

	private syncTrailingActions(actionsElement: HTMLElement | null) {
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

	//#endregion
}

export function createSessionHeaderView(props: SessionHeaderViewProps) {
	return new SessionHeaderView(props);
}
