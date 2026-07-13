/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	decodeBase64,
	encodeBase64,
	VSBuffer,
} from 'cs/base/common/buffer';
import { URI } from 'cs/base/common/uri';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentContentDigest,
	createAgentContentVersion,
	type AgentContentDigest,
} from 'cs/platform/agentHost/common/identities';
import {
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	maximumPendingChatAttachmentStateBytes,
	type IChatAttachmentProducer,
	type IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';

export const ChatTextAttachmentProducerType = createAgentAttachmentProducerTypeId('chat.text');
export const ChatSelectionAttachmentProducerType = createAgentAttachmentProducerTypeId('chat.selection');
export const ChatImageAttachmentProducerType = createAgentAttachmentProducerTypeId('chat.image');

export const ChatTextAttachmentRepresentationSchema =
	createAgentAttachmentRepresentationSchemaId('comet.chat-text.v1');
export const ChatSelectionAttachmentRepresentationSchema =
	createAgentAttachmentRepresentationSchemaId('comet.chat-selection.v1');
export const ChatImageAttachmentRepresentationSchema =
	createAgentAttachmentRepresentationSchemaId('comet.chat-image.v1');

const ChatOwnedAttachmentStateVersion = 1;
export const maximumChatTextAttachmentBytes = 512 * 1024;
export const maximumChatSelectionFragments = 256;
export const maximumChatSelectionAttachmentBytes = 768 * 1024;
const maximumChatImageStateOverheadBytes = 4 * 1024;
export const maximumChatImageAttachmentBytes = Math.floor(
	(maximumPendingChatAttachmentStateBytes - maximumChatImageStateOverheadBytes) * 3 / 4,
);
export const maximumChatImageDimension = 32_768;

export type ChatSelectionRole = 'user' | 'assistant';
export type ChatImageMediaType = 'image/jpeg' | 'image/png';

export interface IChatSelectionFragment {
	readonly message: string;
	readonly role: ChatSelectionRole;
	readonly text: string;
}

interface IChatTextAttachmentState {
	readonly text: string;
}

interface IChatSelectionAttachmentState {
	readonly sourceChat: string;
	readonly fragments: readonly IChatSelectionFragment[];
}

interface IChatImageAttachmentState {
	readonly name: string;
	readonly mediaType: ChatImageMediaType;
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	readonly digest: AgentContentDigest;
	readonly data: string;
}

interface IParsedChatImageAttachmentState extends IChatImageAttachmentState {
	readonly bytes: VSBuffer;
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

function requireTrimmedString(value: unknown, label: string, maximumLength: number): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > maximumLength
		|| value !== value.trim()) {
		throw new TypeError(`${label} must be a bounded non-empty trimmed string.`);
	}
	return value;
}

function requireBoundedText(value: unknown, label: string, maximumBytes: number): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${label} must be non-empty text.`);
	}
	const byteLength = new TextEncoder().encode(value).byteLength;
	if (byteLength > maximumBytes) {
		throw new RangeError(`${label} cannot exceed ${maximumBytes} bytes.`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, label: string, maximum: number): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value <= 0
		|| value > maximum) {
		throw new RangeError(`${label} must be an integer between 1 and ${maximum}.`);
	}
	return value;
}

function requireCanonicalChatResource(value: unknown): string {
	const serialized = requireTrimmedString(value, 'Chat selection source Chat', 8_192);
	const resource = URI.parse(serialized);
	if (!resource.scheme || resource.toString(true) !== serialized) {
		throw new TypeError('Chat selection source Chat must be a canonical absolute URI.');
	}
	return serialized;
}

function requireChatTextState(value: AgentHostProtocolValue): IChatTextAttachmentState {
	const state = requireRecord(value, 'Chat text attachment state');
	requireExactKeys(state, ['text'], 'Chat text attachment state');
	return {
		text: requireBoundedText(state.text, 'Chat attachment text', maximumChatTextAttachmentBytes),
	};
}

function requireChatSelectionState(value: AgentHostProtocolValue): IChatSelectionAttachmentState {
	const state = requireRecord(value, 'Chat selection attachment state');
	requireExactKeys(state, ['sourceChat', 'fragments'], 'Chat selection attachment state');
	const sourceChat = requireCanonicalChatResource(state.sourceChat);
	if (!Array.isArray(state.fragments)
		|| state.fragments.length === 0
		|| state.fragments.length > maximumChatSelectionFragments) {
		throw new RangeError(
			`Chat selection requires between 1 and ${maximumChatSelectionFragments} fragments.`,
		);
	}
	const fragments = state.fragments.map((value, index) => {
		const fragment = requireRecord(value, `Chat selection fragment ${index}`);
		requireExactKeys(fragment, ['message', 'role', 'text'], `Chat selection fragment ${index}`);
		if (fragment.role !== 'user' && fragment.role !== 'assistant') {
			throw new TypeError(`Chat selection fragment ${index} has an unsupported role.`);
		}
		const role: ChatSelectionRole = fragment.role;
		return {
			message: requireTrimmedString(
				fragment.message,
				`Chat selection fragment ${index} message identity`,
				512,
			),
			role,
			text: requireBoundedText(
				fragment.text,
				`Chat selection fragment ${index} text`,
				maximumChatSelectionAttachmentBytes,
			),
		};
	});
	const canonicalState: AgentHostProtocolValue = {
		sourceChat,
		fragments: fragments.map(fragment => ({ ...fragment })),
	};
	if (new TextEncoder().encode(encodeAgentHostProtocolValue(canonicalState)).byteLength
		> maximumChatSelectionAttachmentBytes) {
		throw new RangeError(
			`Chat selection attachment cannot exceed ${maximumChatSelectionAttachmentBytes} bytes.`,
		);
	}
	return { sourceChat, fragments };
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] * 0x1000000
		+ bytes[offset + 1] * 0x10000
		+ bytes[offset + 2] * 0x100
		+ bytes[offset + 3]
	);
}

function requirePngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.byteLength < 45 || signature.some((byte, index) => bytes[index] !== byte)) {
		throw new TypeError('Chat image bytes are not a valid PNG container.');
	}

	let offset = signature.length;
	let dimensions: { readonly width: number; readonly height: number } | undefined;
	let hasImageData = false;
	while (offset + 12 <= bytes.byteLength) {
		const length = readUint32BigEndian(bytes, offset);
		const end = offset + 12 + length;
		if (!Number.isSafeInteger(end) || end > bytes.byteLength) {
			throw new TypeError('Chat PNG image contains a truncated chunk.');
		}
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7],
		);
		if (!dimensions) {
			if (type !== 'IHDR' || length !== 13) {
				throw new TypeError('Chat PNG image requires an initial IHDR chunk.');
			}
			dimensions = {
				width: readUint32BigEndian(bytes, offset + 8),
				height: readUint32BigEndian(bytes, offset + 12),
			};
		}
		if (type === 'IDAT') {
			hasImageData = true;
		}
		if (type === 'IEND') {
			if (!hasImageData || length !== 0 || end !== bytes.byteLength) {
				throw new TypeError('Chat PNG image requires one terminal IEND chunk.');
			}
			return dimensions;
		}
		offset = end;
	}
	throw new TypeError('Chat PNG image is missing its terminal IEND chunk.');
}

function isJpegStartOfFrame(marker: number): boolean {
	return marker >= 0xc0
		&& marker <= 0xcf
		&& marker !== 0xc4
		&& marker !== 0xc8
		&& marker !== 0xcc;
}

function requireJpegDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
	if (bytes.byteLength < 12
		|| bytes[0] !== 0xff
		|| bytes[1] !== 0xd8
		|| bytes[bytes.byteLength - 2] !== 0xff
		|| bytes[bytes.byteLength - 1] !== 0xd9) {
		throw new TypeError('Chat image bytes are not a valid JPEG container.');
	}

	let offset = 2;
	while (offset < bytes.byteLength - 2) {
		if (bytes[offset] !== 0xff) {
			throw new TypeError('Chat JPEG image contains an invalid marker boundary.');
		}
		while (offset < bytes.byteLength && bytes[offset] === 0xff) {
			offset++;
		}
		const marker = bytes[offset++];
		if (marker === undefined || marker === 0x00 || marker === 0xda || marker === 0xd9) {
			break;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			continue;
		}
		if (offset + 2 > bytes.byteLength) {
			throw new TypeError('Chat JPEG image contains a truncated segment length.');
		}
		const length = bytes[offset] * 0x100 + bytes[offset + 1];
		if (length < 2 || offset + length > bytes.byteLength) {
			throw new TypeError('Chat JPEG image contains a truncated segment.');
		}
		if (isJpegStartOfFrame(marker)) {
			if (length < 7) {
				throw new TypeError('Chat JPEG image contains an invalid frame header.');
			}
			return {
				width: bytes[offset + 5] * 0x100 + bytes[offset + 6],
				height: bytes[offset + 3] * 0x100 + bytes[offset + 4],
			};
		}
		offset += length;
	}
	throw new TypeError('Chat JPEG image is missing a supported frame header.');
}

function requireImageDimensions(
	mediaType: ChatImageMediaType,
	bytes: Uint8Array,
): { readonly width: number; readonly height: number } {
	const dimensions = mediaType === 'image/png'
		? requirePngDimensions(bytes)
		: requireJpegDimensions(bytes);
	return {
		width: requirePositiveInteger(dimensions.width, 'Chat image width', maximumChatImageDimension),
		height: requirePositiveInteger(dimensions.height, 'Chat image height', maximumChatImageDimension),
	};
}

function requireImageMediaType(value: unknown): ChatImageMediaType {
	if (value !== 'image/jpeg' && value !== 'image/png') {
		throw new TypeError('Chat image attachment requires a supported image media type.');
	}
	return value;
}

function requireCanonicalImageBytes(value: unknown): VSBuffer {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError('Chat image attachment requires canonical base64 bytes.');
	}
	const maximumBase64Length = Math.ceil(maximumChatImageAttachmentBytes / 3) * 4;
	if (value.length > maximumBase64Length) {
		throw new RangeError(
			`Chat image attachment exceeds its ${maximumChatImageAttachmentBytes}-byte limit.`,
		);
	}
	let bytes: VSBuffer;
	try {
		bytes = decodeBase64(value);
	} catch (error) {
		throw new TypeError('Chat image attachment contains invalid base64 bytes.', { cause: error });
	}
	if (bytes.byteLength === 0 || bytes.byteLength > maximumChatImageAttachmentBytes) {
		throw new RangeError(
			`Chat image attachment must contain 1-${maximumChatImageAttachmentBytes} bytes.`,
		);
	}
	if (encodeBase64(bytes) !== value) {
		throw new TypeError('Chat image attachment requires canonical padded base64 bytes.');
	}
	return bytes;
}

function requireChatImageState(value: AgentHostProtocolValue): IParsedChatImageAttachmentState {
	const state = requireRecord(value, 'Chat image attachment state');
	requireExactKeys(
		state,
		['name', 'mediaType', 'width', 'height', 'byteLength', 'digest', 'data'],
		'Chat image attachment state',
	);
	const name = requireTrimmedString(state.name, 'Chat image name', 512);
	const mediaType = requireImageMediaType(state.mediaType);
	if (typeof state.data !== 'string') {
		throw new TypeError('Chat image attachment requires canonical base64 bytes.');
	}
	const data = state.data;
	const bytes = requireCanonicalImageBytes(data);
	const dimensions = requireImageDimensions(mediaType, bytes.buffer);
	const width = requirePositiveInteger(state.width, 'Chat image width', maximumChatImageDimension);
	const height = requirePositiveInteger(state.height, 'Chat image height', maximumChatImageDimension);
	if (width !== dimensions.width || height !== dimensions.height) {
		throw new Error('Chat image dimensions do not match its immutable bytes.');
	}
	const byteLength = requirePositiveInteger(
		state.byteLength,
		'Chat image byte length',
		maximumChatImageAttachmentBytes,
	);
	if (byteLength !== bytes.byteLength) {
		throw new Error('Chat image byte length does not match its immutable bytes.');
	}
	if (typeof state.digest !== 'string') {
		throw new TypeError('Chat image attachment requires a content digest.');
	}
	const digest = createAgentContentDigest(state.digest);
	return {
		name,
		mediaType,
		width,
		height,
		byteLength,
		digest,
		data,
		bytes,
	};
}

async function digestBytes(bytes: Uint8Array): Promise<AgentContentDigest> {
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return createAgentContentDigest(
		`sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
	);
}

function pendingAttachment(
	id: string,
	producerType: IPendingChatAttachment['producerType'],
	label: string,
	state: AgentHostProtocolValue,
): IPendingChatAttachment {
	return Object.freeze({
		id: createAgentAttachmentId(id),
		producerType,
		producerStateVersion: ChatOwnedAttachmentStateVersion,
		display: Object.freeze({ label: requireTrimmedString(label, 'Chat attachment label', 512) }),
		state,
	});
}

/** Captures exact text at the explicit Add to Chat boundary. */
export function createChatTextAttachment(id: string, label: string, text: string): IPendingChatAttachment {
	const state: AgentHostProtocolValue = Object.freeze({
		text: requireBoundedText(text, 'Chat attachment text', maximumChatTextAttachmentBytes),
	});
	return pendingAttachment(id, ChatTextAttachmentProducerType, label, state);
}

/** Captures ordered transcript fragments without retaining DOM selection state. */
export function createChatSelectionAttachment(
	id: string,
	label: string,
	sourceChat: URI,
	fragments: readonly IChatSelectionFragment[],
): IPendingChatAttachment {
	const state: AgentHostProtocolValue = {
		sourceChat: sourceChat.toString(true),
		fragments: fragments.map(fragment => ({
			message: fragment.message,
			role: fragment.role,
			text: fragment.text,
		})),
	};
	const parsed = requireChatSelectionState(state);
	return pendingAttachment(
		id,
		ChatSelectionAttachmentProducerType,
		label,
		Object.freeze({
			sourceChat: parsed.sourceChat,
			fragments: Object.freeze(parsed.fragments.map(fragment => Object.freeze({ ...fragment }))),
		}),
	);
}

/** Captures immutable, format-verified image bytes and derives their intrinsic dimensions. */
export async function createChatImageAttachment(
	id: string,
	name: string,
	mediaType: ChatImageMediaType,
	bytes: Uint8Array,
): Promise<IPendingChatAttachment> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	if (copy.byteLength === 0 || copy.byteLength > maximumChatImageAttachmentBytes) {
		throw new RangeError(
			`Chat image attachment must contain 1-${maximumChatImageAttachmentBytes} bytes.`,
		);
	}
	const dimensions = requireImageDimensions(requireImageMediaType(mediaType), copy);
	const digest = await digestBytes(copy);
	const state: AgentHostProtocolValue = Object.freeze({
		name: requireTrimmedString(name, 'Chat image name', 512),
		mediaType,
		width: dimensions.width,
		height: dimensions.height,
		byteLength: copy.byteLength,
		digest,
		data: encodeBase64(VSBuffer.wrap(copy)),
	});
	requireChatImageState(state);
	return pendingAttachment(id, ChatImageAttachmentProducerType, name, state);
}

export const ChatTextAttachmentProducer: IChatAttachmentProducer = Object.freeze({
	type: ChatTextAttachmentProducerType,
	stateVersion: ChatOwnedAttachmentStateVersion,
	validateState: (state: AgentHostProtocolValue) => {
		requireChatTextState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }: Parameters<IChatAttachmentProducer['resolve']>[0]) => {
		const state = requireChatTextState(attachment.state);
		const bytes = new TextEncoder().encode(state.text);
		const digest = await digestBytes(bytes);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: ChatTextAttachmentRepresentationSchema,
				mediaType: 'text/plain',
				value: { byteLength: bytes.byteLength, digest },
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
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	},
});

export const ChatSelectionAttachmentProducer: IChatAttachmentProducer = Object.freeze({
	type: ChatSelectionAttachmentProducerType,
	stateVersion: ChatOwnedAttachmentStateVersion,
	validateState: (state: AgentHostProtocolValue) => {
		requireChatSelectionState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }: Parameters<IChatAttachmentProducer['resolve']>[0]) => {
		const state = requireChatSelectionState(attachment.state);
		const contentState: AgentHostProtocolValue = {
			sourceChat: state.sourceChat,
			fragments: state.fragments.map(fragment => ({ ...fragment })),
		};
		const content = encodeAgentHostProtocolValue(contentState);
		const bytes = new TextEncoder().encode(content);
		const digest = await digestBytes(bytes);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: ChatSelectionAttachmentRepresentationSchema,
				mediaType: 'application/json',
				value: {
					sourceChat: state.sourceChat,
					fragments: state.fragments.map(fragment => ({
						message: fragment.message,
						role: fragment.role,
						byteLength: new TextEncoder().encode(fragment.text).byteLength,
					})),
				},
			},
			content: {
				kind: 'inline',
				mediaType: 'application/json',
				encoding: 'utf8',
				data: content,
				byteLength: bytes.byteLength,
				version: createAgentContentVersion(digest),
				digest,
			},
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	},
});

export const ChatImageAttachmentProducer: IChatAttachmentProducer = Object.freeze({
	type: ChatImageAttachmentProducerType,
	stateVersion: ChatOwnedAttachmentStateVersion,
	validateState: (state: AgentHostProtocolValue) => {
		requireChatImageState(state);
	},
	discard: () => {},
	resolve: async ({ attachment }: Parameters<IChatAttachmentProducer['resolve']>[0]) => {
		const state = requireChatImageState(attachment.state);
		const digest = await digestBytes(state.bytes.buffer);
		if (digest !== state.digest) {
			throw new Error('Chat image digest does not match its immutable bytes.');
		}
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: ChatImageAttachmentRepresentationSchema,
				mediaType: state.mediaType,
				value: {
					name: state.name,
					width: state.width,
					height: state.height,
					byteLength: state.byteLength,
					digest: state.digest,
				},
			},
			content: {
				kind: 'inline',
				mediaType: state.mediaType,
				encoding: 'base64',
				data: state.data,
				byteLength: state.byteLength,
				version: createAgentContentVersion(state.digest),
				digest: state.digest,
			},
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	},
});
