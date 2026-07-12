/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	decodeBase64,
	encodeBase64,
	type VSBuffer,
} from 'cs/base/common/buffer';

export type ChatImageMimeType = 'image/jpeg' | 'image/png';

/** Immutable image bytes attached to one Chat message. */
export interface IChatImageAttachment {
	readonly id: string;
	readonly name: string;
	readonly mimeType: ChatImageMimeType;
	readonly data: string;
}

export const maximumChatImageAttachmentBytes = 8 * 1024 * 1024;
export const maximumChatImageAttachmentsPerMessage = 8;
export const maximumChatImageAttachmentsBytesPerMessage = 12 * 1024 * 1024;

function requireTrimmedString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`A Chat image attachment requires a trimmed ${name}.`);
	}
	return value;
}

function requireMimeType(value: unknown): ChatImageMimeType {
	if (value !== 'image/jpeg' && value !== 'image/png') {
		throw new TypeError('A Chat image attachment requires a supported image MIME type.');
	}
	return value;
}

/** Strictly validates, clones, and freezes one image attachment. */
export function parseChatImageAttachment(value: unknown): IChatImageAttachment {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A Chat image attachment must be an object.');
	}
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).some(key => !['id', 'name', 'mimeType', 'data'].includes(key))) {
		throw new TypeError('A Chat image attachment contains an unsupported property.');
	}
	const id = requireTrimmedString(candidate.id, 'ID');
	const name = requireTrimmedString(candidate.name, 'name');
	const mimeType = requireMimeType(candidate.mimeType);
	if (typeof candidate.data !== 'string' || !candidate.data) {
		throw new TypeError('A Chat image attachment requires base64 image data.');
	}
	const maximumBase64Length = Math.ceil(maximumChatImageAttachmentBytes / 3) * 4;
	if (candidate.data.length > maximumBase64Length) {
		throw new RangeError(
			`A Chat image attachment exceeds its ${maximumChatImageAttachmentBytes}-byte limit.`,
		);
	}
	let bytes: VSBuffer;
	try {
		bytes = decodeBase64(candidate.data);
	} catch (error) {
		throw new TypeError('A Chat image attachment contains invalid base64 data.', { cause: error });
	}
	if (bytes.byteLength === 0 || bytes.byteLength > maximumChatImageAttachmentBytes) {
		throw new RangeError(
			`A Chat image attachment must contain 1-${maximumChatImageAttachmentBytes} bytes.`,
		);
	}
	if (encodeBase64(bytes) !== candidate.data) {
		throw new TypeError('A Chat image attachment requires canonical padded base64 data.');
	}
	return Object.freeze({ id, name, mimeType, data: candidate.data });
}

/** Strictly validates one complete message image set. */
export function parseChatImageAttachments(value: unknown): readonly IChatImageAttachment[] {
	if (!Array.isArray(value)) {
		throw new TypeError('Chat message image attachments must be an array.');
	}
	if (value.length > maximumChatImageAttachmentsPerMessage) {
		throw new RangeError(
			`A Chat message accepts at most ${maximumChatImageAttachmentsPerMessage} image attachments.`,
		);
	}
	const attachments = value.map(parseChatImageAttachment);
	const ids = attachments.map(attachment => attachment.id);
	if (new Set(ids).size !== ids.length) {
		throw new TypeError('A Chat message contains duplicate image attachment IDs.');
	}
	const totalBytes = attachments.reduce(
		(total, attachment) => total + decodeBase64(attachment.data).byteLength,
		0,
	);
	if (totalBytes > maximumChatImageAttachmentsBytesPerMessage) {
		throw new RangeError(
			`Chat message images exceed their ${maximumChatImageAttachmentsBytesPerMessage}-byte aggregate limit.`,
		);
	}
	return Object.freeze(attachments);
}

export function createChatImageAttachment(
	id: string,
	name: string,
	mimeType: ChatImageMimeType,
	bytes: VSBuffer,
): IChatImageAttachment {
	return parseChatImageAttachment({
		id,
		name,
		mimeType,
		data: encodeBase64(bytes),
	});
}

export function toChatImageDataUrl(attachment: IChatImageAttachment): string {
	return `data:${attachment.mimeType};base64,${attachment.data}`;
}
