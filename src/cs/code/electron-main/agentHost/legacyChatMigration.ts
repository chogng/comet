/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import type { IStorage } from 'cs/base/parts/storage/common/storage';
import { URI } from 'cs/base/common/uri';
import {
	parseWritingEditorDocument,
	type WritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import type { AgentTurnResponsePart } from 'cs/platform/agentHost/common/agent';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentHostClientConnectionId,
	createAgentToolCallId,
	type AgentHostPayloadDigest,
	type AgentToolCallId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostChatState } from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	type IAgentHostLegacyCatalogMigrationCompanion,
	type IAgentHostLegacyChatPresentationSource,
	type IAgentHostLegacyTurnEnrichment,
	type IAgentHostPersistedCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';
import { createAgentHostChatResource } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionResources';
import {
	ApplicationStorageChatPersistenceStore,
	ChatPersistenceSchemaVersion,
	parseChatPersistedResourceState,
	type IChatPersistedResourceState,
	type IChatPersistedState,
} from 'cs/workbench/contrib/chat/common/chatService/chatPersistence';
import {
	ChatHostPresentationSchemaVersion,
	parseChatHostPresentation,
	type IChatHostPresentation,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import {
	ArticleHistoryChatPresentationType,
	createArticleHistoryChatPresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatPresentations';
import {
	createDraftEditorInteractionTarget,
	DraftEditorProposeEditorPatchToolId,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';
import {
	createDraftEditorPatchPresentationValue,
	DraftEditorPatchPresentationType,
	parseDraftEditorPatchProposal,
	type DraftEditorPatchApplyState,
	type IDraftEditorPatchProposal,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorChatPresentations';
import { DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import type { AgentHostAuthorityId } from 'cs/platform/agentHost/common/identities';

const maximumLegacyStringLength = 16 * 1024 * 1024;

interface IPreparedLegacyPatch {
	readonly turn: IAgentHostLegacyChatPresentationSource['assistantMessages'][number]['turn'];
	readonly call: AgentToolCallId;
	readonly target: IAgentHostInteractionTarget;
	readonly proposal: IDraftEditorPatchProposal;
	readonly applyState: DraftEditorPatchApplyState;
	readonly toolCall: Extract<AgentTurnResponsePart, { readonly kind: 'toolCall' }>;
	readonly toolResult: Extract<AgentTurnResponsePart, { readonly kind: 'toolResult' }>;
}

interface IPreparedLegacyChat {
	readonly source: IAgentHostLegacyChatPresentationSource;
	readonly presentations: readonly IChatHostPresentation[];
	readonly patches: readonly IPreparedLegacyPatch[];
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (required.some(key => !Object.hasOwn(record, key))
		|| Object.keys(record).some(key => !allowed.has(key))) {
		throw new TypeError(`${label} contains unsupported or missing properties.`);
	}
}

function requireString(value: unknown, label: string, allowEmpty = false): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLegacyStringLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`${label} must be a boolean.`);
	}
	return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
	const result = requireNonNegativeInteger(value, label);
	if (result === 0) {
		throw new TypeError(`${label} must be positive.`);
	}
	return result;
}

function protocolValue(value: unknown, label: string): AgentHostProtocolValue {
	try {
		assertAgentHostProtocolValue(value);
	} catch (error) {
		throw new TypeError(`${label} is not a protocol value.`, { cause: error });
	}
	return value as AgentHostProtocolValue;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function parseLegacyUri(value: unknown, label: string): URI {
	const components = requireRecord(value, label);
	requireKeys(
		components,
		['scheme', 'authority', 'path', 'query', 'fragment'],
		[],
		label,
	);
	return URI.from({
		scheme: requireString(components.scheme, `${label}.scheme`),
		authority: requireString(components.authority, `${label}.authority`, true),
		path: requireString(components.path, `${label}.path`, true),
		query: requireString(components.query, `${label}.query`, true),
		fragment: requireString(components.fragment, `${label}.fragment`, true),
	}, true);
}

function parseLegacyStableEdit(value: unknown, label: string): AgentHostProtocolValue {
	const edit = requireRecord(value, label);
	const commonRequired = ['kind', 'blockId', 'text'];
	const kind = requireString(edit.kind, `${label}.kind`);
	const blockId = requireString(edit.blockId, `${label}.blockId`);
	const expectedText = Object.hasOwn(edit, 'expectedText')
		? requireString(edit.expectedText, `${label}.expectedText`, true)
		: null;
	const text = requireString(edit.text, `${label}.text`, true);
	const common = { kind, blockId, expectedText, text };
	switch (kind) {
		case 'replaceBlock':
			requireKeys(edit, commonRequired, ['expectedText'], label);
			return protocolValue(common, label);
		case 'replaceRange': {
			requireKeys(edit, [...commonRequired, 'from', 'to'], ['expectedText'], label);
			const from = requireNonNegativeInteger(edit.from, `${label}.from`);
			const to = requireNonNegativeInteger(edit.to, `${label}.to`);
			if (to < from) {
				throw new TypeError(`${label} has a reversed range.`);
			}
			return protocolValue({ ...common, from, to }, label);
		}
		case 'replaceLine':
			requireKeys(edit, [...commonRequired, 'line'], ['expectedText'], label);
			return protocolValue({
				...common,
				line: requirePositiveInteger(edit.line, `${label}.line`),
			}, label);
		case 'replaceLineRange': {
			requireKeys(
				edit,
				[...commonRequired, 'line', 'fromColumn', 'toColumn'],
				['expectedText'],
				label,
			);
			const fromColumn = requirePositiveInteger(edit.fromColumn, `${label}.fromColumn`);
			const toColumn = requirePositiveInteger(edit.toColumn, `${label}.toColumn`);
			if (toColumn < fromColumn) {
				throw new TypeError(`${label} has reversed columns.`);
			}
			return protocolValue({
				...common,
				line: requirePositiveInteger(edit.line, `${label}.line`),
				fromColumn,
				toColumn,
			}, label);
		}
		case 'replaceMatch':
			requireKeys(edit, [...commonRequired, 'match'], ['expectedText', 'occurrence'], label);
			return protocolValue({
				...common,
				match: requireString(edit.match, `${label}.match`),
				occurrence: Object.hasOwn(edit, 'occurrence')
					? requirePositiveInteger(edit.occurrence, `${label}.occurrence`)
					: 1,
			}, label);
		default:
			throw new TypeError(`${label}.kind is unsupported.`);
	}
}

function parseLegacyPatchOperation(value: unknown, index: number): AgentHostProtocolValue {
	const label = `Legacy patch operation ${index}`;
	const operation = requireRecord(value, label);
	switch (operation.kind) {
		case 'text-edit':
			requireKeys(operation, ['kind', 'edit'], [], label);
			return protocolValue({
				kind: 'text-edit',
				edit: parseLegacyStableEdit(operation.edit, `${label}.edit`),
			}, label);
		case 'insert-citation': {
			requireKeys(operation, ['kind', 'anchorBlockId', 'citationIds'], [], label);
			if (!Array.isArray(operation.citationIds)
				|| operation.citationIds.length === 0
				|| operation.citationIds.length > 1_000) {
				throw new TypeError(`${label}.citationIds must be a bounded non-empty array.`);
			}
			const citationIds = operation.citationIds.map((id, citationIndex) =>
				requireString(id, `${label}.citationIds.${citationIndex}`),
			);
			if (new Set(citationIds).size !== citationIds.length) {
				throw new TypeError(`${label}.citationIds contains duplicates.`);
			}
			return protocolValue({
				kind: 'insert-citation',
				anchorBlockId: requireString(operation.anchorBlockId, `${label}.anchorBlockId`),
				citationIds,
			}, label);
		}
		case 'insert-figure-ref':
			requireKeys(operation, ['kind', 'anchorBlockId', 'figureId'], [], label);
			return protocolValue({
				kind: 'insert-figure-ref',
				anchorBlockId: requireString(operation.anchorBlockId, `${label}.anchorBlockId`),
				figureId: requireString(operation.figureId, `${label}.figureId`),
			}, label);
		default:
			throw new TypeError(`${label}.kind is unsupported.`);
	}
}

function parseLegacyPatch(value: unknown): AgentHostProtocolValue {
	const patch = requireRecord(value, 'Legacy patch');
	requireKeys(patch, ['label', 'operations'], ['summary'], 'Legacy patch');
	if (!Array.isArray(patch.operations)
		|| patch.operations.length === 0
		|| patch.operations.length > 1_000) {
		throw new TypeError('Legacy patch operations must be a bounded non-empty array.');
	}
	return protocolValue({
		label: requireString(patch.label, 'Legacy patch label'),
		summary: Object.hasOwn(patch, 'summary')
			? requireString(patch.summary, 'Legacy patch summary', true)
			: null,
		operations: patch.operations.map(parseLegacyPatchOperation),
	}, 'Legacy patch');
}

async function parseLegacyPatchProposal(
	value: unknown,
	connection: ReturnType<typeof createAgentHostClientConnectionId>,
): Promise<{
	readonly target: IAgentHostInteractionTarget;
	readonly patchInput: AgentHostProtocolValue;
	readonly proposal: IDraftEditorPatchProposal;
	readonly proposalValue: AgentHostProtocolValue;
	readonly applyState: DraftEditorPatchApplyState;
}> {
	const raw = requireRecord(value, 'Legacy patch proposal');
	requireKeys(raw, [
		'patch', 'accepted', 'operationsValidated', 'failedOperationIndex',
		'requiresCustomExecutor', 'validationError', 'target', 'isApplied', 'applyError',
	], [], 'Legacy patch proposal');
	const patchInput = parseLegacyPatch(raw.patch);
	const operationsValidated = requireNonNegativeInteger(
		raw.operationsValidated,
		'Legacy patch operationsValidated',
	);
	const failedOperationIndex = raw.failedOperationIndex === null
		? null
		: requireNonNegativeInteger(raw.failedOperationIndex, 'Legacy patch failedOperationIndex');
	const validationError = raw.validationError === null
		? null
		: requireString(raw.validationError, 'Legacy patch validationError');
	const proposalValue = protocolValue({
		patch: patchInput,
		accepted: requireBoolean(raw.accepted, 'Legacy patch accepted'),
		operationsValidated,
		failedOperationIndex,
		requiresCustomExecutor: requireBoolean(
			raw.requiresCustomExecutor,
			'Legacy patch requiresCustomExecutor',
		),
		validationError,
	}, 'Legacy patch proposal');
	const proposal = parseDraftEditorPatchProposal(proposalValue);
	if (operationsValidated > proposal.patch.operations.length
		|| (failedOperationIndex !== null && failedOperationIndex >= proposal.patch.operations.length)) {
		throw new TypeError('Legacy patch validation progress is inconsistent.');
	}
	const rawTarget = requireRecord(raw.target, 'Legacy patch target');
	requireKeys(rawTarget, ['resource', 'document'], [], 'Legacy patch target');
	const legacyResource = parseLegacyUri(rawTarget.resource, 'Legacy patch target resource');
	if (legacyResource.scheme !== 'draft') {
		throw new TypeError('Legacy patch target resource does not use the legacy Draft scheme.');
	}
	const resource = legacyResource.with({ scheme: DraftEditorInputScheme });
	const document: WritingEditorDocument = parseWritingEditorDocument(rawTarget.document);
	const target = await createDraftEditorInteractionTarget({
		resource,
		name: resource.toString(true),
		document,
	}, connection);
	const isApplied = requireBoolean(raw.isApplied, 'Legacy patch applied state');
	const applyError = raw.applyError === null
		? null
		: requireString(raw.applyError, 'Legacy patch apply error');
	if (isApplied && applyError !== null) {
		throw new TypeError('Legacy patch cannot be applied and failed simultaneously.');
	}
	const applyState: DraftEditorPatchApplyState = isApplied
		? Object.freeze({ kind: 'applied' })
		: applyError === null
			? Object.freeze({ kind: 'pending' })
			: Object.freeze({
				kind: 'applyFailed',
				code: 'persistedApplyFailure',
				message: applyError,
			});
	return Object.freeze({ target, patchInput, proposal, proposalValue, applyState });
}

function parseLegacyTurnPresentation(
	chat: IAgentHostLegacyChatPresentationSource,
	message: IAgentHostLegacyChatPresentationSource['assistantMessages'][number],
): IChatHostPresentation | undefined {
	const raw = requireRecord(message.value, `Legacy assistant message '${message.id}'`);
	requireKeys(
		raw,
		['id', 'role', 'content', 'imageAttachments'],
		['includeInAgentHistory', 'articleList', 'result', 'patchProposal'],
		`Legacy assistant message '${message.id}'`,
	);
	if (raw.id !== message.id || raw.role !== 'assistant') {
		throw new TypeError(`Legacy assistant presentation '${message.id}' has conflicting identity.`);
	}
	let articleIds: readonly string[] | undefined;
	if (Object.hasOwn(raw, 'articleList') && raw.articleList !== null) {
		const articleList = requireRecord(raw.articleList, `Legacy Article list '${message.id}'`);
		requireKeys(articleList, ['articleIds'], [], `Legacy Article list '${message.id}'`);
		if (!Array.isArray(articleList.articleIds) || articleList.articleIds.length > 4_096) {
			throw new TypeError(`Legacy Article list '${message.id}' is invalid.`);
		}
		articleIds = Object.freeze(articleList.articleIds.map((id, index) =>
			requireString(id, `Legacy Article list '${message.id}' ID ${index}`),
		));
	}
	const hasResult = Object.hasOwn(raw, 'result') && raw.result !== null;
	if (articleIds === undefined && !hasResult) {
		return undefined;
	}
	return parseChatHostPresentation({
		schemaVersion: ChatHostPresentationSchemaVersion,
		session: chat.session,
		chat: chat.chat,
		turn: message.turn,
		responsePartIndex: message.responsePartIndex,
		type: ArticleHistoryChatPresentationType,
		value: protocolValue(createArticleHistoryChatPresentation(
			articleIds ?? [],
			hasResult ? raw.result : null,
		), `Legacy Article presentation '${message.id}'`),
	});
}

function exactProtocolValue(left: unknown, right: unknown): boolean {
	return encodeAgentHostProtocolValue(protocolValue(left, 'Protocol comparison value'))
		=== encodeAgentHostProtocolValue(protocolValue(right, 'Protocol comparison value'));
}

/** Owns the Workbench half of the exact legacy v3 startup migration. */
export class LegacyChatMigrationCompanion implements IAgentHostLegacyCatalogMigrationCompanion {
	private readonly store: ApplicationStorageChatPersistenceStore;

	constructor(
		storage: IStorage,
		private readonly authority: AgentHostAuthorityId,
	) {
		this.store = new ApplicationStorageChatPersistenceStore(storage);
	}

	async prepare(request: {
		readonly migrationId: string;
		readonly sourceDigest: AgentHostPayloadDigest;
		readonly chats: readonly IAgentHostLegacyChatPresentationSource[];
	}): Promise<readonly IAgentHostLegacyTurnEnrichment[]> {
		const prepared = await this.prepareChats(request.sourceDigest, request.chats);
		const groups = new Map<string, {
			readonly source: IAgentHostLegacyChatPresentationSource;
			readonly turn: IPreparedLegacyPatch['turn'];
			readonly targets: Map<string, IAgentHostInteractionTarget>;
			readonly response: AgentTurnResponsePart[];
		}>();
		for (const chat of prepared) {
			for (const patch of chat.patches) {
				const key = `${chat.source.session}\0${chat.source.chat}\0${patch.turn}`;
				let group = groups.get(key);
				if (!group) {
					group = {
						source: chat.source,
						turn: patch.turn,
						targets: new Map(),
						response: [],
					};
					groups.set(key, group);
				}
				const currentTarget = group.targets.get(patch.target.id);
				if (currentTarget && !exactProtocolValue(currentTarget, patch.target)) {
					throw new Error(`Legacy patch target '${patch.target.id}' conflicts within one Host Turn.`);
				}
				group.targets.set(patch.target.id, patch.target);
				group.response.push(patch.toolCall, patch.toolResult);
			}
		}
		return Object.freeze([...groups.values()].map(group => Object.freeze({
			session: group.source.session,
			chat: group.source.chat,
			turn: group.turn,
			interactionTargets: Object.freeze([...group.targets.values()]),
			response: Object.freeze(group.response.map(part => {
				if (part.kind !== 'toolCall' && part.kind !== 'toolResult') {
					throw new Error('Legacy patch preparation emitted a non-Tool response.');
				}
				return part;
			})),
		})));
	}

	async commit(request: {
		readonly migrationId: string;
		readonly sourceDigest: AgentHostPayloadDigest;
		readonly chats: readonly IAgentHostLegacyChatPresentationSource[];
		readonly catalog: IAgentHostPersistedCatalog;
	}): Promise<void> {
		const prepared = await this.prepareChats(request.sourceDigest, request.chats);
		const records = prepared.map(chat => this.createPersistedChatRecord(chat, request.catalog));
		const existing = await this.store.read();
		const completed = existing?.completedMigrations.find(migration => migration.id === request.migrationId);
		if (completed && existing) {
			if (completed.sourceDigest !== request.sourceDigest) {
				throw new Error('Chat persistence conflicts with the legacy Sessions source.');
			}
			for (const record of records) {
				const stored = existing.chats.find(candidate => candidate.resource === record.resource);
				if (!stored || !exactProtocolValue(stored, record)) {
					throw new Error(`Chat persistence conflicts with migrated resource '${record.resource}'.`);
				}
			}
			return;
		}
		const resources = new Set(existing?.chats.map(chat => chat.resource) ?? []);
		for (const record of records) {
			if (resources.has(record.resource)) {
				throw new Error(`Chat persistence already contains migrated resource '${record.resource}'.`);
			}
			resources.add(record.resource);
		}
		if (existing?.revision === Number.MAX_SAFE_INTEGER) {
			throw new RangeError('Chat persistence revision cannot advance further.');
		}
		const state: IChatPersistedState = Object.freeze({
			schemaVersion: ChatPersistenceSchemaVersion,
			revision: existing === undefined ? 0 : existing.revision + 1,
			chats: Object.freeze([...(existing?.chats ?? []), ...records]),
			completedMigrations: Object.freeze([
				...(existing?.completedMigrations ?? []),
				Object.freeze({ id: request.migrationId, sourceDigest: request.sourceDigest }),
			]),
		});
		await this.store.commit(existing?.revision, state);
	}

	async readCompletedMigration(migrationId: string): Promise<AgentHostPayloadDigest | undefined> {
		return (await this.store.read())?.completedMigrations.find(
			migration => migration.id === migrationId,
		)?.sourceDigest;
	}

	private async prepareChats(
		sourceDigest: AgentHostPayloadDigest,
		chats: readonly IAgentHostLegacyChatPresentationSource[],
	): Promise<readonly IPreparedLegacyChat[]> {
		const connection = createAgentHostClientConnectionId(
			`migration:${sourceDigest.slice('sha256:'.length)}`,
		);
		const result: IPreparedLegacyChat[] = [];
		for (const chat of chats) {
			const presentations: IChatHostPresentation[] = [];
			const patches: IPreparedLegacyPatch[] = [];
			for (const message of chat.assistantMessages) {
				const turnPresentation = parseLegacyTurnPresentation(chat, message);
				if (turnPresentation) {
					presentations.push(turnPresentation);
				}
				const raw = requireRecord(message.value, `Legacy assistant message '${message.id}'`);
				if (!Object.hasOwn(raw, 'patchProposal') || raw.patchProposal === null) {
					continue;
				}
				const parsed = await parseLegacyPatchProposal(raw.patchProposal, connection);
				const call = createAgentToolCallId(`migration:${sha256(encodeAgentHostProtocolValue({
					sourceDigest,
					chat: chat.chat,
					turn: message.turn,
					message: message.id,
					patch: parsed.patchInput,
				}))}`);
				const toolCall = Object.freeze({
					kind: 'toolCall' as const,
					call,
					tool: DraftEditorProposeEditorPatchToolId,
					input: parsed.patchInput,
				});
				const toolResult = Object.freeze({
					kind: 'toolResult' as const,
					call,
					status: 'completed' as const,
					output: protocolValue({
						target: parsed.target,
						proposal: parsed.proposalValue,
					}, 'Legacy patch Tool output'),
				});
				patches.push(Object.freeze({
					turn: message.turn,
					call,
					target: parsed.target,
					proposal: parsed.proposal,
					applyState: parsed.applyState,
					toolCall,
					toolResult,
				}));
			}
			result.push(Object.freeze({
				source: chat,
				presentations: Object.freeze(presentations),
				patches: Object.freeze(patches),
			}));
		}
		return Object.freeze(result);
	}

	private createPersistedChatRecord(
		prepared: IPreparedLegacyChat,
		catalog: IAgentHostPersistedCatalog,
	): IChatPersistedResourceState {
		const sessionMatches = catalog.sessions.filter(record => record.state.id === prepared.source.session);
		if (sessionMatches.length !== 1) {
			throw new Error(`Migrated Host Session '${prepared.source.session}' is unavailable.`);
		}
		const chatMatches = sessionMatches[0]!.chats.filter(
			record => record.state.id === prepared.source.chat,
		);
		if (chatMatches.length !== 1) {
			throw new Error(`Migrated Host Chat '${prepared.source.chat}' is unavailable.`);
		}
		const hostState: IAgentHostChatState = chatMatches[0]!.state;
		for (const presentation of prepared.presentations) {
			if (presentation.session !== prepared.source.session
				|| presentation.chat !== prepared.source.chat) {
				throw new Error('Migrated Host Turn presentation has a conflicting Chat identity.');
			}
			const turnMatches = hostState.turns.filter(turn => turn.id === presentation.turn);
			const sourceMatches = prepared.source.assistantMessages.filter(message =>
				message.turn === presentation.turn
				&& message.responsePartIndex === presentation.responsePartIndex,
			);
			if (turnMatches.length !== 1 || sourceMatches.length !== 1) {
				throw new Error(`Migrated Host Turn '${presentation.turn}' is unavailable.`);
			}
			const part = turnMatches[0]!.response[presentation.responsePartIndex];
			const raw = requireRecord(
				sourceMatches[0]!.value,
				`Legacy assistant message '${sourceMatches[0]!.id}'`,
			);
			if (part?.kind !== 'text' || part.text !== raw.content) {
				throw new Error(
					`Migrated Host response part '${presentation.responsePartIndex}' conflicts.`,
				);
			}
		}
		const presentations: IChatHostPresentation[] = [...prepared.presentations];
		for (const patch of prepared.patches) {
			const turnMatches = hostState.turns.filter(turn => turn.id === patch.turn);
			if (turnMatches.length !== 1) {
				throw new Error(`Migrated Host patch Turn '${patch.turn}' is unavailable.`);
			}
			const turn = turnMatches[0]!;
			const callMatches = turn.response.filter(part =>
				part.kind === 'toolCall' && part.call === patch.call,
			);
			const resultMatches = turn.response.filter(part =>
				part.kind === 'toolResult' && part.call === patch.call,
			);
			if (callMatches.length !== 1
				|| resultMatches.length !== 1
				|| !exactProtocolValue(callMatches[0], patch.toolCall)
				|| !exactProtocolValue(resultMatches[0], patch.toolResult)
				|| turn.user.interactionTargets.filter(target =>
					exactProtocolValue(target, patch.target),
				).length !== 1) {
				throw new Error(`Migrated Host patch Tool history '${patch.call}' conflicts.`);
			}
			const responsePartIndex = turn.response.findIndex(part =>
				part.kind === 'toolResult' && part.call === patch.call,
			);
			if (responsePartIndex < 0) {
				throw new Error(`Migrated Host patch Tool result '${patch.call}' is unavailable.`);
			}
			presentations.push(parseChatHostPresentation({
				schemaVersion: ChatHostPresentationSchemaVersion,
				session: prepared.source.session,
				chat: prepared.source.chat,
				turn: patch.turn,
				responsePartIndex,
				type: DraftEditorPatchPresentationType,
				value: createDraftEditorPatchPresentationValue(
					patch.target,
					patch.proposal,
					patch.applyState,
				),
			}));
		}
		return parseChatPersistedResourceState({
			resource: createAgentHostChatResource(
				this.authority,
				prepared.source.session,
				prepared.source.chat,
			).toString(true),
			composer: {
				input: prepared.source.input,
				revision: 0,
				attachments: [],
				interactionTargets: [],
			},
			presentations,
		});
	}
}
