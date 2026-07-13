/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { MarkdownString } from 'cs/base/common/htmlContent';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import type { IAgentHostTurn } from 'cs/platform/agentHost/common/protocol';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import {
	type IChatBrowserPresentation,
	type IChatBrowserPresentationService,
} from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import { ChatContentMarkdownRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatContentMarkdownRenderer';
import type { IChatHostModelIdentity } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IChatHostPresentation } from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import type { IChatSelectionFragment } from 'cs/workbench/contrib/chat/common/chatService/chatOwnedAttachments';
import type { LocaleMessages } from 'language/locales';

export interface ChatListRendererOptions {
	readonly markdownRendererService: IMarkdownRendererService;
	readonly presentationService: IChatBrowserPresentationService;
}

interface IChatSelectableRegion {
	readonly element: HTMLElement;
	readonly message: string;
	readonly role: IChatSelectionFragment['role'];
}

/** Renders generic canonical Chat history and registered browser presentations. */
export class ChatListRenderer {
	private readonly markdownRenderer: ChatContentMarkdownRenderer;
	private readonly selectableRegions: IChatSelectableRegion[] = [];

	constructor(private readonly options: ChatListRendererOptions) {
		this.markdownRenderer = new ChatContentMarkdownRenderer(options.markdownRendererService);
	}

	beginRender(): void {
		this.selectableRegions.length = 0;
	}

	/** Constructs ordered transcript fragments only from regions registered by this renderer. */
	captureSelection(selection: Selection | null): readonly IChatSelectionFragment[] {
		if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
			return [];
		}
		const range = selection.getRangeAt(0);
		const startIndex = this.selectableRegions.findIndex(region =>
			region.element.contains(range.startContainer),
		);
		const endIndex = this.selectableRegions.findIndex(region =>
			region.element.contains(range.endContainer),
		);
		if (startIndex < 0 || endIndex < startIndex) {
			return [];
		}

		const fragments: IChatSelectionFragment[] = [];
		for (let index = startIndex; index <= endIndex; index++) {
			const region = this.selectableRegions[index];
			const fragmentRange = range.cloneRange();
			if (index !== startIndex) {
				fragmentRange.setStart(region.element, 0);
			}
			if (index !== endIndex) {
				fragmentRange.setEnd(region.element, region.element.childNodes.length);
			}
			const text = fragmentRange.toString();
			fragmentRange.detach();
			if (text.length > 0) {
				fragments.push(Object.freeze({
					message: region.message,
					role: region.role,
					text,
				}));
			}
		}
		return Object.freeze(fragments);
	}

	renderHostTurn(
		chatResource: URI,
		identity: IChatHostModelIdentity,
		turn: IAgentHostTurn,
		presentations: readonly IChatHostPresentation[],
		disposables: DisposableStore,
		ui: LocaleMessages,
	): readonly HTMLElement[] {
		const user = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-user');
		const userBody = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body');
		if (turn.user.text) {
			const text = $<HTMLElementTagNameMap['p']>('p.comet-chat-message-text');
			text.textContent = turn.user.text;
			userBody.append(text);
			this.selectableRegions.push({
				element: text,
				message: turn.submission,
				role: 'user',
			});
		}
		const userContext = this.renderHostUserContext(turn, ui);
		if (userContext) {
			userBody.append(userContext);
		}
		user.append(userBody);

		const assistant = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-assistant');
		const assistantBody = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body.comet-chat-host-response');
		for (const [responsePartIndex, part] of turn.response.entries()) {
			if (part.kind === 'text') {
				const rendered = disposables.add(this.markdownRenderer.render(new MarkdownString(part.text)));
				assistantBody.append(rendered.element);
				this.selectableRegions.push({
					element: rendered.element,
					message: turn.id,
					role: 'assistant',
				});
			} else if (part.kind === 'reasoning') {
				const reasoning = $<HTMLElementTagNameMap['details']>('details.comet-chat-host-reasoning');
				const summary = $<HTMLElementTagNameMap['summary']>('summary');
				summary.textContent = ui.chatHostReasoning;
				const content = $<HTMLElementTagNameMap['p']>('p');
				content.textContent = part.text;
				reasoning.append(summary, content);
				assistantBody.append(reasoning);
			} else {
				const tool = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-tool');
				tool.textContent = part.kind === 'toolCall'
					? `${ui.chatHostToolCall}: ${part.tool} (${part.call})`
					: `${ui.chatHostToolResult}: ${part.call} — ${part.status}`;
				assistantBody.append(tool);
			}

			const presentation = presentations.find(candidate =>
				candidate.session === identity.session
				&& candidate.chat === identity.chat
				&& candidate.turn === turn.id
				&& candidate.responsePartIndex === responsePartIndex,
			);
			if (presentation) {
				assistantBody.append(this.options.presentationService.render({
					chatResource,
					presentation: {
						type: presentation.type,
						value: presentation.value,
						origin: {
							kind: 'host',
							identity: presentation,
						},
					},
					ui,
					disposables,
				}));
			}
		}
		if (turn.failure) {
			const failure = $<HTMLElementTagNameMap['div']>('div.comet-chat-error');
			failure.textContent = `${ui.chatHostTurnFailed}: ${turn.failure.message}`;
			assistantBody.append(failure);
		} else if (turn.response.length === 0 || !['completed', 'cancelled'].includes(turn.state)) {
			const status = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-turn-status');
			status.textContent = ui.chatHostTurnStatus.replace('{0}', turn.state);
			assistantBody.append(status);
		}
		assistant.append(assistantBody);
		return [user, assistant];
	}

	renderFeaturePresentation(
		chatResource: URI,
		presentation: IChatBrowserPresentation,
		disposables: DisposableStore,
		ui: LocaleMessages,
	): HTMLElement {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-assistant');
		const body = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body');
		body.append(this.options.presentationService.render({
			chatResource,
			presentation,
			ui,
			disposables,
		}));
		item.append(body);
		return item;
	}

	private renderHostUserContext(turn: IAgentHostTurn, ui: LocaleMessages): HTMLElement | undefined {
		if (turn.user.attachments.length === 0 && turn.user.interactionTargets.length === 0) {
			return undefined;
		}
		const context = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-user-context');
		for (const attachment of turn.user.attachments) {
			const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-context-item');
			const label = $<HTMLElementTagNameMap['span']>('span.comet-chat-host-context-label');
			label.textContent = `${ui.chatHostAttachment}: ${attachment.display.label}`;
			item.append(label);
			if (attachment.content?.kind === 'inline'
				&& attachment.content.encoding === 'base64'
				&& attachment.content.mediaType.startsWith('image/')) {
				const image = $<HTMLElementTagNameMap['img']>('img.comet-chat-host-context-image');
				image.src = `data:${attachment.content.mediaType};base64,${attachment.content.data}`;
				image.alt = attachment.display.label;
				image.loading = 'lazy';
				item.append(image);
			}
			context.append(item);
		}
		for (const target of turn.user.interactionTargets) {
			const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-context-item');
			item.textContent = `${ui.chatHostTarget}: ${target.display.label}`;
			context.append(item);
		}
		return context;
	}
}
