/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { getErrorMessage } from 'cs/base/common/errors';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	type AgentHostClientConnectionId,
	type AgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
} from 'cs/platform/agentHost/common/identities';
import {
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import { maximumBrowserViewReadableContentCharacters } from 'cs/platform/browserView/common/browserView';
import {
	IBrowserViewWorkbenchService,
} from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserDocumentTargetOwner,
	BrowserDocumentTargetType,
} from 'cs/workbench/contrib/browserView/common/browserAgentTools';

const BrowserReadableContentToolId = createAgentToolId('browser.readable-content');
const BrowserReadableContentToolDescriptorRevision = createAgentToolDescriptorRevision('browser.readable-content.v1');
const BrowserReadableContentToolRegistrationId = createAgentToolRegistrationId('browser.readable-content');
const BrowserReadableContentToolRegistrationRevision = createAgentToolRegistrationRevision('browser.readable-content.v1');
const BrowserReadableContentToolExecutorId = createAgentToolExecutorId('browser.readable-content');
const maximumBrowserReadableContentChunkCharacters = 65_536;

const BrowserReadableContentInputSchema = Object.freeze({
	type: 'oneOf',
	variants: Object.freeze([
		Object.freeze({
			type: 'object',
			properties: Object.freeze({
				cursor: Object.freeze({ type: 'literal', value: 0 }),
				maximumCharacters: Object.freeze({
					type: 'integer',
					minimum: 1,
					maximum: maximumBrowserReadableContentChunkCharacters,
				}),
				expectedDigest: Object.freeze({ type: 'literal', value: null }),
			}),
			required: Object.freeze(['cursor', 'maximumCharacters', 'expectedDigest']),
			additionalProperties: false,
		}),
		Object.freeze({
			type: 'object',
			properties: Object.freeze({
				cursor: Object.freeze({
					type: 'integer',
					minimum: 1,
					maximum: maximumBrowserViewReadableContentCharacters - 1,
				}),
				maximumCharacters: Object.freeze({
					type: 'integer',
					minimum: 1,
					maximum: maximumBrowserReadableContentChunkCharacters,
				}),
				expectedDigest: Object.freeze({
					type: 'string',
					minimumLength: 71,
					maximumLength: 71,
				}),
			}),
			required: Object.freeze(['cursor', 'maximumCharacters', 'expectedDigest']),
			additionalProperties: false,
		}),
	]),
});

const BrowserReadableContentOutputSchema = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		resource: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 4_096 }),
		documentEpoch: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 256 }),
		url: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 65_536 }),
		title: Object.freeze({ type: 'string', maximumLength: 16_384 }),
		text: Object.freeze({ type: 'string', maximumLength: maximumBrowserReadableContentChunkCharacters }),
		digest: Object.freeze({ type: 'string', minimumLength: 71, maximumLength: 71 }),
		cursor: Object.freeze({ type: 'integer', minimum: 0, maximum: maximumBrowserViewReadableContentCharacters - 1 }),
		nextCursor: Object.freeze({
			type: 'oneOf',
			variants: Object.freeze([
				Object.freeze({ type: 'null' }),
				Object.freeze({ type: 'integer', minimum: 1, maximum: maximumBrowserViewReadableContentCharacters - 1 }),
			]),
		}),
		totalCharacters: Object.freeze({ type: 'integer', minimum: 0, maximum: maximumBrowserViewReadableContentCharacters }),
		returnedCharacters: Object.freeze({ type: 'integer', minimum: 0, maximum: maximumBrowserReadableContentChunkCharacters }),
		sourceByteLength: Object.freeze({ type: 'integer', minimum: 0, maximum: 4 * maximumBrowserViewReadableContentCharacters }),
		maximumSourceCharacters: Object.freeze({ type: 'literal', value: maximumBrowserViewReadableContentCharacters }),
		sourceTruncated: Object.freeze({ type: 'boolean' }),
		complete: Object.freeze({ type: 'boolean' }),
	}),
	required: Object.freeze([
		'resource',
		'documentEpoch',
		'url',
		'title',
		'text',
		'digest',
		'cursor',
		'nextCursor',
		'totalCharacters',
		'returnedCharacters',
		'sourceByteLength',
		'maximumSourceCharacters',
		'sourceTruncated',
		'complete',
	]),
	additionalProperties: false,
});

export function createBrowserReadableContentToolRegistration(
	connection: AgentHostClientConnectionId,
): IAgentToolRegistration {
	return Object.freeze({
		id: BrowserReadableContentToolRegistrationId,
		revision: BrowserReadableContentToolRegistrationRevision,
		descriptor: Object.freeze({
			id: BrowserReadableContentToolId,
			revision: BrowserReadableContentToolDescriptorRevision,
			contributor: createAgentToolContributorId('browser-view'),
			functionName: 'read_browser_content',
			displayName: 'Read Browser Content',
			description: 'Reads one bounded normalized chunk from the exact addressed Browser document epoch.',
			inputSchema: Object.freeze({
				profile: COMET_TOOL_SCHEMA_PROFILE,
				value: BrowserReadableContentInputSchema,
			}),
			outputSchema: Object.freeze({
				profile: COMET_TOOL_SCHEMA_PROFILE,
				value: BrowserReadableContentOutputSchema,
			}),
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: Object.freeze([BrowserDocumentTargetType]),
			limits: Object.freeze({
				maximumInputBytes: 512,
				maximumOutputBytes: 512 * 1_024,
				maximumContentBytes: 512 * 1_024,
				timeoutMilliseconds: 30_000,
				maximumConcurrency: 4,
			}),
		}),
		executor: Object.freeze({
			kind: 'client',
			connection,
			executor: BrowserReadableContentToolExecutorId,
		}),
	});
}

interface IBrowserReadableContentInput {
	readonly cursor: number;
	readonly maximumCharacters: number;
	readonly expectedDigest: string | null;
}

type BrowserReadableContentFailureCode = 'invalidInput' | 'invalidOutput' | 'unavailable';

class BrowserReadableContentFailure extends Error {
	constructor(
		readonly code: BrowserReadableContentFailureCode,
		message: string,
	) {
		super(message);
	}
}

interface IBrowserReadableContentCallRecord {
	readonly canonicalCall: string;
	cancelled: boolean;
	result: AgentToolResult | undefined;
}

function requireInput(value: AgentHostProtocolValue): IBrowserReadableContentInput {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new BrowserReadableContentFailure('invalidInput', 'Browser readable-content input must be an object.');
	}
	const input = value as Readonly<Record<string, AgentHostProtocolValue>>;
	const keys = Object.keys(input);
	if (keys.length !== 3 || !keys.includes('cursor') || !keys.includes('maximumCharacters') || !keys.includes('expectedDigest')) {
		throw new BrowserReadableContentFailure('invalidInput', 'Browser readable-content input contains unsupported properties.');
	}
	if (!Number.isSafeInteger(input.cursor)
		|| Number(input.cursor) < 0
		|| Number(input.cursor) >= maximumBrowserViewReadableContentCharacters) {
		throw new BrowserReadableContentFailure('invalidInput', 'Browser readable-content cursor is out of range.');
	}
	if (!Number.isSafeInteger(input.maximumCharacters)
		|| Number(input.maximumCharacters) < 1
		|| Number(input.maximumCharacters) > maximumBrowserReadableContentChunkCharacters) {
		throw new BrowserReadableContentFailure('invalidInput', 'Browser readable-content requested bound is out of range.');
	}
	const cursor = Number(input.cursor);
	if (cursor === 0) {
		if (input.expectedDigest !== null) {
			throw new BrowserReadableContentFailure('invalidInput', 'The first Browser readable-content chunk requires a null digest.');
		}
	} else if (typeof input.expectedDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.expectedDigest)) {
		throw new BrowserReadableContentFailure('invalidInput', 'A later Browser readable-content chunk requires the first chunk digest.');
	}
	return {
		cursor,
		maximumCharacters: Number(input.maximumCharacters),
		expectedDigest: input.expectedDigest as string | null,
	};
}

async function digestText(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function terminalFailure(
	call: AgentToolCallId,
	code: BrowserReadableContentFailureCode | 'cancelled',
	message: string,
): AgentToolResult {
	const boundedMessage = message.slice(0, 8_192);
	return Object.freeze(code === 'cancelled'
		? {
			call,
			status: 'cancelled',
			failure: Object.freeze({
				code: 'cancelled',
				message: boundedMessage,
				reconciliation: 'terminal',
			}),
		}
		: {
			call,
			status: 'failed',
			failure: Object.freeze({
				code,
				message: boundedMessage,
				reconciliation: 'terminal',
			}),
		});
}

/** Executes exact Browser document reads without consulting the active Editor or Browser. */
export class BrowserReadableContentToolEndpoint implements IAgentToolExecutorEndpoint {
	private readonly calls = new Map<AgentToolCallId, IBrowserReadableContentCallRecord>();

	constructor(
		private readonly connection: AgentHostClientConnectionId,
		private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		_reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		this.assertExactCall(call);
		const canonicalCall = encodeAgentHostProtocolValue(call);
		const existing = this.calls.get(call.id);
		if (existing) {
			if (existing.canonicalCall !== canonicalCall || existing.result === undefined) {
				throw new Error(`Browser readable-content call '${call.id}' conflicts with endpoint state.`);
			}
			return existing.result;
		}
		const record: IBrowserReadableContentCallRecord = {
			canonicalCall,
			cancelled: false,
			result: undefined,
		};
		this.calls.set(call.id, record);
		const finish = (result: AgentToolResult): AgentToolResult => {
			record.result = result;
			return result;
		};

		try {
			if (cancellation.isCancellationRequested || record.cancelled) {
				return finish(terminalFailure(call.id, 'cancelled', 'Browser readable-content execution was cancelled.'));
			}
			const input = requireInput(call.input);
			this.requireTarget(call, target);
			const inputForTarget = this.browserViewWorkbenchService.getKnownBrowserViews().get(target.resource);
			const model = inputForTarget?.model;
			if (!model || model.id !== target.resource) {
				throw new BrowserReadableContentFailure('unavailable', `Browser document '${target.resource}' is unavailable.`);
			}
			const content = await model.readReadableContent(target.resourceVersion);
			if (cancellation.isCancellationRequested || record.cancelled) {
				return finish(terminalFailure(call.id, 'cancelled', 'Browser readable-content execution was cancelled.'));
			}
			if (content.documentEpoch !== target.resourceVersion || content.url.length === 0 || content.url.length > 65_536
				|| content.title.length > 16_384 || content.text.length > maximumBrowserViewReadableContentCharacters
				|| !Number.isSafeInteger(content.byteLength) || content.byteLength < 0
				|| typeof content.truncated !== 'boolean' || !/^sha256:[a-f0-9]{64}$/.test(content.digest)) {
				throw new BrowserReadableContentFailure('invalidOutput', 'Browser readable-content extraction returned an invalid snapshot.');
			}
			const bytes = new TextEncoder().encode(content.text);
			const digest = await digestText(content.text);
			if (cancellation.isCancellationRequested || record.cancelled) {
				return finish(terminalFailure(call.id, 'cancelled', 'Browser readable-content execution was cancelled.'));
			}
			if (content.byteLength !== bytes.byteLength || content.digest !== digest) {
				throw new BrowserReadableContentFailure('invalidOutput', 'Browser readable-content extraction returned inconsistent content.');
			}
			if (input.cursor > 0 && input.expectedDigest !== digest) {
				throw new BrowserReadableContentFailure('invalidInput', 'Browser readable content changed between chunks.');
			}
			if (input.cursor > 0 && input.cursor >= content.text.length) {
				throw new BrowserReadableContentFailure('invalidInput', 'Browser readable-content cursor is beyond the captured content.');
			}
			const end = Math.min(content.text.length, input.cursor + input.maximumCharacters);
			const text = content.text.slice(input.cursor, end);
			const nextCursor = end < content.text.length ? end : null;
			return finish(Object.freeze({
				call: call.id,
				status: 'completed',
				output: Object.freeze({
					resource: target.resource,
					documentEpoch: content.documentEpoch,
					url: content.url,
					title: content.title,
					text,
					digest,
					cursor: input.cursor,
					nextCursor,
					totalCharacters: content.text.length,
					returnedCharacters: text.length,
					sourceByteLength: content.byteLength,
					maximumSourceCharacters: maximumBrowserViewReadableContentCharacters,
					sourceTruncated: content.truncated,
					complete: nextCursor === null,
				}),
			}));
		} catch (error) {
			if (cancellation.isCancellationRequested || record.cancelled) {
				return finish(terminalFailure(call.id, 'cancelled', 'Browser readable-content execution was cancelled.'));
			}
			if (error instanceof BrowserReadableContentFailure) {
				return finish(terminalFailure(call.id, error.code, error.message));
			}
			return finish(terminalFailure(call.id, 'unavailable', getErrorMessage(error)));
		}
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		this.assertExactCall(call);
		const record = this.calls.get(call.id);
		if (!record || record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Browser readable-content call '${call.id}' is unavailable.`);
		}
		if (record.result === undefined) {
			record.cancelled = true;
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.assertExactCall(call);
		const record = this.calls.get(call.id);
		if (!record) {
			return Object.freeze({ kind: 'unknown' });
		}
		if (record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Browser readable-content call '${call.id}' conflicts with its recorded identity.`);
		}
		return record.result === undefined
			? Object.freeze({ kind: 'pending' })
			: Object.freeze({ kind: 'terminal', result: record.result });
	}

	private assertExactCall(call: IAgentToolCall): void {
		if (call.registrationId !== BrowserReadableContentToolRegistrationId
			|| call.registrationRevision !== BrowserReadableContentToolRegistrationRevision
			|| call.tool !== BrowserReadableContentToolId
			|| call.descriptor !== BrowserReadableContentToolDescriptorRevision
			|| call.target === undefined
			|| call.effect.kind !== 'read') {
			throw new Error(`Browser readable-content call '${call.id}' does not match the endpoint registration.`);
		}
	}

	private requireTarget(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
	): asserts target is IAgentHostInteractionTarget {
		if (!target || call.target !== target.id
			|| target.owner !== BrowserDocumentTargetOwner
			|| target.type !== BrowserDocumentTargetType
			|| target.schemaVersion !== 1
			|| target.revision !== target.resourceVersion
			|| target.authority.kind !== 'client'
			|| target.authority.connection !== this.connection
			|| target.availability !== 'turn') {
			throw new BrowserReadableContentFailure('unavailable', 'Browser readable-content call does not address an exact Browser document target.');
		}
	}
}
