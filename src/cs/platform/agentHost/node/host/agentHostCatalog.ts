/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { URI } from 'cs/base/common/uri';
import type {
	IAgentBackingIdentity,
	AgentTurnResponsePart,
	IAgentResumeState,
	IAgentWorkspace,
} from 'cs/platform/agentHost/common/agent';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostAttachment,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	AgentHostChannelRevision,
	AgentHostPayloadDigest,
	AgentHostOperationId,
	AgentHostSequence,
	AgentId,
	AgentPackageId,
	AgentResumeSchemaId,
	AgentSessionTypeId,
	type AgentChatId,
	type AgentSessionId,
	type AgentTurnId,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentId,
	createAgentChatId,
	createAgentContentDigest,
	createAgentContentVersion,
	createAgentHostChannelId,
	createAgentHostChannelRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostSequence,
	createAgentModelId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	IAgentHostChatState,
	IAgentHostOperationFailure,
	IAgentHostSessionState,
	IAgentHostTurn,
	assertAgentHostChatState,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
} from 'cs/platform/agentHost/common/protocol';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { CometModelMessage } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	COMET_AGENT_RESUME_SCHEMA,
	encodeCometChatResumeV1,
	encodeCometSessionResumeV1,
} from 'cs/platform/agentHost/node/agents/comet/cometResume';

const agentHostCatalogSchemaVersion = 1;
const legacySessionsStorageKey = 'sessions.providers.default';
const legacySessionsStorageVersion = 3;
const legacySessionsMigrationId = 'legacy-sessions-v3';
const maximumLegacyStorageBytes = 32 * 1024 * 1024;
const maximumLegacySessions = 4_096;
const maximumLegacyMessages = 16_384;
const maximumLegacyStringLength = 16 * 1024 * 1024;
const maximumLegacyImageBytes = 8 * 1024 * 1024;
const maximumLegacyImagesPerMessage = 8;
const maximumLegacyImagesBytesPerMessage = 12 * 1024 * 1024;

export interface IAgentHostPersistedChatRecord {
	readonly state: IAgentHostChatState;
	readonly resume?: IAgentResumeState;
}

export interface IAgentHostPersistedSessionRecord {
	readonly state: IAgentHostSessionState;
	readonly resume?: IAgentResumeState;
	readonly chats: readonly IAgentHostPersistedChatRecord[];
}

export interface IAgentHostCompletedMigration {
	readonly id: string;
	readonly sourceDigest: AgentHostPayloadDigest;
}

export interface IAgentHostBackingRemovalOperation {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly records: readonly IAgentBackingIdentity[];
}

export interface IAgentHostPersistedCatalog {
	readonly schemaVersion: typeof agentHostCatalogSchemaVersion;
	readonly revision: number;
	readonly packageCatalogRevision: number;
	readonly hostSequence: AgentHostSequence;
	readonly channelRevisions: Readonly<Record<string, AgentHostChannelRevision>>;
	readonly sessions: readonly IAgentHostPersistedSessionRecord[];
	readonly backingRemovalOperations: readonly IAgentHostBackingRemovalOperation[];
	readonly completedMigrations: readonly IAgentHostCompletedMigration[];
}

/** Persists one complete Host catalog under an exact revision precondition. */
export interface IAgentHostCatalogStore {
	read(): Promise<IAgentHostPersistedCatalog | undefined>;
	commit(expectedRevision: number | undefined, state: IAgentHostPersistedCatalog): Promise<void>;
}

/** Owns the sole legacy source key used by the one-shot Host catalog import. */
export interface IAgentHostLegacyCatalogSource {
	read(key: typeof legacySessionsStorageKey): Promise<string | undefined>;
	delete(key: typeof legacySessionsStorageKey): Promise<void>;
}

/** Product presentation data retained outside Platform for one legacy assistant message. */
export interface IAgentHostLegacyAssistantPresentationSource {
	readonly id: string;
	readonly turn: AgentTurnId;
	readonly responsePartIndex: number;
	readonly value: AgentHostProtocolValue;
}

/** Product presentation and composer data associated with one migrated Host Chat. */
export interface IAgentHostLegacyChatPresentationSource {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly input: string;
	readonly assistantMessages: readonly IAgentHostLegacyAssistantPresentationSource[];
}

/** Canonical Host additions prepared by the product-owned legacy presentation companion. */
export interface IAgentHostLegacyTurnEnrichment {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	readonly response: readonly Extract<AgentTurnResponsePart, { readonly kind: 'toolCall' | 'toolResult' }>[];
}

export interface IAgentHostLegacyCatalogMigrationCompanion {
	prepare(request: {
		readonly migrationId: string;
		readonly sourceDigest: AgentHostPayloadDigest;
		readonly chats: readonly IAgentHostLegacyChatPresentationSource[];
	}): Promise<readonly IAgentHostLegacyTurnEnrichment[]>;
	commit(request: {
		readonly migrationId: string;
		readonly sourceDigest: AgentHostPayloadDigest;
		readonly chats: readonly IAgentHostLegacyChatPresentationSource[];
		readonly catalog: IAgentHostPersistedCatalog;
	}): Promise<void>;
	readCompletedMigration(migrationId: string): Promise<AgentHostPayloadDigest | undefined>;
}

export interface IAgentHostLegacyCatalogMigrationOptions {
	readonly source: IAgentHostLegacyCatalogSource;
	readonly store: IAgentHostCatalogStore;
	readonly companion: IAgentHostLegacyCatalogMigrationCompanion;
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly sessionType: AgentSessionTypeId;
	readonly resumeSchema: AgentResumeSchemaId;
}

interface ILegacyImage {
	readonly id: string;
	readonly name: string;
	readonly mediaType: 'image/jpeg' | 'image/png';
	readonly data: string;
	readonly byteLength: number;
}

interface ILegacyMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	readonly content: string;
	readonly images: readonly ILegacyImage[];
	readonly includeInAgentHistory: boolean;
	readonly value: AgentHostProtocolValue;
}

interface ILegacySession {
	readonly conversationId: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly sessionTitle: string;
	readonly chatTitle: string;
	readonly status: 'completed' | 'failed';
	readonly workspace?: IAgentWorkspace;
	readonly modelId: string | undefined;
	readonly input: string;
	readonly messages: readonly ILegacyMessage[];
	readonly errorMessage: string | undefined;
	readonly value: AgentHostProtocolValue;
}

interface ILegacySessionMigrationPlan {
	readonly session: ILegacySession;
	readonly source: IAgentHostLegacyChatPresentationSource;
	readonly turns: readonly {
		readonly id: AgentTurnId;
		readonly submission: ReturnType<typeof createAgentSubmissionId>;
		readonly user: IAgentHostTurn['user'];
		readonly response: readonly AgentTurnResponsePart[];
	}[];
}

function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid legacy Sessions ${field}`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[], field: string): void {
	const expected = new Set(keys);
	if (Object.keys(record).length !== expected.size || Object.keys(record).some(key => !expected.has(key))) {
		throw new Error(`Invalid legacy Sessions ${field} fields`);
	}
}

function requireAllowedKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (required.some(key => !Object.hasOwn(record, key))
		|| Object.keys(record).some(key => !allowed.has(key))) {
		throw new Error(`Invalid legacy Sessions ${field} fields`);
	}
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximumLegacyStringLength) {
		throw new Error(`Invalid legacy Sessions ${field}`);
	}
	return value;
}

function requireNullableString(value: unknown, field: string): string | undefined {
	return value === null ? undefined : requireString(value, field, true);
}

function requireTimestamp(value: unknown, field: string): number {
	const serialized = requireString(value, field);
	const timestamp = new Date(serialized).getTime();
	if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== serialized) {
		throw new Error(`Invalid legacy Sessions ${field}`);
	}
	return timestamp;
}

function parseLegacyUri(value: unknown, field: string): string {
	const uri = requireRecord(value, field);
	requireExactKeys(uri, ['scheme', 'authority', 'path', 'query', 'fragment'], field);
	return URI.from({
		scheme: requireString(uri.scheme, `${field} scheme`),
		authority: requireString(uri.authority, `${field} authority`, true),
		path: requireString(uri.path, `${field} path`, true),
		query: requireString(uri.query, `${field} query`, true),
		fragment: requireString(uri.fragment, `${field} fragment`, true),
	}, true).toString();
}

function parseLegacyWorkspace(value: unknown): IAgentWorkspace | undefined {
	const state = requireRecord(value, 'workspace state');
	if (state.kind === 'workspace-less') {
		requireExactKeys(state, ['kind'], 'workspace-less state');
		return undefined;
	}
	if (state.kind !== 'workspace') {
		throw new Error('Invalid legacy Sessions workspace kind');
	}
	requireExactKeys(state, ['kind', 'workspace'], 'workspace state');
	const workspace = requireRecord(state.workspace, 'workspace');
	requireExactKeys(workspace, ['resource', 'label', 'folders'], 'workspace');
	if (!Array.isArray(workspace.folders) || workspace.folders.length > 1_024) {
		throw new Error('Invalid legacy Sessions workspace folders');
	}
	return Object.freeze({
		resource: parseLegacyUri(workspace.resource, 'workspace resource'),
		label: requireString(workspace.label, 'workspace label'),
		folders: Object.freeze(workspace.folders.map((folderValue, index) => {
			const folder = requireRecord(folderValue, `workspace folder ${index}`);
			requireExactKeys(folder, ['resource', 'workingDirectory', 'name', 'repository'], `workspace folder ${index}`);
			let repository: { readonly root: string; readonly branch?: string; readonly baseBranch?: string } | undefined;
			if (folder.repository !== null) {
				const source = requireRecord(folder.repository, `workspace repository ${index}`);
				requireExactKeys(source, ['root', 'branch', 'baseBranch'], `workspace repository ${index}`);
				const branch = requireNullableString(source.branch, `repository branch ${index}`);
				const baseBranch = requireNullableString(source.baseBranch, `repository base branch ${index}`);
				repository = Object.freeze({
					root: parseLegacyUri(source.root, `repository root ${index}`),
					...(branch === undefined ? {} : { branch }),
					...(baseBranch === undefined ? {} : { baseBranch }),
				});
			}
			return Object.freeze({
				resource: parseLegacyUri(folder.resource, `workspace folder resource ${index}`),
				workingDirectory: parseLegacyUri(folder.workingDirectory, `workspace folder working directory ${index}`),
				name: requireString(folder.name, `workspace folder name ${index}`),
				...(repository === undefined ? {} : { repository }),
			});
		})),
	});
}

function decodeCanonicalBase64(value: unknown, field: string): { readonly data: string; readonly byteLength: number } {
	const data = requireString(value, field);
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
		throw new Error(`Invalid legacy Sessions ${field}`);
	}
	const bytes = Buffer.from(data, 'base64');
	if (bytes.byteLength === 0 || bytes.byteLength > maximumLegacyImageBytes || bytes.toString('base64') !== data) {
		throw new Error(`Invalid legacy Sessions ${field}`);
	}
	return { data, byteLength: bytes.byteLength };
}

function parseLegacyImages(value: unknown, messageIndex: number): readonly ILegacyImage[] {
	if (!Array.isArray(value) || value.length > maximumLegacyImagesPerMessage) {
		throw new Error(`Invalid legacy Sessions message ${messageIndex} images`);
	}
	const ids = new Set<string>();
	let totalBytes = 0;
	const images = value.map((imageValue, imageIndex) => {
		const image = requireRecord(imageValue, `message ${messageIndex} image ${imageIndex}`);
		requireExactKeys(image, ['id', 'name', 'mimeType', 'data'], `message ${messageIndex} image ${imageIndex}`);
		const id = requireString(image.id, `message ${messageIndex} image ID`);
		createAgentAttachmentId(id);
		if (ids.has(id)) {
			throw new Error(`Duplicate legacy Sessions message ${messageIndex} image ID`);
		}
		ids.add(id);
		const mediaType = image.mimeType;
		if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') {
			throw new Error(`Invalid legacy Sessions message ${messageIndex} image media type`);
		}
		const decoded = decodeCanonicalBase64(image.data, `message ${messageIndex} image data`);
		totalBytes += decoded.byteLength;
		return Object.freeze({
			id,
			name: requireString(image.name, `message ${messageIndex} image name`),
			mediaType,
			...decoded,
		});
	});
	if (totalBytes > maximumLegacyImagesBytesPerMessage) {
		throw new Error(`Invalid legacy Sessions message ${messageIndex} image bytes`);
	}
	return Object.freeze(images);
}

function parseLegacyMessage(value: unknown, index: number): ILegacyMessage {
	const message = requireRecord(value, `message ${index}`);
	const role = message.role;
	if (role === 'user') {
		requireAllowedKeys(
			message,
			['id', 'role', 'content', 'imageAttachments'],
			['includeInAgentHistory'],
			`user message ${index}`,
		);
	} else if (role === 'assistant') {
		requireAllowedKeys(
			message,
			['id', 'role', 'content', 'imageAttachments'],
			['includeInAgentHistory', 'articleList', 'result', 'patchProposal'],
			`assistant message ${index}`,
		);
	} else {
		throw new Error(`Invalid legacy Sessions message ${index} role`);
	}
	if (message.includeInAgentHistory !== undefined && typeof message.includeInAgentHistory !== 'boolean') {
		throw new Error(`Invalid legacy Sessions message ${index} history state`);
	}
	assertAgentHostProtocolValue(message);
	return Object.freeze({
		id: requireString(message.id, `message ${index} ID`),
		role,
		content: requireString(message.content, `message ${index} content`, true),
		images: parseLegacyImages(message.imageAttachments, index),
		includeInAgentHistory: message.includeInAgentHistory !== false,
		value: message as AgentHostProtocolValue,
	});
}

function parseLegacySession(value: unknown, index: number): ILegacySession {
	const session = requireRecord(value, `Session ${index}`);
	requireExactKeys(session, [
		'conversationId', 'createdAt', 'updatedAt', 'sessionTitle', 'chatTitle', 'status', 'workspace', 'modelId', 'chatState',
	], `Session ${index}`);
	const conversationId = requireString(session.conversationId, `Session ${index} conversation ID`);
	if (conversationId !== conversationId.trim() || conversationId.includes('/')) {
		throw new Error(`Invalid legacy Sessions Session ${index} conversation ID`);
	}
	createAgentSessionId(conversationId);
	createAgentChatId(conversationId);
	const createdAt = requireTimestamp(session.createdAt, `Session ${index} creation time`);
	const updatedAt = requireTimestamp(session.updatedAt, `Session ${index} activity time`);
	if (updatedAt < createdAt) {
		throw new Error(`Invalid legacy Sessions Session ${index} activity time`);
	}
	if (session.status !== 'completed' && session.status !== 'failed') {
		throw new Error(`Invalid legacy Sessions Session ${index} status`);
	}
	const chatState = requireRecord(session.chatState, `Session ${index} Chat state`);
	requireExactKeys(chatState, ['input', 'messages', 'errorMessage'], `Session ${index} Chat state`);
	if (!Array.isArray(chatState.messages) || chatState.messages.length > maximumLegacyMessages) {
		throw new Error(`Invalid legacy Sessions Session ${index} messages`);
	}
	const messages = chatState.messages.map(parseLegacyMessage);
	const messageIds = messages.map(message => message.id);
	if (new Set(messageIds).size !== messageIds.length) {
		throw new Error(`Duplicate legacy Sessions Session ${index} message ID`);
	}
	const errorMessage = requireNullableString(chatState.errorMessage, `Session ${index} error`);
	if (session.status === 'completed' && errorMessage !== undefined) {
		throw new Error(`Invalid legacy Sessions Session ${index} completed error`);
	}
	assertAgentHostProtocolValue(session);
	return Object.freeze({
		conversationId,
		createdAt,
		updatedAt,
		sessionTitle: requireString(session.sessionTitle, `Session ${index} title`),
		chatTitle: requireString(session.chatTitle, `Session ${index} Chat title`),
		status: session.status,
		workspace: parseLegacyWorkspace(session.workspace),
		modelId: requireNullableString(session.modelId, `Session ${index} model`),
		input: requireString(chatState.input, `Session ${index} input`, true),
		messages,
		errorMessage,
		value: session as AgentHostProtocolValue,
	});
}

function parseLegacyRoot(serialized: string): {
	readonly sessions: readonly ILegacySession[];
	readonly source: AgentHostProtocolValue;
} {
	if (Buffer.byteLength(serialized, 'utf8') > maximumLegacyStorageBytes) {
		throw new Error('Legacy Sessions state exceeds its byte limit');
	}
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error('Legacy Sessions state is not valid JSON');
	}
	assertAgentHostProtocolValue(value);
	const root = requireRecord(value, 'root');
	requireExactKeys(root, ['version', 'sessions'], 'root');
	if (root.version !== legacySessionsStorageVersion || !Array.isArray(root.sessions) || root.sessions.length > maximumLegacySessions) {
		throw new Error('Unsupported legacy Sessions state');
	}
	const sessions = root.sessions.map(parseLegacySession);
	const ids = sessions.map(session => session.conversationId);
	if (new Set(ids).size !== ids.length) {
		throw new Error('Duplicate legacy Sessions conversation ID');
	}
	return Object.freeze({ sessions: Object.freeze(sessions), source: value });
}

function sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function createMigratedImage(messageId: string, image: ILegacyImage): IAgentHostAttachment {
	const digest = sha256(Buffer.from(image.data, 'base64'));
	return Object.freeze({
		envelopeVersion: 1,
		id: createAgentAttachmentId(image.id),
		producerType: createAgentAttachmentProducerTypeId('chat.image'),
		display: Object.freeze({ label: image.name }),
		representation: Object.freeze({
			schema: createAgentAttachmentRepresentationSchemaId('comet.image'),
			mediaType: image.mediaType,
			value: Object.freeze({ name: image.name }),
		}),
		content: Object.freeze({
			kind: 'inline',
			mediaType: image.mediaType,
			encoding: 'base64',
			data: image.data,
			byteLength: image.byteLength,
			version: createAgentContentVersion(`sha256:${digest}`),
			digest: createAgentContentDigest(`sha256:${digest}`),
		}),
		metadata: Object.freeze([Object.freeze({
			namespace: 'comet.image',
			value: Object.freeze({ sourceMessage: messageId }),
		})]),
	});
}

function computeMigratedPayloadDigest(value: AgentHostProtocolValue | object): AgentHostPayloadDigest {
	return createAgentHostPayloadDigest(`sha256:${sha256(encodeAgentHostProtocolValue(value))}`);
}

function legacyTurnEnrichmentKey(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): string {
	return `${session}\0${chat}\0${turn}`;
}

function createLegacySessionMigrationPlans(
	sessions: readonly ILegacySession[],
): readonly ILegacySessionMigrationPlan[] {
	return Object.freeze(sessions.map(session => {
		const sessionId = createAgentSessionId(session.conversationId);
		const chatId = createAgentChatId(session.conversationId);
		const assistantMessages: IAgentHostLegacyAssistantPresentationSource[] = [];
		const turns: Array<{
			id: AgentTurnId;
			submission: ReturnType<typeof createAgentSubmissionId>;
			user: IAgentHostTurn['user'];
			response: AgentTurnResponsePart[];
		}> = [];
		for (const message of session.messages) {
			if (message.role === 'user') {
				turns.push({
					id: createAgentTurnId(message.id),
					submission: createAgentSubmissionId(message.id),
					user: Object.freeze({
						text: message.content,
						attachments: Object.freeze(
							message.images.map(image => createMigratedImage(message.id, image)),
						),
						interactionTargets: Object.freeze([]),
					}),
					response: [],
				});
				continue;
			}
			const turn = turns.at(-1);
			if (message.images.length !== 0 || !turn) {
				throw new Error('Legacy assistant message cannot be represented in canonical Host history');
			}
			const responsePartIndex = turn.response.length;
			turn.response.push(Object.freeze({ kind: 'text', text: message.content }));
			assistantMessages.push(Object.freeze({
				id: message.id,
				turn: turn.id,
				responsePartIndex,
				value: message.value,
			}));
		}
		const source = Object.freeze({
			session: sessionId,
			chat: chatId,
			input: session.input,
			assistantMessages: Object.freeze(assistantMessages),
		});
		return Object.freeze({
			session,
			source,
			turns: Object.freeze(turns.map(turn => Object.freeze({
				...turn,
				response: Object.freeze(turn.response),
			}))),
		});
	}));
}

function validateLegacyTurnEnrichments(
	chats: readonly IAgentHostLegacyChatPresentationSource[],
	enrichments: readonly IAgentHostLegacyTurnEnrichment[],
): ReadonlyMap<string, IAgentHostLegacyTurnEnrichment> {
	const knownTurns = new Set<string>();
	for (const chat of chats) {
		for (const message of chat.assistantMessages) {
			knownTurns.add(legacyTurnEnrichmentKey(chat.session, chat.chat, message.turn));
		}
	}
	const result = new Map<string, IAgentHostLegacyTurnEnrichment>();
	for (const enrichment of enrichments) {
		const session = createAgentSessionId(enrichment.session);
		const chat = createAgentChatId(enrichment.chat);
		const turn = createAgentTurnId(enrichment.turn);
		const key = legacyTurnEnrichmentKey(session, chat, turn);
		if (!knownTurns.has(key) || result.has(key)) {
			throw new Error(`Legacy presentation enrichment '${key}' is unmatched or duplicated`);
		}
		if (enrichment.interactionTargets.length === 0 || enrichment.response.length === 0) {
			throw new Error(`Legacy presentation enrichment '${key}' is empty`);
		}
		const targetIds = new Set<string>();
		for (const target of enrichment.interactionTargets) {
			assertAgentHostInteractionTarget(target);
			if (targetIds.has(target.id)) {
				throw new Error(`Legacy presentation enrichment '${key}' contains duplicate targets`);
			}
			targetIds.add(target.id);
		}
		for (const part of enrichment.response) {
			if (part.kind !== 'toolCall' && part.kind !== 'toolResult') {
				throw new Error(`Legacy presentation enrichment '${key}' contains a non-Tool response`);
			}
			assertAgentHostProtocolValue(part);
		}
		result.set(key, Object.freeze({
			session,
			chat,
			turn,
			interactionTargets: Object.freeze([...enrichment.interactionTargets]),
			response: Object.freeze([...enrichment.response]),
		}));
	}
	return result;
}

function createMigratedTurns(
	plan: ILegacySessionMigrationPlan,
	enrichments: ReadonlyMap<string, IAgentHostLegacyTurnEnrichment>,
): readonly IAgentHostTurn[] {
	const { session, source, turns } = plan;
	return Object.freeze(turns.map((turn, index) => {
		const failed = session.status === 'failed' && index === turns.length - 1;
		const failure: IAgentHostOperationFailure | undefined = failed
			? Object.freeze({
				code: 'agentUnavailable',
				message: session.errorMessage ?? 'Imported Agent turn failed',
				reconciliation: 'terminal',
			})
			: undefined;
		const enrichment = enrichments.get(legacyTurnEnrichmentKey(source.session, source.chat, turn.id));
		const user = Object.freeze({
			...turn.user,
			interactionTargets: enrichment?.interactionTargets ?? Object.freeze([]),
		});
		const response = Object.freeze([
			...turn.response,
			...(enrichment?.response ?? []),
		]);
		return Object.freeze({
			id: turn.id,
			submission: turn.submission,
			payloadDigest: computeMigratedPayloadDigest({ user, response }),
			state: failed ? 'failed' : 'completed',
			user,
			response,
			...(failure === undefined ? {} : { failure }),
		});
	}));
}

function createMigratedCometMessages(session: ILegacySession): {
	readonly messages: readonly CometModelMessage[];
	readonly turns: readonly { readonly turn: ReturnType<typeof createAgentTurnId>; readonly messageLength: number }[];
} {
	const messages: CometModelMessage[] = [];
	const turns: Array<{ readonly turn: ReturnType<typeof createAgentTurnId>; readonly messageLength: number }> = [];
	let currentTurn: ReturnType<typeof createAgentTurnId> | undefined;
	const completeCurrentTurn = () => {
		if (currentTurn !== undefined) {
			turns.push(Object.freeze({ turn: currentTurn, messageLength: messages.length }));
			currentTurn = undefined;
		}
	};
	for (const [index, message] of session.messages.entries()) {
		if (message.role === 'user') {
			completeCurrentTurn();
			if (!message.includeInAgentHistory) {
				continue;
			}
			currentTurn = createAgentTurnId(message.id);
			messages.push(Object.freeze({ role: 'user', turn: currentTurn, text: message.content }));
			continue;
		}
		if (!message.includeInAgentHistory) {
			continue;
		}
		if (currentTurn === undefined) {
			throw new Error(`Legacy Sessions assistant message ${index} cannot be represented in Comet model history`);
		}
		messages.push(Object.freeze({
			role: 'assistant',
			turn: currentTurn,
			parts: Object.freeze([{ kind: 'text' as const, text: message.content }]),
		}));
	}
	completeCurrentTurn();
	return Object.freeze({ messages: Object.freeze(messages), turns: Object.freeze(turns) });
}

function createMigratedRecord(
	plan: ILegacySessionMigrationPlan,
	options: IAgentHostLegacyCatalogMigrationOptions,
	enrichments: ReadonlyMap<string, IAgentHostLegacyTurnEnrichment>,
): IAgentHostPersistedSessionRecord {
	const { session, source } = plan;
	const sessionId = source.session;
	const chatId = source.chat;
	const turns = createMigratedTurns(plan, enrichments);
	const cometHistory = createMigratedCometMessages(session);
	const sessionResume = encodeCometSessionResumeV1(sessionId, session.workspace);
	const chatResume = encodeCometChatResumeV1({
		session: sessionId,
		chat: chatId,
		origin: { kind: 'user' },
		baseMessageLength: 0,
		messages: cometHistory.messages,
		usage: [],
		turns: cometHistory.turns,
	});
	const status = session.status;
	const chat: IAgentHostChatState = Object.freeze({
		id: chatId,
		createdAt: session.createdAt,
		title: session.chatTitle,
		origin: Object.freeze({ kind: 'user' }),
		model: session.modelId === undefined ? null : createAgentModelId(session.modelId),
		lifecycle: 'released',
		interactivity: 'full',
		status,
		isRead: true,
		capabilities: Object.freeze({
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: false,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: false,
			supportsCancel: false,
		}),
		modifiedAt: session.updatedAt,
		session: sessionId,
		turns,
	});
	assertAgentHostChatState(chat);
	const stateBase: Omit<IAgentHostSessionState, 'workspace'> = {
		id: sessionId,
		packageId: options.packageId,
		agentId: options.agentId,
		type: options.sessionType,
		createdAt: session.createdAt,
		title: session.sessionTitle,
		archived: false,
		lifecycle: 'released',
		status,
		isRead: true,
		modifiedAt: session.updatedAt,
		capabilities: Object.freeze({
			supportsCreateChat: false,
			maximumChatCount: 1,
			supportsFork: false,
			supportsRename: true,
			supportsArchive: true,
			supportsDelete: true,
			supportsChanges: false,
			supportsModels: true,
		}),
		changes: Object.freeze([]),
		chats: Object.freeze([toPersistedChatSummary(chat)]),
	};
	const state: IAgentHostSessionState = Object.freeze(session.workspace === undefined
		? stateBase
		: { ...stateBase, workspace: session.workspace });
	return Object.freeze({
		state,
		resume: sessionResume,
		chats: Object.freeze([Object.freeze({ state: chat, resume: chatResume })]),
	});
}

function createInitialChannelRevisions(records: readonly IAgentHostPersistedSessionRecord[]): Readonly<Record<string, AgentHostChannelRevision>> {
	const revisions: Record<string, AgentHostChannelRevision> = {
		[getAgentHostRootChannelId()]: createAgentHostChannelRevision(0),
		[getAgentHostSessionsChannelId()]: createAgentHostChannelRevision(0),
	};
	for (const record of records) {
		revisions[getAgentHostSessionChannelId(record.state.id)] = createAgentHostChannelRevision(0);
		for (const chat of record.chats) {
			revisions[getAgentHostChatChannelId(record.state.id, chat.state.id)] = createAgentHostChannelRevision(0);
		}
	}
	return Object.freeze(revisions);
}

export function createEmptyAgentHostCatalog(): IAgentHostPersistedCatalog {
	return Object.freeze({
		schemaVersion: agentHostCatalogSchemaVersion,
		revision: 0,
		packageCatalogRevision: 0,
		hostSequence: createAgentHostSequence(0),
		channelRevisions: createInitialChannelRevisions([]),
		sessions: Object.freeze([]),
		backingRemovalOperations: Object.freeze([]),
		completedMigrations: Object.freeze([]),
	});
}

export function assertAgentHostPersistedCatalog(value: IAgentHostPersistedCatalog): void {
	if (
		value.schemaVersion !== agentHostCatalogSchemaVersion
		|| !Number.isSafeInteger(value.revision)
		|| value.revision < 0
		|| !Number.isSafeInteger(value.packageCatalogRevision)
		|| value.packageCatalogRevision < 0
	) {
		throw new Error('Invalid Agent Host catalog header');
	}
	createAgentHostSequence(value.hostSequence);
	if (
		!Object.hasOwn(value.channelRevisions, getAgentHostRootChannelId())
		|| !Object.hasOwn(value.channelRevisions, getAgentHostSessionsChannelId())
	) {
		throw new Error('Agent Host catalog is missing a root channel revision');
	}
	const sessionIds = new Set<string>();
	for (const record of value.sessions) {
		assertAgentHostProtocolValue(record.state);
		if (sessionIds.has(record.state.id)) {
			throw new Error('Duplicate Agent Host Session identity');
		}
		sessionIds.add(record.state.id);
		createAgentSessionId(record.state.id);
		createAgentPackageId(record.state.packageId);
		createAgentId(record.state.agentId);
		createAgentSessionTypeId(record.state.type);
		assertPersistedResumeState(record.resume);
		const chatIds = new Set<string>();
		if (record.state.chats.length !== record.chats.length) {
			throw new Error('Agent Host Session and Chat catalogs differ');
		}
		for (const [index, chat] of record.chats.entries()) {
			assertAgentHostChatState(chat.state);
			assertPersistedResumeState(chat.resume);
			if (chat.state.session !== record.state.id || chatIds.has(chat.state.id)) {
				throw new Error('Invalid Agent Host Chat membership');
			}
			chatIds.add(chat.state.id);
			if (encodeAgentHostProtocolValue(record.state.chats[index]) !== encodeAgentHostProtocolValue(toPersistedChatSummary(chat.state))) {
				throw new Error('Agent Host Session and Chat summary state differs');
			}
		}
		if (record.state.chats.some(chat => !chatIds.has(chat.id))) {
			throw new Error('Agent Host Session has an unpersisted Chat summary');
		}
	}
	for (const [channel, revision] of Object.entries(value.channelRevisions)) {
		createAgentHostChannelId(channel);
		createAgentHostChannelRevision(revision);
	}
	const backingOperations = new Set<string>();
	for (const operation of value.backingRemovalOperations) {
		const operationId = createAgentHostOperationId(operation.operation);
		if (backingOperations.has(operationId) || operation.records.length === 0) {
			throw new Error('Invalid Agent Host backing-removal operation');
		}
		backingOperations.add(operationId);
		createAgentHostPayloadDigest(operation.digest);
		const records = new Set<string>();
		for (const identity of operation.records) {
			assertAgentHostProtocolValue(identity);
			createAgentPackageId(identity.packageId);
			createAgentId(identity.agentId);
			createAgentSessionId(identity.sessionId);
			if (identity.chatId !== undefined) {
				createAgentChatId(identity.chatId);
			}
			const key = encodeAgentHostProtocolValue(identity);
			if (records.has(key)) {
				throw new Error('Duplicate Agent Host backing-removal identity');
			}
			records.add(key);
		}
	}
	const migrations = new Set<string>();
	for (const migration of value.completedMigrations) {
		if (migration.id.length === 0 || migrations.has(migration.id)) {
			throw new Error('Invalid Agent Host catalog migration record');
		}
		migrations.add(migration.id);
		createAgentHostPayloadDigest(migration.sourceDigest);
	}
}

function assertPersistedResumeState(value: IAgentResumeState | undefined): void {
	if (value === undefined) {
		return;
	}
	createAgentResumeSchemaId(value.schema);
	if (typeof value.data !== 'string' || value.data.length > 64 * 1024 * 1024) {
		throw new Error('Invalid Agent Host resume state');
	}
}

function toPersistedChatSummary(state: IAgentHostChatState): IAgentHostSessionState['chats'][number] {
	return Object.freeze({
		id: state.id,
		createdAt: state.createdAt,
		title: state.title,
		origin: state.origin,
		model: state.model,
		lifecycle: state.lifecycle,
		interactivity: state.interactivity,
		status: state.status,
		isRead: state.isRead,
		capabilities: state.capabilities,
		modifiedAt: state.modifiedAt,
	});
}

/** Imports the exact legacy v3 source and deletes it only after Host and product presentation commits agree. */
export async function migrateLegacySessionsCatalog(options: IAgentHostLegacyCatalogMigrationOptions): Promise<void> {
	if (
		options.packageId !== 'comet'
		|| options.agentId !== 'comet'
		|| options.resumeSchema !== COMET_AGENT_RESUME_SCHEMA
	) {
		throw new Error('Legacy Sessions can only migrate to bundled Comet ownership');
	}
	const serialized = await options.source.read(legacySessionsStorageKey);
	if (serialized === undefined) {
		return;
	}
	const legacy = parseLegacyRoot(serialized);
	const sourceDigest = computeMigratedPayloadDigest(legacy.source);
	const plans = createLegacySessionMigrationPlans(legacy.sessions);
	const chats = Object.freeze(plans.map(plan => plan.source));
	const companionCompleted = await options.companion.readCompletedMigration(legacySessionsMigrationId);
	if (companionCompleted !== undefined && companionCompleted !== sourceDigest) {
		throw new Error('Chat presentation storage conflicts with the legacy Sessions source');
	}
	const existing = await options.store.read();
	if (existing !== undefined) {
		assertAgentHostPersistedCatalog(existing);
		const completed = existing.completedMigrations.find(migration => migration.id === legacySessionsMigrationId);
		if (completed !== undefined) {
			if (completed.sourceDigest !== sourceDigest) {
				throw new Error('Agent Host catalog conflicts with the legacy Sessions source');
			}
			await options.companion.commit({
				migrationId: legacySessionsMigrationId,
				sourceDigest,
				chats,
				catalog: existing,
			});
			if (await options.companion.readCompletedMigration(legacySessionsMigrationId) !== sourceDigest) {
				throw new Error('Chat presentation storage did not confirm the legacy Sessions source');
			}
			await options.source.delete(legacySessionsStorageKey);
			return;
		}
	}
	const enrichments = validateLegacyTurnEnrichments(
		chats,
		await options.companion.prepare({
			migrationId: legacySessionsMigrationId,
			sourceDigest,
			chats,
		}),
	);
	const imported = Object.freeze(
		plans.map(plan => createMigratedRecord(plan, options, enrichments)),
	);
	const existingSessionIds = new Set(existing?.sessions.map(record => record.state.id) ?? []);
	for (const record of imported) {
		if (existingSessionIds.has(record.state.id)) {
			throw new Error(`Agent Host catalog already contains migrated Session '${record.state.id}'`);
		}
		existingSessionIds.add(record.state.id);
	}
	const sessions = Object.freeze([...(existing?.sessions ?? []), ...imported]);
	const channelRevisions: Record<string, AgentHostChannelRevision> = { ...(existing?.channelRevisions ?? createInitialChannelRevisions([])) };
	for (const record of imported) {
		channelRevisions[getAgentHostSessionChannelId(record.state.id)] = createAgentHostChannelRevision(0);
		for (const chat of record.chats) {
			channelRevisions[getAgentHostChatChannelId(record.state.id, chat.state.id)] = createAgentHostChannelRevision(0);
		}
	}
	let hostSequence = existing?.hostSequence ?? createAgentHostSequence(0);
	if (existing !== undefined && imported.length !== 0) {
		hostSequence = createAgentHostSequence(hostSequence + 1);
		const sessionsChannel = getAgentHostSessionsChannelId();
		channelRevisions[sessionsChannel] = createAgentHostChannelRevision((channelRevisions[sessionsChannel] ?? 0) + 1);
	}
	const catalog: IAgentHostPersistedCatalog = Object.freeze({
		schemaVersion: agentHostCatalogSchemaVersion,
		revision: existing === undefined ? 0 : existing.revision + 1,
		packageCatalogRevision: existing === undefined ? 0 : existing.packageCatalogRevision,
		hostSequence,
		channelRevisions: Object.freeze(channelRevisions),
		sessions,
		backingRemovalOperations: existing?.backingRemovalOperations ?? Object.freeze([]),
		completedMigrations: Object.freeze([
			...(existing?.completedMigrations ?? []),
			Object.freeze({ id: legacySessionsMigrationId, sourceDigest }),
		]),
	});
	assertAgentHostPersistedCatalog(catalog);
	await options.store.commit(existing?.revision, catalog);
	await options.companion.commit({
		migrationId: legacySessionsMigrationId,
		sourceDigest,
		chats,
		catalog,
	});
	if (await options.companion.readCompletedMigration(legacySessionsMigrationId) !== sourceDigest) {
		throw new Error('Chat presentation storage did not confirm the legacy Sessions source');
	}
	await options.source.delete(legacySessionsStorageKey);
}
