/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { PdfSelection } from 'cs/editor/browser/pdf/pdfSelection';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentContentDigest,
	createAgentContentVersion,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import { PdfEditorPane } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorPane';
import { PdfEditorInput } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

export const PdfSelectionAttachmentProducerType = createAgentAttachmentProducerTypeId('pdf.selection');

const PdfSelectionRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.pdf-selection.v1');
const PdfSelectionAttachmentStateVersion = 1;
const maximumPdfSelectionRanges = 256;
const maximumPdfSelectionTextBytes = 512 * 1024;

interface IPdfSelectionRangeState {
	readonly page: number;
	readonly startCharIndex: number | null;
	readonly endCharIndex: number | null;
}

interface IPdfSelectionAttachmentState {
	readonly documentId: string;
	readonly title: string;
	readonly text: string;
	readonly ranges: readonly IPdfSelectionRangeState[];
}

function requireRecord(
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

function requireIndex(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function requireNullableIndex(value: unknown, label: string): number | null {
	return value === null ? null : requireIndex(value, label);
}

function requirePdfSelectionState(value: AgentHostProtocolValue): IPdfSelectionAttachmentState {
	const state = requireRecord(value, 'PDF selection attachment state');
	requireExactKeys(state, ['documentId', 'title', 'text', 'ranges'], 'PDF selection attachment state');
	const documentId = requireString(state.documentId, 'PDF document ID', 512);
	const title = requireString(state.title, 'PDF title', 512);
	const text = requireString(state.text, 'PDF selected text', maximumPdfSelectionTextBytes);
	if (new TextEncoder().encode(text).byteLength > maximumPdfSelectionTextBytes) {
		throw new RangeError(`PDF selected text cannot exceed ${maximumPdfSelectionTextBytes} bytes.`);
	}
	if (!Array.isArray(state.ranges)
		|| state.ranges.length === 0
		|| state.ranges.length > maximumPdfSelectionRanges) {
		throw new RangeError(`PDF selection requires between 1 and ${maximumPdfSelectionRanges} ranges.`);
	}
	const ranges = state.ranges.map((value, index) => {
		const range = requireRecord(value, `PDF selection range ${index}`);
		requireExactKeys(
			range,
			['page', 'startCharIndex', 'endCharIndex'],
			`PDF selection range ${index}`,
		);
		const startCharIndex = requireNullableIndex(
			range.startCharIndex,
			`PDF selection range ${index} startCharIndex`,
		);
		const endCharIndex = requireNullableIndex(
			range.endCharIndex,
			`PDF selection range ${index} endCharIndex`,
		);
		if ((startCharIndex === null) !== (endCharIndex === null)) {
			throw new TypeError(`PDF selection range ${index} requires both text indices or neither.`);
		}
		if (startCharIndex !== null && endCharIndex! < startCharIndex) {
			throw new RangeError(`PDF selection range ${index} has reversed text indices.`);
		}
		return {
			page: requireIndex(range.page, `PDF selection range ${index} page`),
			startCharIndex,
			endCharIndex,
		};
	});
	return { documentId, title, text, ranges };
}

function toPdfSelectionState(
	input: PdfEditorInput,
	selection: PdfSelection,
): AgentHostProtocolValue {
	const state: AgentHostProtocolValue = {
		documentId: input.id,
		title: input.getName(),
		text: selection.text,
		ranges: selection.ranges.map(range => ({
			page: range.page,
			startCharIndex: range.textRange?.startCharIndex ?? null,
			endCharIndex: range.textRange?.endCharIndex ?? null,
		})),
	};
	requirePdfSelectionState(state);
	return state;
}

async function digestText(value: string) {
	const bytes = new TextEncoder().encode(value);
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return {
		bytes,
		digest: createAgentContentDigest(
			`sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
		),
	};
}

export function createPdfSelectionAttachment(
	id: string,
	input: PdfEditorInput,
	selection: PdfSelection,
): IPendingChatAttachment {
	const state = toPdfSelectionState(input, selection);
	return {
		id: createAgentAttachmentId(id),
		producerType: PdfSelectionAttachmentProducerType,
		producerStateVersion: PdfSelectionAttachmentStateVersion,
		display: { label: input.getName() },
		state,
	};
}

const PdfSelectionAttachmentProducer: IChatAttachmentProducer = {
	type: PdfSelectionAttachmentProducerType,
	stateVersion: PdfSelectionAttachmentStateVersion,
	validateState: state => {
		requirePdfSelectionState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }) => {
		const state = requirePdfSelectionState(attachment.state);
		const content = await digestText(state.text);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: PdfSelectionRepresentationSchema,
				mediaType: 'application/vnd.comet.pdf-selection+json',
				value: attachment.state,
			},
			content: {
				kind: 'inline',
				mediaType: 'text/plain',
				encoding: 'utf8',
				data: state.text,
				byteLength: content.bytes.byteLength,
				version: createAgentContentVersion(content.digest),
				digest: content.digest,
			},
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	},
};

/** Registers explicit active-PDF selection snapshots over the common Chat attachment API. */
export class PdfEditorChatAttachmentsContribution extends Disposable {
	constructor(
		@IChatService chatService: IChatService,
		@IEditorService editorService: IEditorService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
	) {
		super();
		this._register(chatService.registerAttachmentProducer(PdfSelectionAttachmentProducer));
		this._register(composerSourceService.registerSource({
			id: 'pdf.selection',
			order: 110,
			icon: 'file',
			getLabel: ui => ui.chatInputAddPdfSelection,
			addToComposer: async chatResource => {
				const input = editorService.activeEditor;
				const pane = editorService.activeEditorPane;
				if (!(input instanceof PdfEditorInput) || !(pane instanceof PdfEditorPane)) {
					throw new Error('Add PDF selection requires an active PDF Editor.');
				}
				const selection = pane.getViewState()?.selection;
				if (!selection || !selection.text.trim()) {
					throw new Error('Add PDF selection requires non-empty selected text.');
				}
				chatService.addPendingAttachments(chatResource, [
					createPdfSelectionAttachment(generateUuid(), input, selection),
				]);
			},
		}));
	}
}
