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
	readonly topbarActionsElement?: HTMLElement | null;
	readonly topbarTrailingActionsElement?: HTMLElement | null;
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
	private readonly topbarElement = createElement(
		'div',
		'agentbar-topbar',
	);
	private readonly topbarActionsElement = createElement(
		'div',
		'agentbar-topbar-actions',
	);
	private readonly topbarLeadingActionsElement = createElement(
		'div',
		'agentbar-topbar-leading',
	);
	private readonly topbarTrailingActionsElement = createElement(
		'div',
		'agentbar-topbar-trailing',
	);
	private readonly leadingWindowControlsSpacer = createElement(
		'div',
		'agentbar-topbar-window-controls-spacer',
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
			this.topbarElement.append(this.leadingWindowControlsSpacer);
		}
		this.topbarActionsElement.append(
			this.topbarLeadingActionsElement,
			this.topbarTrailingActionsElement,
		);
		this.topbarElement.append(this.topbarActionsElement);
		this.element.append(this.topbarElement, this.chatWidget.getElement());
		this.renderTopbar(props);
	}

	getElement() {
		return this.element;
	}

	getTopbarElement() {
		return this.topbarElement;
	}

	setProps(props: ChatViewPaneProps) {
		this.chatWidget.setProps(props);
		this.renderTopbar(props);
	}

	dispose() {
		this.chatWidget.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.agentSidebar, null);
		this.element.replaceChildren();
	}

	private renderTopbar(props: ChatViewPaneProps) {
		this.syncTopbarSlot(
			this.topbarLeadingActionsElement,
			props.topbarActionsElement ?? null,
		);
		this.syncTopbarSlot(
			this.topbarTrailingActionsElement,
			props.topbarTrailingActionsElement ?? null,
		);
	}

	private syncTopbarSlot(
		slotElement: HTMLElement,
		topbarActionsElement: HTMLElement | null,
	) {
		const currentTopbarActionsElement = slotElement.firstElementChild;
		if (topbarActionsElement) {
			if (currentTopbarActionsElement !== topbarActionsElement) {
				slotElement.replaceChildren(topbarActionsElement);
			}
			return;
		}

		if (currentTopbarActionsElement) {
			slotElement.replaceChildren();
		}
	}
}

export function createChatViewPane(props: ChatViewPaneProps) {
	return new ChatViewPane(props);
}
