import 'cs/sessions/browser/parts/media/sessionView.css';
import { $ } from 'cs/base/browser/dom';

export type SessionTitlebarViewProps = {
	leadingActionsElement?: HTMLElement | null;
	trailingActionsElement?: HTMLElement | null;
};

export class SessionTitlebarView {
	private props: SessionTitlebarViewProps;

	private readonly element = $<HTMLElementTagNameMap['header']>('header.comet-session-titlebar');
	private readonly leadingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-titlebar-leading');
	private readonly trailingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-titlebar-trailing');
	private readonly windowControlsSpacerElement = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-window-controls-spacer');

	private disposed = false;

	constructor(props: SessionTitlebarViewProps) {
		this.props = props;
		this.element.append(
			this.leadingElement,
			this.trailingElement,
			this.windowControlsSpacerElement,
		);
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionTitlebarViewProps) {
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
		this.syncTitlebarActions(
			this.leadingElement,
			this.props.leadingActionsElement ?? null,
		);
		this.syncTitlebarActions(
			this.trailingElement,
			this.props.trailingActionsElement ?? null,
		);
	}

	private syncTitlebarActions(
		containerElement: HTMLElement,
		actionsElement: HTMLElement | null,
	) {
		const currentElement = containerElement.firstElementChild;
		if (actionsElement) {
			if (currentElement !== actionsElement) {
				containerElement.replaceChildren(actionsElement);
			}
			return;
		}

		if (currentElement) {
			containerElement.replaceChildren();
		}
	}
}

export function createSessionTitlebarView(props: SessionTitlebarViewProps) {
	return new SessionTitlebarView(props);
}
