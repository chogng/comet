/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import {
	getWritingEditorTextUnitByBlockId,
	parseWritingEditorDocument,
	type WritingEditorDocument,
	type WritingEditorSelection,
} from 'cs/editor/common/writingEditorDocument';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentContentDigest,
	createAgentContentVersion,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import {
	IDraftEditorService,
	type IDraftEditorTargetSnapshot,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import { createDraftEditorInteractionTarget } from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';

export const DraftEditorSnapshotAttachmentProducerType = createAgentAttachmentProducerTypeId('editor.snapshot');

const DraftEditorSnapshotRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.editor-snapshot.v1');
const DraftEditorSnapshotAttachmentStateVersion = 1;
const maximumDraftEditorSnapshotBytes = 8 * 1024 * 1024;

interface IDraftEditorSnapshotState {
	readonly resource: string;
	readonly name: string;
	readonly document: WritingEditorDocument;
	readonly selection: WritingEditorSelection | null;
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

function requireString(value: unknown, label: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded non-empty string.`);
	}
	return value;
}

function requireOffset(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative integer.`);
	}
	return value;
}

function requireSelection(
	value: AgentHostProtocolValue,
	document: WritingEditorDocument,
): WritingEditorSelection | null {
	if (value === null) {
		return null;
	}
	const selection = requireProtocolRecord(value, 'Draft Editor selection');
	requireExactKeys(selection, ['blockId', 'startOffset', 'endOffset'], 'Draft Editor selection');
	const blockId = requireString(selection.blockId, 'Draft Editor selection blockId', 512);
	const startOffset = requireOffset(selection.startOffset, 'Draft Editor selection startOffset');
	const endOffset = requireOffset(selection.endOffset, 'Draft Editor selection endOffset');
	const textUnit = getWritingEditorTextUnitByBlockId(document, blockId);
	if (!textUnit) {
		throw new Error(`Draft Editor selection references unknown block '${blockId}'.`);
	}
	if (startOffset > endOffset || endOffset > textUnit.text.length) {
		throw new RangeError(`Draft Editor selection for block '${blockId}' is outside its text.`);
	}
	return { blockId, startOffset, endOffset };
}

function requireDraftEditorState(value: AgentHostProtocolValue): IDraftEditorSnapshotState {
	const state = requireProtocolRecord(value, 'Draft Editor attachment state');
	requireExactKeys(
		state,
		['resource', 'name', 'document', 'selection'],
		'Draft Editor attachment state',
	);
	const resource = requireString(state.resource, 'Draft Editor resource', 8_192);
	const parsedResource = URI.parse(resource);
	if (!parsedResource.scheme || parsedResource.toString(true) !== resource) {
		throw new TypeError('Draft Editor resource must be a canonical absolute URI.');
	}
	const name = requireString(state.name, 'Draft Editor name', 512);
	const document = parseWritingEditorDocument(state.document);
	assertAgentHostProtocolValue(document);
	if (encodeAgentHostProtocolValue(document) !== encodeAgentHostProtocolValue(state.document)) {
		throw new TypeError('Draft Editor document must already use the current canonical schema.');
	}
	const selection = requireSelection(state.selection, document);
	return { resource, name, document, selection };
}

async function digestContent(bytes: Uint8Array) {
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return createAgentContentDigest(
		`sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
	);
}

function toProtocolState(state: IDraftEditorSnapshotState): AgentHostProtocolValue {
	assertAgentHostProtocolValue(state.document);
	return {
		resource: state.resource,
		name: state.name,
		document: state.document,
		selection: state.selection
			? {
				blockId: state.selection.blockId,
				startOffset: state.selection.startOffset,
				endOffset: state.selection.endOffset,
			}
			: null,
	};
}

export function createDraftEditorSnapshotAttachment(
	id: string,
	snapshot: IDraftEditorTargetSnapshot,
): IPendingChatAttachment {
	const selection = snapshot.selection;
	if (selection === undefined) {
		throw new Error(`Draft Editor '${snapshot.resource.toString()}' has no current pane snapshot.`);
	}
	const document = parseWritingEditorDocument(snapshot.document);
	const state = toProtocolState({
		resource: snapshot.resource.toString(true),
		name: snapshot.name,
		document,
		selection,
	});
	return {
		id: createAgentAttachmentId(id),
		producerType: DraftEditorSnapshotAttachmentProducerType,
		producerStateVersion: DraftEditorSnapshotAttachmentStateVersion,
		display: {
			label: snapshot.name,
			description: snapshot.resource.toString(true),
		},
		state,
	};
}

const DraftEditorSnapshotAttachmentProducer: IChatAttachmentProducer = {
	type: DraftEditorSnapshotAttachmentProducerType,
	stateVersion: DraftEditorSnapshotAttachmentStateVersion,
	validateState: state => {
		requireDraftEditorState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }) => {
		const state = requireDraftEditorState(attachment.state);
		const value = toProtocolState(state);
		const data = encodeAgentHostProtocolValue(value);
		const bytes = new TextEncoder().encode(data);
		if (bytes.byteLength > maximumDraftEditorSnapshotBytes) {
			throw new RangeError(
				`Draft Editor snapshot cannot exceed ${maximumDraftEditorSnapshotBytes} bytes.`,
			);
		}
		const digest = await digestContent(bytes);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: DraftEditorSnapshotRepresentationSchema,
				mediaType: 'application/vnd.comet.editor-snapshot+json',
				value,
			},
			content: {
				kind: 'inline',
				mediaType: 'application/vnd.comet.editor-snapshot+json',
				encoding: 'utf8',
				data,
				byteLength: bytes.byteLength,
				version: createAgentContentVersion(digest),
				digest,
			},
			metadata: [],
		};
		return Object.freeze({
			attachment: result,
			release: async () => {},
		});
	},
};

/** Registers the current Draft Editor snapshot producer for the Workbench lifetime. */
export class DraftEditorChatAttachmentsContribution extends Disposable {
	constructor(
		@IChatService chatService: IChatService,
		@IDraftEditorService draftEditorService: IDraftEditorService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
		@IClientAgentToolService clientToolService: IClientAgentToolService,
	) {
		super();
		this._register(chatService.registerAttachmentProducer(DraftEditorSnapshotAttachmentProducer));
		this._register(composerSourceService.registerSource({
			id: 'editor.snapshot',
			order: 100,
			icon: 'draft',
			getLabel: ui => ui.chatInputAddEditor,
			addToComposer: async chatResource => {
				const input = draftEditorService.activeInput;
				if (!input) {
					throw new Error('Add to Chat requires an active Draft Editor.');
				}
				const snapshot = draftEditorService.getTargetSnapshot(input.resource);
				if (!snapshot) {
					throw new Error(`Draft Editor '${input.resource.toString()}' is unavailable.`);
				}
				const attachment = createDraftEditorSnapshotAttachment(generateUuid(), snapshot);
				const target = await createDraftEditorInteractionTarget(
					snapshot,
					clientToolService.connection,
				);
				chatService.addComposerContext(chatResource, [attachment], [target]);
			},
		}));
	}
}
