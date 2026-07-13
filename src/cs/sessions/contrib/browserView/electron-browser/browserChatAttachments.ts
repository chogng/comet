/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, VSBuffer } from 'cs/base/common/buffer';
import { CancellationError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentContentDigest,
	createAgentContentVersion,
} from 'cs/platform/agentHost/common/identities';
import {
	computeAgentHostPayloadDigest,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { IBrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/common/browserView';
import { createBrowserDocumentTarget } from 'cs/workbench/contrib/browserView/common/browserAgentTools';
import { BrowserEditor } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	BrowserReadableContentToolEndpoint,
	createBrowserReadableContentToolRegistration,
} from 'cs/sessions/contrib/browserView/electron-browser/browserReadableContentTool';

export const BrowserTextAttachmentProducerType = createAgentAttachmentProducerTypeId('browser.text-context');
export const BrowserImageAttachmentProducerType = createAgentAttachmentProducerTypeId('browser.image-context');
export const BrowserPageAttachmentProducerType = createAgentAttachmentProducerTypeId('browser.page');

const BrowserTextRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.text.v1');
const BrowserImageRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.image.v1');
const BrowserPageRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.browser-page.v1');
const BrowserAttachmentStateVersion = 1;

interface IBrowserTextAttachmentState {
	readonly text: string;
}

interface IBrowserImageAttachmentState {
	readonly name: string;
	readonly mediaType: 'image/jpeg' | 'image/png';
	readonly base64: string;
}

interface IBrowserPageAttachmentState {
	readonly browserViewId: string;
	readonly documentEpoch: string;
	readonly url: string;
	readonly title: string;
}

function requireProtocolRecord(
	value: AgentHostProtocolValue,
	label: string,
): Readonly<Record<string, AgentHostProtocolValue>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a protocol record.`);
	}
	return value as Readonly<Record<string, AgentHostProtocolValue>>;
}

function requireExactKeys(
	value: Readonly<Record<string, AgentHostProtocolValue>>,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
		throw new TypeError(`${label} contains unsupported properties.`);
	}
}

function requireBrowserTextState(value: AgentHostProtocolValue): IBrowserTextAttachmentState {
	const state = requireProtocolRecord(value, 'Browser text attachment state');
	requireExactKeys(state, ['text'], 'Browser text attachment state');
	if (typeof state.text !== 'string' || state.text.length === 0) {
		throw new TypeError('Browser text attachment state requires non-empty text.');
	}
	return { text: state.text };
}

function requireBrowserImageState(value: AgentHostProtocolValue): IBrowserImageAttachmentState {
	const state = requireProtocolRecord(value, 'Browser image attachment state');
	requireExactKeys(state, ['name', 'mediaType', 'base64'], 'Browser image attachment state');
	if (typeof state.name !== 'string' || state.name.length === 0 || state.name.length > 512) {
		throw new TypeError('Browser image attachment state requires a bounded name.');
	}
	if (state.mediaType !== 'image/jpeg' && state.mediaType !== 'image/png') {
		throw new TypeError('Browser image attachment state requires JPEG or PNG media.');
	}
	if (typeof state.base64 !== 'string') {
		throw new TypeError('Browser image attachment state requires base64 content.');
	}
	const bytes = decodeBase64(state.base64);
	if (bytes.byteLength === 0) {
		throw new TypeError('Browser image attachment state requires non-empty image content.');
	}
	return {
		name: state.name,
		mediaType: state.mediaType,
		base64: state.base64,
	};
}

function requireBrowserPageState(value: AgentHostProtocolValue): IBrowserPageAttachmentState {
	const state = requireProtocolRecord(value, 'Browser page attachment state');
	requireExactKeys(state, ['browserViewId', 'documentEpoch', 'url', 'title'], 'Browser page attachment state');
	if (typeof state.browserViewId !== 'string' || state.browserViewId.length === 0 || state.browserViewId.length > 128) {
		throw new TypeError('Browser page attachment state requires a bounded Browser view ID.');
	}
	if (typeof state.documentEpoch !== 'string' || state.documentEpoch.length === 0 || state.documentEpoch.length > 128) {
		throw new TypeError('Browser page attachment state requires a bounded document epoch.');
	}
	if (typeof state.url !== 'string' || state.url.length === 0 || state.url.length > 65_536) {
		throw new TypeError('Browser page attachment state requires a bounded URL.');
	}
	if (typeof state.title !== 'string' || state.title.length > 16_384) {
		throw new TypeError('Browser page attachment state requires a bounded title.');
	}
	return {
		browserViewId: state.browserViewId,
		documentEpoch: state.documentEpoch,
		url: state.url,
		title: state.title,
	};
}

async function digestContent(bytes: Uint8Array) {
	const digestInput = new Uint8Array(bytes.byteLength);
	digestInput.set(bytes);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput));
	return createAgentContentDigest(
		`sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
	);
}

async function computeBrowserAttachmentId(browserViewId: string, documentEpoch: string): Promise<string> {
	const digest = await computeAgentHostPayloadDigest({
		producerType: BrowserPageAttachmentProducerType,
		browserViewId,
		documentEpoch,
	});
	return `browser-page:${digest.slice('sha256:'.length)}`;
}

function preparedAttachment(attachment: IAgentHostAttachment) {
	return Object.freeze({
		attachment,
		release: async () => {},
	});
}

export function createBrowserTextAttachment(
	id: string,
	label: string,
	text: string,
): IPendingChatAttachment {
	return {
		id: createAgentAttachmentId(id),
		producerType: BrowserTextAttachmentProducerType,
		producerStateVersion: BrowserAttachmentStateVersion,
		display: { label },
		state: { text },
	};
}

export function createBrowserImageAttachment(
	id: string,
	name: string,
	mediaType: IBrowserImageAttachmentState['mediaType'],
	data: VSBuffer,
): IPendingChatAttachment {
	return {
		id: createAgentAttachmentId(id),
		producerType: BrowserImageAttachmentProducerType,
		producerStateVersion: BrowserAttachmentStateVersion,
		display: { label: name },
		state: {
			name,
			mediaType,
			base64: encodeBase64(data),
		},
	};
}

export function createBrowserPageAttachment(
	id: string,
	label: string,
	state: IBrowserPageAttachmentState,
): IPendingChatAttachment {
	return {
		id: createAgentAttachmentId(id),
		producerType: BrowserPageAttachmentProducerType,
		producerStateVersion: BrowserAttachmentStateVersion,
		display: { label, description: state.url },
		state: { ...state },
	};
}

const BrowserTextAttachmentProducer: IChatAttachmentProducer = {
	type: BrowserTextAttachmentProducerType,
	stateVersion: BrowserAttachmentStateVersion,
	validateState: state => {
		requireBrowserTextState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }) => {
		const state = requireBrowserTextState(attachment.state);
		const bytes = new TextEncoder().encode(state.text);
		const digest = await digestContent(bytes);
		return preparedAttachment({
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: BrowserTextRepresentationSchema,
				mediaType: 'text/plain',
				value: { text: state.text },
			},
			content: {
				kind: 'inline',
				mediaType: 'text/plain',
				encoding: 'utf8',
				data: state.text,
				byteLength: bytes.byteLength,
				version: createAgentContentVersion(digest),
				digest,
			},
			metadata: [],
		});
	},
};

const BrowserImageAttachmentProducer: IChatAttachmentProducer = {
	type: BrowserImageAttachmentProducerType,
	stateVersion: BrowserAttachmentStateVersion,
	validateState: state => {
		requireBrowserImageState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }) => {
		const state = requireBrowserImageState(attachment.state);
		const bytes = decodeBase64(state.base64);
		const digest = await digestContent(bytes.buffer);
		return preparedAttachment({
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: BrowserImageRepresentationSchema,
				mediaType: state.mediaType,
				value: { name: state.name },
			},
			content: {
				kind: 'inline',
				mediaType: state.mediaType,
				encoding: 'base64',
				data: state.base64,
				byteLength: bytes.byteLength,
				version: createAgentContentVersion(digest),
				digest,
			},
			metadata: [],
		});
	},
};

export function createBrowserPageAttachmentProducer(
	browserViewWorkbenchService: IBrowserViewWorkbenchService,
): IChatAttachmentProducer {
	return {
		type: BrowserPageAttachmentProducerType,
		stateVersion: BrowserAttachmentStateVersion,
		validateState: state => {
			requireBrowserPageState(state);
		},
		discard: () => {},
		resolve: async ({ attachment, token }) => {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const state = requireBrowserPageState(attachment.state);
			const input = browserViewWorkbenchService.getKnownBrowserViews().get(state.browserViewId);
			const model = input?.model;
			if (!model || model.id !== state.browserViewId) {
				throw new Error(`Browser page '${state.browserViewId}' is unavailable.`);
			}
			const content = await model.readReadableContent(state.documentEpoch);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			if (
				content.documentEpoch !== state.documentEpoch ||
				content.url !== state.url
			) {
				throw new Error(`Browser page '${state.browserViewId}' changed before its attachment was prepared.`);
			}
			const bytes = new TextEncoder().encode(content.text);
			const digest = await digestContent(bytes);
			if (content.byteLength !== bytes.byteLength || content.digest !== digest) {
				throw new Error(`Browser page '${state.browserViewId}' returned inconsistent readable content.`);
			}
			return preparedAttachment({
				envelopeVersion: 1,
				id: attachment.id,
				producerType: attachment.producerType,
				display: attachment.display,
				representation: {
					schema: BrowserPageRepresentationSchema,
					mediaType: 'text/plain',
					value: {
						browserViewId: state.browserViewId,
						documentEpoch: content.documentEpoch,
						url: content.url,
						title: content.title,
						digest,
						truncated: content.truncated,
					},
				},
				content: {
					kind: 'inline',
					mediaType: 'text/plain',
					encoding: 'utf8',
					data: content.text,
					byteLength: bytes.byteLength,
					version: createAgentContentVersion(digest),
					digest,
				},
				metadata: [],
			});
		},
	};
}

/** Registers Browser-owned current producer codecs once for the Workbench lifetime. */
export class BrowserChatAttachmentsContribution extends Disposable {
	constructor(
		@IChatService chatService: IChatService,
		@IBrowserViewWorkbenchService browserViewWorkbenchService: IBrowserViewWorkbenchService,
		@IClientAgentToolService clientAgentToolService: IClientAgentToolService,
		@IEditorService editorService: IEditorService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
	) {
		super();
		this._register(chatService.registerAttachmentProducer(BrowserTextAttachmentProducer));
		this._register(chatService.registerAttachmentProducer(BrowserImageAttachmentProducer));
		this._register(chatService.registerAttachmentProducer(
			createBrowserPageAttachmentProducer(browserViewWorkbenchService),
		));
		this._register(clientAgentToolService.publish(
			createBrowserReadableContentToolRegistration(clientAgentToolService.connection),
			new BrowserReadableContentToolEndpoint(
				clientAgentToolService.connection,
				browserViewWorkbenchService,
			),
		));
		this._register(composerSourceService.registerSource({
			id: 'browser.page',
			order: 120,
			icon: 'browser',
			getLabel: ui => ui.chatInputAddBrowserPage,
			addToComposer: async chatResource => {
				const pane = editorService.activeEditorPane;
				if (!(pane instanceof BrowserEditor) || !pane.model) {
					throw new Error('Add Browser page requires an active Browser Editor.');
				}
				const model = pane.model;
				const document = await model.captureDocumentIdentity();
				chatService.addPendingAttachments(chatResource, [
					createBrowserPageAttachment(
						await computeBrowserAttachmentId(model.id, document.documentEpoch),
						localize('browser.pageAttachmentLabel', "Browser Page"),
						{
							browserViewId: model.id,
							documentEpoch: document.documentEpoch,
							url: document.url,
							title: model.title,
						},
					),
				]);
			},
		}));
		this._register(composerSourceService.registerSource({
			id: 'browser.document-target',
			order: 121,
			icon: 'browser',
			getLabel: ui => ui.chatInputUseBrowserPage,
			addToComposer: async chatResource => {
				const pane = editorService.activeEditorPane;
				if (!(pane instanceof BrowserEditor) || !pane.model) {
					throw new Error('Use Browser page requires an active Browser Editor.');
				}
				chatService.addInteractionTargets(chatResource, [
					await createBrowserDocumentTarget(
						pane.model,
						clientAgentToolService.connection,
						localize('browser.documentTargetLabel', "Browser Page"),
					),
				]);
			},
		}));
	}
}
