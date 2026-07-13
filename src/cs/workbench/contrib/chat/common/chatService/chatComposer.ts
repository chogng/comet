/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationError,
	isCancellationError,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import {
	assertAgentHostAttachment,
	type IAgentHostAttachment,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	type AgentAttachmentId,
	type AgentAttachmentProducerTypeId,
	type AgentSubmissionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
	type IAgentHostDisplayMetadata,
} from 'cs/platform/agentHost/common/protocolValues';

export const maximumPendingChatAttachments = 128;
export const maximumPendingChatInteractionTargets = 128;
export const maximumPendingChatAttachmentStateBytes = 1024 * 1024;

/** Serializable producer-owned state retained in one addressed Chat composer. */
export interface IPendingChatAttachment {
	readonly id: AgentAttachmentId;
	readonly producerType: AgentAttachmentProducerTypeId;
	readonly producerStateVersion: number;
	readonly display: IAgentHostDisplayMetadata;
	readonly state: AgentHostProtocolValue;
}

/** Exact immutable composer values captured before one Host submission is prepared. */
export interface IChatSubmissionCapture {
	readonly submissionId: AgentSubmissionId;
	readonly composerRevision: number;
	readonly prompt: string;
	readonly attachments: readonly IPendingChatAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
}

export interface IChatAttachmentResolutionContext {
	readonly chatResource: URI;
	readonly submissionId: AgentSubmissionId;
	readonly attachment: IPendingChatAttachment;
	readonly token: CancellationToken;
}

/** One staged normalized attachment whose temporary publication must be released exactly once. */
export interface IPreparedChatAttachment {
	readonly attachment: IAgentHostAttachment;
	release(): Promise<void>;
}

/** Feature-owned current-version codec and resolver for one attachment producer type. */
export interface IChatAttachmentProducer {
	readonly type: AgentAttachmentProducerTypeId;
	readonly stateVersion: number;
	validateState(state: AgentHostProtocolValue): void;
	/** Releases producer-owned resources after the pending composer value is permanently discarded. */
	discard(attachment: IPendingChatAttachment): void;
	resolve(context: IChatAttachmentResolutionContext): Promise<IPreparedChatAttachment>;
}

export interface IPreparedChatAttachments {
	readonly attachments: readonly IAgentHostAttachment[];
	release(): Promise<void>;
}

function assertDisplayMetadata(display: IAgentHostDisplayMetadata): void {
	if (!display
		|| typeof display.label !== 'string'
		|| display.label.length === 0
		|| display.label.length > 512
		|| (display.description !== undefined
			&& (typeof display.description !== 'string' || display.description.length > 2_048))) {
		throw new TypeError('A pending Chat attachment requires bounded display metadata.');
	}
}

function cloneProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(cloneProtocolValue));
	}
	return Object.freeze(Object.fromEntries(
		Object.entries(value).map(([key, child]) => [key, cloneProtocolValue(child)]),
	));
}

/** Validates and freezes one current producer-state envelope for composer ownership. */
export function capturePendingChatAttachment(attachment: IPendingChatAttachment): IPendingChatAttachment {
	createAgentAttachmentId(attachment.id);
	createAgentAttachmentProducerTypeId(attachment.producerType);
	if (!Number.isSafeInteger(attachment.producerStateVersion) || attachment.producerStateVersion <= 0) {
		throw new TypeError('A pending Chat attachment requires a positive producer-state version.');
	}
	assertDisplayMetadata(attachment.display);
	assertAgentHostProtocolValue(attachment.state);
	if (new TextEncoder().encode(encodeAgentHostProtocolValue(attachment.state)).byteLength
		> maximumPendingChatAttachmentStateBytes) {
		throw new RangeError(
			`A pending Chat attachment state cannot exceed ${maximumPendingChatAttachmentStateBytes} bytes.`,
		);
	}

	return Object.freeze({
		id: attachment.id,
		producerType: attachment.producerType,
		producerStateVersion: attachment.producerStateVersion,
		display: Object.freeze({ ...attachment.display }),
		state: cloneProtocolValue(attachment.state),
	});
}

/** Owns exact current-version producer registrations without inferring another producer. */
export class ChatAttachmentProducerRegistry {
	private readonly producers = new Map<AgentAttachmentProducerTypeId, IChatAttachmentProducer>();

	register(producer: IChatAttachmentProducer): IDisposable {
		createAgentAttachmentProducerTypeId(producer.type);
		if (!Number.isSafeInteger(producer.stateVersion) || producer.stateVersion <= 0) {
			throw new TypeError(`Chat attachment producer '${producer.type}' has an invalid state version.`);
		}
		if (this.producers.has(producer.type)) {
			throw new Error(`Chat attachment producer '${producer.type}' is already registered.`);
		}
		this.producers.set(producer.type, producer);
		return toDisposable(() => {
			if (this.producers.get(producer.type) !== producer) {
				throw new Error(`Chat attachment producer ownership changed for '${producer.type}'.`);
			}
			this.producers.delete(producer.type);
		});
	}

	has(type: AgentAttachmentProducerTypeId): boolean {
		return this.producers.has(type);
	}

	validate(attachment: IPendingChatAttachment): void {
		const producer = this.requireProducer(attachment.producerType);
		if (producer.stateVersion !== attachment.producerStateVersion) {
			throw new Error(
				`Chat attachment '${attachment.id}' uses producer-state version ${attachment.producerStateVersion}; `
				+ `producer '${producer.type}' requires version ${producer.stateVersion}.`,
			);
		}
		producer.validateState(attachment.state);
	}

	discard(attachment: IPendingChatAttachment): void {
		const producer = this.requireProducer(attachment.producerType);
		this.validate(attachment);
		producer.discard(attachment);
	}

	discardAll(attachments: readonly IPendingChatAttachment[]): void {
		const errors: unknown[] = [];
		for (const attachment of attachments) {
			try {
				this.discard(attachment);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Failed to discard pending Chat attachments.');
		}
	}

	async resolve(
		chatResource: URI,
		submissionId: AgentSubmissionId,
		attachment: IPendingChatAttachment,
		token: CancellationToken,
	): Promise<IPreparedChatAttachment> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const producer = this.requireProducer(attachment.producerType);
		this.validate(attachment);
		const prepared = await producer.resolve({ chatResource, submissionId, attachment, token });
		if (token.isCancellationRequested) {
			const cancellation = new CancellationError();
			try {
				await prepared.release();
			} catch (releaseError) {
				throw new AggregateError(
					[cancellation, releaseError],
					`Failed to release cancelled Chat attachment '${attachment.id}'.`,
				);
			}
			throw cancellation;
		}
		try {
			assertAgentHostAttachment(prepared.attachment);
			if (prepared.attachment.id !== attachment.id
				|| prepared.attachment.producerType !== attachment.producerType) {
				throw new Error(`Chat attachment producer '${producer.type}' changed the captured attachment identity.`);
			}
		} catch (validationError) {
			try {
				await prepared.release();
			} catch (releaseError) {
				throw new AggregateError(
					[validationError, releaseError],
					`Failed to discard invalid Chat attachment '${attachment.id}'.`,
				);
			}
			throw validationError;
		}
		return prepared;
	}

	private requireProducer(type: AgentAttachmentProducerTypeId): IChatAttachmentProducer {
		const producer = this.producers.get(type);
		if (!producer) {
			throw new Error(`Chat attachment producer '${type}' is unavailable.`);
		}
		return producer;
	}
}

async function releasePreparedAttachments(
	prepared: readonly IPreparedChatAttachment[],
): Promise<readonly unknown[]> {
	const releases = await Promise.allSettled(prepared.map(attachment => attachment.release()));
	return releases.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
}

/** Resolves one captured ordered batch and releases every staged value on any failure. */
export async function prepareChatAttachments(
	registry: ChatAttachmentProducerRegistry,
	chatResource: URI,
	capture: IChatSubmissionCapture,
	token: CancellationToken,
): Promise<IPreparedChatAttachments> {
	const resolutions = await Promise.allSettled(capture.attachments.map(attachment =>
		registry.resolve(chatResource, capture.submissionId, attachment, token),
	));
	const prepared = resolutions.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
	const resolutionErrors = resolutions.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
	if (resolutionErrors.length > 0 || token.isCancellationRequested) {
		const errors = token.isCancellationRequested && !resolutionErrors.some(isCancellationError)
			? [new CancellationError(), ...resolutionErrors]
			: resolutionErrors;
		const releaseErrors = await releasePreparedAttachments(prepared);
		const allErrors = [...errors, ...releaseErrors];
		throw allErrors.length === 1
			? allErrors[0]
			: new AggregateError(allErrors, 'Failed to prepare the captured Chat attachments.');
	}

	let released = false;
	return Object.freeze({
		attachments: Object.freeze(prepared.map(result => result.attachment)),
		release: async () => {
			if (released) {
				throw new Error(`Prepared Chat attachments for submission '${capture.submissionId}' were already released.`);
			}
			released = true;
			const errors = await releasePreparedAttachments(prepared);
			if (errors.length === 1) {
				throw errors[0];
			}
			if (errors.length > 1) {
				throw new AggregateError(errors, 'Failed to release prepared Chat attachments.');
			}
		},
	});
}
