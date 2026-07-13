/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable, type DisposableStore } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { localize } from 'cs/nls';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	createChatPresentationTypeId,
	type ChatPresentationTypeId,
	type IChatHostPresentationIdentity,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import type { LocaleMessages } from 'language/locales';

export interface IChatFeaturePresentation {
	readonly id: string;
	readonly type: ChatPresentationTypeId;
	readonly value: AgentHostProtocolValue;
}

export type ChatBrowserPresentationOrigin =
	| {
		readonly kind: 'host';
		readonly identity: IChatHostPresentationIdentity;
	}
	| {
		readonly kind: 'feature';
		readonly source: string;
		readonly id: string;
	};

export interface IChatBrowserPresentation {
	readonly type: ChatPresentationTypeId;
	readonly value: AgentHostProtocolValue;
	readonly origin: ChatBrowserPresentationOrigin;
}

export interface IChatBrowserPresentationRenderContext {
	readonly chatResource: URI;
	readonly presentation: IChatBrowserPresentation;
	readonly ui: LocaleMessages;
	readonly disposables: DisposableStore;
}

export interface IChatBrowserPresentationRenderer {
	readonly type: ChatPresentationTypeId;
	render(context: IChatBrowserPresentationRenderContext): HTMLElement;
}

export interface IChatBrowserPresentationSource {
	readonly id: string;
	readonly onDidChange: Event<URI>;
	getPresentations(chatResource: URI): readonly IChatFeaturePresentation[];
}

export const IChatBrowserPresentationService =
	createDecorator<IChatBrowserPresentationService>('chatBrowserPresentationService');

export interface IChatBrowserPresentationService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<URI>;
	registerRenderer(renderer: IChatBrowserPresentationRenderer): IDisposable;
	registerSource(source: IChatBrowserPresentationSource): IDisposable;
	getFeaturePresentations(chatResource: URI): readonly IChatBrowserPresentation[];
	render(context: IChatBrowserPresentationRenderContext): HTMLElement;
}

interface IRegisteredSource {
	readonly source: IChatBrowserPresentationSource;
	readonly listener: IDisposable;
}

function requireStableId(value: string, label: string): string {
	if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(value) || value.length > 128) {
		throw new TypeError(`${label} '${value}' is invalid.`);
	}
	return value;
}

function captureFeaturePresentation(
	source: string,
	presentation: IChatFeaturePresentation,
): IChatBrowserPresentation {
	if (typeof presentation.id !== 'string'
		|| presentation.id.length === 0
		|| presentation.id.length > 256) {
		throw new TypeError(`Chat presentation source '${source}' returned an invalid presentation ID.`);
	}
	assertAgentHostProtocolValue(presentation.value);
	return Object.freeze({
		type: createChatPresentationTypeId(presentation.type),
		value: presentation.value,
		origin: Object.freeze({ kind: 'feature', source, id: presentation.id }),
	});
}

export class ChatBrowserPresentationService extends Disposable implements IChatBrowserPresentationService {
	declare readonly _serviceBrand: undefined;

	private readonly renderers = new Map<ChatPresentationTypeId, IChatBrowserPresentationRenderer>();
	private readonly sources = new Map<string, IRegisteredSource>();
	private readonly onDidChangeEmitter = this._register(new Emitter<URI>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChange = this.onDidChangeEmitter.event;

	registerRenderer(renderer: IChatBrowserPresentationRenderer): IDisposable {
		const type = createChatPresentationTypeId(renderer.type);
		if (typeof renderer.render !== 'function') {
			throw new TypeError(`Chat presentation renderer '${type}' is invalid.`);
		}
		if (this.renderers.has(type)) {
			throw new Error(`Chat presentation renderer '${type}' is already registered.`);
		}
		this.renderers.set(type, renderer);
		return toDisposable(() => {
			if (this.renderers.get(type) !== renderer) {
				throw new Error(`Chat presentation renderer ownership changed for '${type}'.`);
			}
			this.renderers.delete(type);
		});
	}

	registerSource(source: IChatBrowserPresentationSource): IDisposable {
		const id = requireStableId(source.id, 'Chat presentation source');
		if (typeof source.getPresentations !== 'function') {
			throw new TypeError(`Chat presentation source '${id}' is invalid.`);
		}
		if (this.sources.has(id)) {
			throw new Error(`Chat presentation source '${id}' is already registered.`);
		}
		const listener = source.onDidChange(resource => this.onDidChangeEmitter.fire(resource));
		this.sources.set(id, { source, listener });
		return toDisposable(() => {
			const registered = this.sources.get(id);
			if (!registered || registered.source !== source) {
				throw new Error(`Chat presentation source ownership changed for '${id}'.`);
			}
			this.sources.delete(id);
			registered.listener.dispose();
		});
	}

	getFeaturePresentations(chatResource: URI): readonly IChatBrowserPresentation[] {
		const presentations: IChatBrowserPresentation[] = [];
		const identities = new Set<string>();
		for (const [sourceId, { source }] of [...this.sources].sort(([left], [right]) =>
			left.localeCompare(right))) {
			for (const rawPresentation of source.getPresentations(chatResource)) {
				const presentation = captureFeaturePresentation(sourceId, rawPresentation);
				const identity = `${sourceId}\0${presentation.origin.kind === 'feature'
					? presentation.origin.id
					: ''}`;
				if (identities.has(identity)) {
					throw new Error(`Chat presentation '${identity}' is duplicated.`);
				}
				identities.add(identity);
				presentations.push(presentation);
			}
		}
		return Object.freeze(presentations);
	}

	render(context: IChatBrowserPresentationRenderContext): HTMLElement {
		const renderer = this.renderers.get(context.presentation.type);
		if (renderer) {
			return renderer.render(context);
		}
		const unavailable = $<HTMLElementTagNameMap['div']>('div.comet-chat-presentation-unavailable');
		unavailable.textContent = localize(
			'chat.presentation.unavailable',
			"Presentation unavailable: {0}",
			context.presentation.type,
		);
		return unavailable;
	}
}

registerSingleton(
	IChatBrowserPresentationService,
	ChatBrowserPresentationService,
	InstantiationType.Delayed,
);
