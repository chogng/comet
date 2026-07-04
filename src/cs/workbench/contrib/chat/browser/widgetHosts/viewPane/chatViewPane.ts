/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/chatWidget';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type ChatViewPaneProps = ChatWidgetProps & {
	readonly isPrimarySidebarVisible?: boolean;
	readonly headerActionsElement?: HTMLElement | null;
	readonly headerTrailingActionsElement?: HTMLElement | null;
};

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

export class ChatViewPane {
	private readonly element = createElement(
		'section',
		'agentbar',
	);
	private readonly headerElement = createElement(
		'div',
		'agentbar-header',
	);
	private readonly headerActionsContainerElement = createElement(
		'div',
		'agentbar-header-actions',
	);
	private readonly headerLeadingActionsElement = createElement(
		'div',
		'agentbar-header-leading',
	);
	private readonly headerTrailingActionsElement = createElement(
		'div',
		'agentbar-header-trailing',
	);
	private readonly leadingWindowControlsSpacer = createElement(
		'div',
		'agentbar-header-window-controls-spacer',
	);
	private readonly chatWidget: ChatWidget;

	constructor(props: ChatViewPaneProps) {
		registerWorkbenchPartDomNode(
			WORKBENCH_PART_IDS.agentSidebar,
			this.element,
		);
		this.chatWidget = new ChatWidget(props);
		if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
			this.leadingWindowControlsSpacer.style.setProperty(
				'--window-controls-width',
				`${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
			);
			this.headerElement.append(this.leadingWindowControlsSpacer);
		}
		this.headerActionsContainerElement.append(
			this.headerLeadingActionsElement,
			this.headerTrailingActionsElement,
		);
		this.headerElement.append(this.headerActionsContainerElement);
		this.element.append(this.headerElement, this.chatWidget.getElement());
		this.renderHeader(props);
	}

	getElement() {
		return this.element;
	}

	getHeaderElement() {
		return this.headerElement;
	}

	setProps(props: ChatViewPaneProps) {
		this.chatWidget.setProps(props);
		this.renderHeader(props);
	}

	dispose() {
		this.chatWidget.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.agentSidebar, null);
		this.element.replaceChildren();
	}

	private renderHeader(props: ChatViewPaneProps) {
		this.syncHeaderSlot(
			this.headerLeadingActionsElement,
			props.headerActionsElement ?? null,
		);
		this.syncHeaderSlot(
			this.headerTrailingActionsElement,
			props.headerTrailingActionsElement ?? null,
		);
	}

	private syncHeaderSlot(
		slotElement: HTMLElement,
		headerActionsElement: HTMLElement | null,
	) {
		const currentHeaderActionsElement = slotElement.firstElementChild;
		if (headerActionsElement) {
			if (currentHeaderActionsElement !== headerActionsElement) {
				slotElement.replaceChildren(headerActionsElement);
			}
			return;
		}

		if (currentHeaderActionsElement) {
			slotElement.replaceChildren();
		}
	}
}

export function createChatViewPane(props: ChatViewPaneProps) {
	return new ChatViewPane(props);
}
