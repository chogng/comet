/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEditorPatch, AgentEditorPatchOperation } from 'cs/agent/common/editorTools';
import type {
	LlmProviderId,
	RagAnswerResult,
	RagProviderId,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { URI, type UriComponents } from 'cs/base/common/uri';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { writingEditorSchema } from 'cs/editor/browser/text/schema';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import { createDefaultSessionResource } from 'cs/sessions/contrib/providers/default/browser/defaultSessionResources';
import {
	SessionStatus,
	SessionWorkspaceKind,
	type ISessionRepository,
	type ISessionResolvedWorkspaceState,
} from 'cs/sessions/services/sessions/common/session';
import {
	isSerializedJsonLargerThan,
	isUtf8StringLargerThan,
} from 'cs/sessions/services/sessions/common/serializedSize';
import type {
	ChatMessage,
	IChatModelInitialState,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { parseChatImageAttachments } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

const DefaultSessionsStorageKey = 'sessions.providers.default';
const DefaultSessionsStorageVersion = 3;
const MaximumDefaultSessionsStorageBytes = 32 * 1024 * 1024;
const MaximumStoredSessions = 4_096;
const MaximumStoredMessagesPerSession = 16_384;
const MaximumStoredArticleIdsPerMessage = 4_096;
const MaximumStoredEvidenceItems = 4_096;
const MaximumStoredPatchOperations = 4_096;
const MaximumStoredCitationIdsPerOperation = 4_096;
const MaximumStoredWorkspaceFolders = 1_024;
const MaximumStoredStringLength = 16 * 1024 * 1024;

export interface IDefaultPersistedSession {
	readonly conversationId: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly sessionTitle: string;
	readonly chatTitle: string;
	readonly status: SessionStatus.Completed | SessionStatus.Failed;
	readonly workspace: ISessionResolvedWorkspaceState;
	readonly modelId: string | undefined;
	readonly chatState: Required<Pick<IChatModelInitialState, 'input' | 'messages'>> & {
		readonly errorMessage: string | undefined;
	};
}

interface IStoredDefaultSessions {
	readonly version: typeof DefaultSessionsStorageVersion;
	readonly sessions: readonly unknown[];
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, allowed: readonly string[], name: string): void {
	const allowedKeys = new Set(allowed);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			throw new Error(`Stored default Sessions state has an unknown ${name} field '${key}'.`);
		}
	}
}

function requireString(value: unknown, name: string, allowEmpty = false): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && !value)
		|| value.length > MaximumStoredStringLength) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return value;
}

function requireOptionalString(value: unknown, name: string): string | undefined {
	return value === undefined ? undefined : requireString(value, name, true);
}

function requireTrimmedString(value: unknown, name: string): string {
	const text = requireString(value, name);
	if (text !== text.trim()) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return text;
}

function requireConversationId(value: unknown): string {
	const conversationId = requireString(value, 'conversation ID');
	try {
		createDefaultSessionResource(conversationId);
	} catch {
		throw new Error('Stored default Sessions state has an invalid conversation ID.');
	}
	return conversationId;
}

function requireNullableString(value: unknown, name: string): string | null {
	return value === null ? null : requireString(value, name, true);
}

function requireBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return value;
}

function requireFiniteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return value as number;
}

function requirePositiveInteger(value: unknown, name: string): number {
	const integer = requireNonNegativeInteger(value, name);
	if (integer === 0) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return integer;
}

function requireRagProviderId(value: unknown): RagProviderId {
	if (value !== 'moark') {
		throw new Error('Stored default Sessions state has an invalid RAG provider.');
	}
	return value;
}

function requireLlmProviderId(value: unknown): LlmProviderId {
	switch (value) {
		case 'glm':
		case 'kimi':
		case 'deepseek':
		case 'anthropic':
		case 'openai':
		case 'gemini':
		case 'custom':
			return value;
		default:
			throw new Error('Stored default Sessions state has an invalid RAG LLM provider.');
	}
}

function requireDate(value: unknown, name: string): Date {
	const serialized = requireString(value, name);
	const date = new Date(serialized);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== serialized) {
		throw new Error(`Stored default Sessions state has an invalid ${name}.`);
	}
	return date;
}

function toStoredUri(resource: URI): UriComponents {
	return {
		scheme: resource.scheme,
		authority: resource.authority,
		path: resource.path,
		query: resource.query,
		fragment: resource.fragment,
	};
}

function parseUri(value: unknown, name: string): URI {
	const stored = requireRecord(value, name);
	requireExactKeys(stored, ['scheme', 'authority', 'path', 'query', 'fragment'], name);
	const scheme = requireString(stored.scheme, `${name} scheme`);
	const authority = requireString(stored.authority, `${name} authority`, true);
	const path = requireString(stored.path, `${name} path`, true);
	const query = requireString(stored.query, `${name} query`, true);
	const fragment = requireString(stored.fragment, `${name} fragment`, true);
	return URI.from({ scheme, authority, path, query, fragment }, true);
}

function freezeStructuredValue<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
		return value;
	}
	for (const child of Object.values(value)) {
		freezeStructuredValue(child);
	}
	return Object.freeze(value);
}

function parseWritingDocument(value: unknown): WritingEditorDocument {
	try {
		return writingEditorSchema.nodeFromJSON(value).toJSON() as WritingEditorDocument;
	} catch {
		throw new Error('Stored default Sessions state has an invalid patch target document.');
	}
}

function parseTextEdit(value: unknown): Extract<AgentEditorPatchOperation, { kind: 'text-edit' }>['edit'] {
	const edit = requireRecord(value, 'text-edit target');
	const commonKeys = ['kind', 'blockId', 'expectedText', 'text'];
	const kind = requireString(edit.kind, 'text-edit kind');
	const blockId = requireString(edit.blockId, 'text-edit block ID');
	const expectedText = requireOptionalString(edit.expectedText, 'text-edit expected text');
	const text = requireString(edit.text, 'text-edit text', true);
	switch (kind) {
		case 'replaceBlock':
			requireExactKeys(edit, commonKeys, 'replace-block edit');
			return { kind, blockId, expectedText, text };
		case 'replaceRange':
			requireExactKeys(edit, [...commonKeys, 'from', 'to'], 'replace-range edit');
			const from = requireNonNegativeInteger(edit.from, 'replace-range start');
			const to = requireNonNegativeInteger(edit.to, 'replace-range end');
			if (to < from) {
				throw new Error('Stored default Sessions state has a reversed replace-range edit.');
			}
			return {
				kind,
				blockId,
				expectedText,
				from,
				to,
				text,
			};
		case 'replaceLine':
			requireExactKeys(edit, [...commonKeys, 'line'], 'replace-line edit');
			return {
				kind,
				blockId,
				expectedText,
				line: requirePositiveInteger(edit.line, 'replace-line number'),
				text,
			};
		case 'replaceLineRange':
			requireExactKeys(edit, [...commonKeys, 'line', 'fromColumn', 'toColumn'], 'replace-line-range edit');
			const line = requirePositiveInteger(edit.line, 'replace-line-range line');
			const fromColumn = requirePositiveInteger(edit.fromColumn, 'replace-line-range start column');
			const toColumn = requirePositiveInteger(edit.toColumn, 'replace-line-range end column');
			if (toColumn < fromColumn) {
				throw new Error('Stored default Sessions state has a reversed replace-line-range edit.');
			}
			return {
				kind,
				blockId,
				expectedText,
				line,
				fromColumn,
				toColumn,
				text,
			};
		case 'replaceMatch':
			requireExactKeys(edit, [...commonKeys, 'match', 'occurrence'], 'replace-match edit');
			return {
				kind,
				blockId,
				expectedText,
				match: requireString(edit.match, 'replace-match value'),
				occurrence: edit.occurrence === undefined
					? undefined
					: requirePositiveInteger(edit.occurrence, 'replace-match occurrence'),
				text,
			};
		default:
			throw new Error(`Stored default Sessions state has an unknown text-edit kind '${kind}'.`);
	}
}

function parsePatchOperation(value: unknown): AgentEditorPatchOperation {
	const operation = requireRecord(value, 'patch operation');
	const kind = requireString(operation.kind, 'patch operation kind');
	switch (kind) {
		case 'text-edit':
			requireExactKeys(operation, ['kind', 'edit'], 'text-edit operation');
			return { kind, edit: parseTextEdit(operation.edit) };
		case 'insert-citation':
			requireExactKeys(operation, ['kind', 'anchorBlockId', 'citationIds'], 'insert-citation operation');
			if (!Array.isArray(operation.citationIds)
				|| operation.citationIds.length > MaximumStoredCitationIdsPerOperation) {
				throw new Error('Stored default Sessions state has invalid citation IDs.');
			}
			const citationIds = operation.citationIds.map(id => requireString(id, 'citation ID'));
			if (new Set(citationIds).size !== citationIds.length) {
				throw new Error('Stored default Sessions state has duplicate citation IDs.');
			}
			return {
				kind,
				anchorBlockId: requireString(operation.anchorBlockId, 'citation anchor block ID'),
				citationIds,
			};
		case 'insert-figure-ref':
			requireExactKeys(operation, ['kind', 'anchorBlockId', 'figureId'], 'insert-figure-ref operation');
			return {
				kind,
				anchorBlockId: requireString(operation.anchorBlockId, 'figure anchor block ID'),
				figureId: requireString(operation.figureId, 'figure ID'),
			};
		default:
			throw new Error(`Stored default Sessions state has an unknown patch operation '${kind}'.`);
	}
}

function parsePatch(value: unknown): AgentEditorPatch {
	const patch = requireRecord(value, 'editor patch');
	requireExactKeys(patch, ['label', 'summary', 'operations'], 'editor patch');
	if (!Array.isArray(patch.operations)
		|| patch.operations.length === 0
		|| patch.operations.length > MaximumStoredPatchOperations) {
		throw new Error('Stored default Sessions state has invalid patch operations.');
	}
	return {
		label: requireString(patch.label, 'patch label'),
		summary: requireOptionalString(patch.summary, 'patch summary'),
		operations: patch.operations.map(parsePatchOperation),
	};
}

function parseEvidence(value: unknown): RagAnswerResult['evidence'][number] {
	const evidence = requireRecord(value, 'evidence item');
	requireExactKeys(evidence, [
		'rank', 'title', 'journalTitle', 'publishedAt', 'sourceUrl', 'score', 'excerpt',
	], 'evidence item');
	return {
		rank: requirePositiveInteger(evidence.rank, 'evidence rank'),
		title: requireString(evidence.title, 'evidence title', true),
		journalTitle: requireNullableString(evidence.journalTitle, 'evidence journal title'),
		publishedAt: requireNullableString(evidence.publishedAt, 'evidence publication time'),
		sourceUrl: requireString(evidence.sourceUrl, 'evidence source URL'),
		score: evidence.score === null ? null : requireFiniteNumber(evidence.score, 'evidence score'),
		excerpt: requireString(evidence.excerpt, 'evidence excerpt', true),
	};
}

function parseResult(value: unknown): RagAnswerResult {
	const result = requireRecord(value, 'RAG result');
	requireExactKeys(result, [
		'answer', 'evidence', 'provider', 'llmProvider', 'llmModel',
		'embeddingModel', 'rerankerModel', 'rerankApplied',
	], 'RAG result');
	if (!Array.isArray(result.evidence) || result.evidence.length > MaximumStoredEvidenceItems) {
		throw new Error('Stored default Sessions state has invalid RAG evidence.');
	}
	return {
		answer: requireString(result.answer, 'RAG answer', true),
		evidence: result.evidence.map(parseEvidence),
		provider: requireRagProviderId(result.provider),
		llmProvider: requireLlmProviderId(result.llmProvider),
		llmModel: requireString(result.llmModel, 'RAG LLM model'),
		embeddingModel: requireString(result.embeddingModel, 'RAG embedding model'),
		rerankerModel: requireString(result.rerankerModel, 'RAG reranker model'),
		rerankApplied: requireBoolean(result.rerankApplied, 'RAG rerank state'),
	};
}

function parsePatchProposal(value: unknown): Extract<ChatMessage, { role: 'assistant' }>['patchProposal'] {
	if (value === null) {
		return null;
	}
	const proposal = requireRecord(value, 'patch proposal');
	requireExactKeys(proposal, [
		'patch', 'accepted', 'operationsValidated', 'failedOperationIndex',
		'requiresCustomExecutor', 'validationError', 'target', 'isApplied', 'applyError',
	], 'patch proposal');
	const target = requireRecord(proposal.target, 'patch target');
	requireExactKeys(target, ['resource', 'document'], 'patch target');
	const patch = parsePatch(proposal.patch);
	const operationsValidated = requireNonNegativeInteger(
		proposal.operationsValidated,
		'validated patch-operation count',
	);
	const failedOperationIndex = proposal.failedOperationIndex === null
		? null
		: requireNonNegativeInteger(proposal.failedOperationIndex, 'failed patch-operation index');
	if (operationsValidated > patch.operations.length
		|| (failedOperationIndex !== null && failedOperationIndex >= patch.operations.length)) {
		throw new Error('Stored default Sessions state has inconsistent patch validation progress.');
	}
	return {
		patch,
		accepted: requireBoolean(proposal.accepted, 'patch acceptance'),
		operationsValidated,
		failedOperationIndex,
		requiresCustomExecutor: requireBoolean(proposal.requiresCustomExecutor, 'custom-executor requirement'),
		validationError: requireNullableString(proposal.validationError, 'patch validation error'),
		target: {
			resource: parseUri(target.resource, 'patch target resource'),
			document: parseWritingDocument(target.document),
		},
		isApplied: requireBoolean(proposal.isApplied, 'patch applied state'),
		applyError: requireNullableString(proposal.applyError, 'patch apply error'),
	};
}

function parseMessage(value: unknown): ChatMessage {
	const message = requireRecord(value, 'Chat message');
	const role = requireString(message.role, 'Chat message role');
	const commonKeys = ['id', 'role', 'content', 'imageAttachments', 'includeInAgentHistory'];
	const base = {
		id: requireString(message.id, 'Chat message ID'),
		content: requireString(message.content, 'Chat message content', true),
		imageAttachments: parseChatImageAttachments(message.imageAttachments),
		includeInAgentHistory: message.includeInAgentHistory === undefined
			? undefined
			: requireBoolean(message.includeInAgentHistory, 'Chat history inclusion state'),
	};
	if (role === 'user') {
		requireExactKeys(message, commonKeys, 'user Chat message');
		return { role, ...base };
	}
	if (role !== 'assistant') {
		throw new Error(`Stored default Sessions state has an unknown Chat message role '${role}'.`);
	}
	requireExactKeys(message, [...commonKeys, 'articleList', 'result', 'patchProposal'], 'assistant Chat message');
	let articleList: Extract<ChatMessage, { role: 'assistant' }>['articleList'];
	if (message.articleList !== undefined) {
		const storedArticleList = requireRecord(message.articleList, 'Article list');
		requireExactKeys(storedArticleList, ['articleIds'], 'Article list');
		if (!Array.isArray(storedArticleList.articleIds)
			|| storedArticleList.articleIds.length > MaximumStoredArticleIdsPerMessage) {
			throw new Error('Stored default Sessions state has an invalid Article list.');
		}
		const articleIds = storedArticleList.articleIds.map(id => requireString(id, 'Article ID'));
		articleList = {
			articleIds,
		};
	}
	return {
		role,
		...base,
		articleList,
		result: message.result === undefined
			? undefined
			: message.result === null
				? null
				: parseResult(message.result),
		patchProposal: message.patchProposal === undefined
			? undefined
			: parsePatchProposal(message.patchProposal),
	};
}

function toStoredMessage(message: ChatMessage): unknown {
	if (message.role === 'user') {
		return {
			id: message.id,
			role: message.role,
			content: message.content,
			imageAttachments: message.imageAttachments.map(attachment => ({ ...attachment })),
			includeInAgentHistory: message.includeInAgentHistory,
		};
	}
	return {
		id: message.id,
		role: message.role,
		content: message.content,
		imageAttachments: message.imageAttachments.map(attachment => ({ ...attachment })),
		includeInAgentHistory: message.includeInAgentHistory,
		articleList: message.articleList
			? { articleIds: [...message.articleList.articleIds] }
			: undefined,
		result: message.result,
		patchProposal: message.patchProposal
			? {
				...message.patchProposal,
				patch: message.patchProposal.patch,
				target: {
					resource: toStoredUri(message.patchProposal.target.resource),
					document: message.patchProposal.target.document,
				},
			}
			: message.patchProposal,
	};
}

function toStoredWorkspace(workspace: ISessionResolvedWorkspaceState): unknown {
	if (workspace.kind === SessionWorkspaceKind.WorkspaceLess) {
		return { kind: workspace.kind };
	}
	return {
		kind: workspace.kind,
		workspace: {
			resource: toStoredUri(workspace.workspace.resource),
			label: workspace.workspace.label,
			folders: workspace.workspace.folders.map(folder => ({
				resource: toStoredUri(folder.resource),
				workingDirectory: toStoredUri(folder.workingDirectory),
				name: folder.name,
				repository: folder.repository
					? {
						root: toStoredUri(folder.repository.root),
						branch: folder.repository.branch ?? null,
						baseBranch: folder.repository.baseBranch ?? null,
					}
					: null,
			})),
		},
	};
}

function parseWorkspace(value: unknown): ISessionResolvedWorkspaceState {
	const state = requireRecord(value, 'workspace state');
	if (state.kind === SessionWorkspaceKind.WorkspaceLess) {
		requireExactKeys(state, ['kind'], 'workspace-less state');
		return Object.freeze({ kind: SessionWorkspaceKind.WorkspaceLess });
	}
	if (state.kind !== SessionWorkspaceKind.Workspace) {
		throw new Error('Stored default Sessions state has an unknown workspace state.');
	}
	requireExactKeys(state, ['kind', 'workspace'], 'workspace state');
	const workspace = requireRecord(state.workspace, 'workspace');
	requireExactKeys(workspace, ['resource', 'label', 'folders'], 'workspace');
	if (!Array.isArray(workspace.folders) || workspace.folders.length > MaximumStoredWorkspaceFolders) {
		throw new Error('Stored default Sessions state has invalid workspace folders.');
	}
	const folders = workspace.folders.map((value, index) => {
		const folder = requireRecord(value, `workspace folder ${index}`);
		requireExactKeys(folder, ['resource', 'workingDirectory', 'name', 'repository'], 'workspace folder');
		let repository: ISessionRepository | undefined;
		if (folder.repository === null) {
			repository = undefined;
		} else {
			const storedRepository = requireRecord(folder.repository, 'workspace repository');
			requireExactKeys(storedRepository, ['root', 'branch', 'baseBranch'], 'workspace repository');
			repository = {
				root: parseUri(storedRepository.root, 'repository root'),
				branch: requireNullableString(storedRepository.branch, 'repository branch') ?? undefined,
				baseBranch: requireNullableString(storedRepository.baseBranch, 'repository base branch') ?? undefined,
			};
		}
		return {
			resource: parseUri(folder.resource, 'workspace-folder resource'),
			workingDirectory: parseUri(folder.workingDirectory, 'workspace-folder working directory'),
			name: requireString(folder.name, 'workspace-folder name'),
			repository,
		};
	});
	return freezeStructuredValue({
		kind: SessionWorkspaceKind.Workspace,
		workspace: {
			resource: parseUri(workspace.resource, 'workspace resource'),
			label: requireString(workspace.label, 'workspace label'),
			folders,
		},
	});
}

function toStoredSession(session: IDefaultPersistedSession): unknown {
	return {
		conversationId: session.conversationId,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
		sessionTitle: session.sessionTitle,
		chatTitle: session.chatTitle,
		status: session.status,
		workspace: toStoredWorkspace(session.workspace),
		modelId: session.modelId ?? null,
		chatState: {
			input: session.chatState.input,
			messages: session.chatState.messages.map(toStoredMessage),
			errorMessage: session.chatState.errorMessage ?? null,
		},
	};
}

function parseSession(value: unknown): IDefaultPersistedSession {
	const session = requireRecord(value, 'Session');
	requireExactKeys(session, [
		'conversationId', 'createdAt', 'updatedAt', 'sessionTitle', 'chatTitle',
		'status', 'workspace', 'modelId', 'chatState',
	], 'Session');
	if (session.status !== SessionStatus.Completed && session.status !== SessionStatus.Failed) {
		throw new Error('Stored default Sessions state has a non-stable Session status.');
	}
	const chatState = requireRecord(session.chatState, 'Chat state');
	requireExactKeys(chatState, ['input', 'messages', 'errorMessage'], 'Chat state');
	if (!Array.isArray(chatState.messages) || chatState.messages.length > MaximumStoredMessagesPerSession) {
		throw new Error('Stored default Sessions state has an invalid Chat transcript.');
	}
	const messages = chatState.messages.map(parseMessage);
	const messageIds = messages.map(message => message.id);
	if (new Set(messageIds).size !== messageIds.length) {
		throw new Error('Stored default Sessions state contains duplicate Chat message IDs.');
	}
	const errorMessage = chatState.errorMessage === null
		? undefined
		: requireString(chatState.errorMessage, 'Chat error message');
	if (session.status === SessionStatus.Completed && errorMessage !== undefined) {
		throw new Error('Stored default Sessions state has an error on a completed Chat.');
	}
	const createdAt = requireDate(session.createdAt, 'Session creation time');
	const updatedAt = requireDate(session.updatedAt, 'Session activity time');
	if (updatedAt.getTime() < createdAt.getTime()) {
		throw new Error('Stored default Sessions state has activity before Session creation.');
	}
	return freezeStructuredValue({
		conversationId: requireConversationId(session.conversationId),
		createdAt,
		updatedAt,
		sessionTitle: requireTrimmedString(session.sessionTitle, 'Session title'),
		chatTitle: requireTrimmedString(session.chatTitle, 'Chat title'),
		status: session.status,
		workspace: parseWorkspace(session.workspace),
		modelId: session.modelId === null ? undefined : requireString(session.modelId, 'model ID'),
		chatState: {
			input: requireString(chatState.input, 'Chat input', true),
			messages,
			errorMessage,
		},
	});
}

function parseRoot(value: unknown): readonly IDefaultPersistedSession[] {
	const stored = requireRecord(value, 'root value');
	requireExactKeys(stored, ['version', 'sessions'], 'root');
	if (stored.version !== DefaultSessionsStorageVersion) {
		throw new Error('Stored default Sessions state has an unsupported version.');
	}
	if (!Array.isArray(stored.sessions) || stored.sessions.length > MaximumStoredSessions) {
		throw new Error('Stored default Sessions state has an invalid Session collection.');
	}
	const sessions = stored.sessions.map(parseSession);
	const conversationIds = sessions.map(session => session.conversationId);
	if (new Set(conversationIds).size !== conversationIds.length) {
		throw new Error('Stored default Sessions state contains duplicate conversation IDs.');
	}
	return Object.freeze(sessions);
}

/** Stores one all-or-nothing snapshot of committed default-provider Sessions. */
export class DefaultSessionsProviderStorage {
	constructor(private readonly storageService: IStorageService) {}

	load(): readonly IDefaultPersistedSession[] {
		const serialized = this.storageService.get(DefaultSessionsStorageKey, StorageScope.APPLICATION);
		if (serialized === undefined) {
			return Object.freeze([]);
		}
		if (isUtf8StringLargerThan(serialized, MaximumDefaultSessionsStorageBytes)) {
			throw new Error(`Stored default Sessions state exceeds ${MaximumDefaultSessionsStorageBytes} bytes.`);
		}
		let value: unknown;
		try {
			value = JSON.parse(serialized);
		} catch {
			throw new Error('Stored default Sessions state is not valid JSON.');
		}
		return parseRoot(value);
	}

	store(sessions: readonly IDefaultPersistedSession[]): readonly IDefaultPersistedSession[] {
		const stored: IStoredDefaultSessions = {
			version: DefaultSessionsStorageVersion,
			sessions: sessions.map(toStoredSession),
		};
		const normalized = parseRoot(stored);
		if (isSerializedJsonLargerThan(stored, MaximumDefaultSessionsStorageBytes)) {
			throw new Error(`Default Sessions state exceeds ${MaximumDefaultSessionsStorageBytes} bytes.`);
		}
		this.storageService.store(
			DefaultSessionsStorageKey,
			JSON.stringify(stored),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		return normalized;
	}
}
