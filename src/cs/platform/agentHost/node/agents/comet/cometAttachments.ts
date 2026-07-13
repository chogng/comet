/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import type { IAgentAttachmentCapabilities } from 'cs/platform/agentHost/common/agent';
import {
	IAgentHostAttachment,
	IAgentHostContentReference,
	assertAgentHostAttachment,
} from 'cs/platform/agentHost/common/attachments';
import {
	assertAgentContentTreeEntry,
	type AgentContentTreeEntry,
	type IAgentContentResourcePort,
} from 'cs/platform/agentHost/common/contentResources';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import type {
	AgentChatId,
	AgentContentLeaseId,
	AgentContentMaterializationId,
	AgentSessionId,
	AgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { ICometModelAttachment } from './cometModel.js';

interface ICometContentLeaseRecord {
	readonly lease: AgentContentLeaseId;
	materialization?: AgentContentMaterializationId;
}

const maximumTreePageEntries = 256;

export interface ICometAttachmentPreparationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
}

export class CometPreparedAttachments {
	private released = false;

	constructor(
		readonly attachments: readonly ICometModelAttachment[],
		private readonly contentResources: IAgentContentResourcePort,
		private readonly leases: readonly ICometContentLeaseRecord[],
	) {}

	async release(): Promise<void> {
		if (this.released) {
			return;
		}
		this.released = true;

		const errors: unknown[] = [];
		for (const record of [...this.leases].reverse()) {
			if (record.materialization !== undefined) {
				try {
					await this.contentResources.releaseMaterialization(record.materialization, CancellationTokenNone);
				} catch (error) {
					errors.push(error);
				}
			}

			try {
				await this.contentResources.release(record.lease, CancellationTokenNone);
			} catch (error) {
				errors.push(error);
			}
		}

		if (errors.length > 0) {
			throw new AggregateError(errors, 'Failed to release Comet attachment content');
		}
	}
}

function invalidAttachment(field: string, value: string | number): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Comet attachment input',
		{ field, value },
	);
}

function assertSupportedMediaType(
	mediaType: string,
	capabilities: IAgentAttachmentCapabilities,
	field: string,
): void {
	if (!capabilities.mediaTypes.includes(mediaType)) {
		invalidAttachment(field, mediaType);
	}
}

function declaredContentBytes(attachment: IAgentHostAttachment): number {
	if (attachment.content === undefined) {
		return 0;
	}
	return attachment.content.kind === 'inline'
		? attachment.content.byteLength
		: attachment.content.bounds.byteLength;
}

function validateAttachments(
	attachments: readonly IAgentHostAttachment[],
	capabilities: IAgentAttachmentCapabilities,
): void {
	if (attachments.length > capabilities.maximumCount) {
		invalidAttachment('attachments.length', attachments.length);
	}

	const ids = new Set<string>();
	let totalBytes = 0;
	for (const [index, attachment] of attachments.entries()) {
		assertAgentHostAttachment(attachment);
		if (ids.has(attachment.id)) {
			invalidAttachment(`attachments.${index}.id`, attachment.id);
		}
		ids.add(attachment.id);

		assertSupportedMediaType(
			attachment.representation.mediaType,
			capabilities,
			`attachments.${index}.representation.mediaType`,
		);

		const byteLength = declaredContentBytes(attachment);
		if (byteLength > capabilities.maximumItemBytes) {
			invalidAttachment(`attachments.${index}.content.byteLength`, byteLength);
		}
		totalBytes += byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > capabilities.maximumTotalBytes) {
			invalidAttachment('attachments.totalBytes', totalBytes);
		}

		if (attachment.content === undefined) {
			continue;
		}
		if (!capabilities.carriers.includes(attachment.content.kind)) {
			invalidAttachment(`attachments.${index}.content.kind`, attachment.content.kind);
		}
		if (attachment.content.mediaType !== undefined) {
			assertSupportedMediaType(
				attachment.content.mediaType,
				capabilities,
				`attachments.${index}.content.mediaType`,
			);
		}
		if (attachment.content.kind === 'reference') {
			if (!capabilities.shapes.includes(attachment.content.shape)) {
				invalidAttachment(`attachments.${index}.content.shape`, attachment.content.shape);
			}
			if (attachment.content.shape === 'tree') {
				const treeDepth = attachment.content.bounds.treeDepth;
				const treeEntryCount = attachment.content.bounds.treeEntryCount;
				if (
					treeDepth === undefined
					|| treeEntryCount === undefined
					|| treeDepth > capabilities.maximumTreeDepth
					|| treeEntryCount > capabilities.maximumTreeEntries
				) {
					invalidAttachment(`attachments.${index}.content.bounds`, attachment.content.bounds.byteLength);
				}
			}
		}
	}
}

function assertSameContentReference(
	expected: IAgentHostContentReference,
	received: IAgentHostContentReference,
): void {
	if (encodeAgentHostProtocolValue(expected) !== encodeAgentHostProtocolValue(received)) {
		invalidAttachment('contentResource.lease.content', received.reference);
	}
}

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function treeDepth(value: string): number {
	return value.split('/').length;
}

function contentDigest(value: string): string {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readTreeEntries(
	contentResources: IAgentContentResourcePort,
	lease: AgentContentLeaseId,
	content: IAgentHostContentReference,
	token: CancellationToken,
): Promise<readonly AgentContentTreeEntry[] | null> {
	if (content.shape === 'blob') {
		return null;
	}
	const expectedCount = content.bounds.treeEntryCount;
	const expectedDepth = content.bounds.treeDepth;
	if (expectedCount === undefined || expectedDepth === undefined) {
		return invalidAttachment('content.tree.bounds', content.bounds.byteLength);
	}

	const entries: AgentContentTreeEntry[] = [];
	const paths = new Set<string>();
	const cursors = new Set<string>();
	let cursor: string | null = null;
	let pages = 0;
	let fileBytes = 0;
	let maximumDepth = 0;
	do {
		throwIfCancelled(token);
		pages += 1;
		if (pages > Math.max(1, expectedCount + 1)) {
			return invalidAttachment('content.tree.pages', pages);
		}
		const page = await contentResources.readTreePage({
			lease,
			cursor,
			maximumEntries: Math.max(1, Math.min(maximumTreePageEntries, expectedCount)),
		}, token);
		for (const entry of page.entries) {
			assertAgentContentTreeEntry(entry, `content.tree.entries.${entries.length}`);
			if (
				paths.has(entry.path)
				|| (entries.length > 0 && comparePaths(entries[entries.length - 1].path, entry.path) >= 0)
			) {
				return invalidAttachment('content.tree.entries.order', entry.path);
			}
			paths.add(entry.path);
			maximumDepth = Math.max(maximumDepth, treeDepth(entry.path));
			if (entry.kind === 'file') {
				fileBytes += entry.byteLength;
				if (!Number.isSafeInteger(fileBytes) || fileBytes > content.bounds.byteLength) {
					return invalidAttachment('content.tree.entries.byteLength', fileBytes);
				}
			}
			entries.push(Object.freeze({ ...entry }));
		}
		cursor = page.nextCursor;
		if (cursor !== null && cursors.has(cursor)) {
			return invalidAttachment('content.tree.cursor', cursor);
		}
		if (cursor !== null) {
			cursors.add(cursor);
		}
	} while (cursor !== null);

	if (
		entries.length !== expectedCount
		|| fileBytes !== content.bounds.byteLength
		|| maximumDepth !== expectedDepth
		|| contentDigest(encodeAgentHostProtocolValue(entries)) !== content.digest
	) {
		return invalidAttachment('content.tree.manifest', content.reference);
	}
	const entriesByPath = new Map(entries.map(entry => [entry.path, entry]));
	for (const entry of entries) {
		const segments = entry.path.split('/');
		for (let index = 1; index < segments.length; index += 1) {
			if (entriesByPath.get(segments.slice(0, index).join('/'))?.kind !== 'directory') {
				return invalidAttachment('content.tree.manifest.parent', entry.path);
			}
		}
	}
	return Object.freeze(entries);
}

export async function prepareCometModelAttachments(
	attachments: readonly IAgentHostAttachment[],
	capabilities: IAgentAttachmentCapabilities,
	context: ICometAttachmentPreparationContext,
	contentResources: IAgentContentResourcePort,
	token: CancellationToken,
): Promise<CometPreparedAttachments> {
	validateAttachments(attachments, capabilities);
	throwIfCancelled(token);

	const leases: ICometContentLeaseRecord[] = [];
	const prepared: ICometModelAttachment[] = [];
	try {
		for (const attachment of attachments) {
			throwIfCancelled(token);
			if (attachment.content === undefined) {
				prepared.push({ attachment });
				continue;
			}
			if (attachment.content.kind === 'inline') {
				prepared.push({
					attachment,
					content: { kind: 'inline', content: attachment.content },
				});
				continue;
			}

			const lease = await contentResources.open({
				...context,
				attachment: attachment.id,
				content: attachment.content,
			}, token);
			assertSameContentReference(attachment.content, lease.content);
			const leaseRecord: ICometContentLeaseRecord = { lease: lease.lease };
			leases.push(leaseRecord);
			throwIfCancelled(token);
			const treeEntries = await readTreeEntries(
				contentResources,
				lease.lease,
				attachment.content,
				token,
			);

			const materialization = await contentResources.materialize({ lease: lease.lease }, token);
			leaseRecord.materialization = materialization.id;
			throwIfCancelled(token);
			prepared.push({
				attachment,
				content: {
					kind: 'materialized',
					content: attachment.content,
					resource: materialization.resource,
					treeEntries,
				},
			});
		}

		return new CometPreparedAttachments(prepared, contentResources, leases);
	} catch (error) {
		const owner = new CometPreparedAttachments([], contentResources, leases);
		try {
			await owner.release();
		} catch (releaseError) {
			throw new AggregateError([error, releaseError], 'Comet attachment preparation and cleanup failed');
		}
		throw error;
	}
}
