/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStorage } from 'cs/base/parts/storage/common/storage';
import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	createAgentHostPayloadDigest,
	type AgentHostPayloadDigest,
} from 'cs/platform/agentHost/common/identities';
import {
	capturePendingChatAttachment,
	maximumPendingChatAttachments,
	maximumPendingChatInteractionTargets,
	type IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import {
	parseChatHostPresentation,
	type IChatHostPresentation,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';

export const ChatPersistenceStorageKey = 'chat.resources.v1';
export const ChatPersistenceSchemaVersion = 1;

const maximumPersistedChatResources = 16_384;
const maximumPersistedChatStateBytes = 64 * 1024 * 1024;
const maximumPersistedInputLength = 16 * 1024 * 1024;

export interface IChatPersistedComposerState {
	readonly input: string;
	readonly revision: number;
	readonly attachments: readonly IPendingChatAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
}

export interface IChatPersistedResourceState {
	readonly resource: string;
	readonly composer: IChatPersistedComposerState;
	readonly presentations: readonly IChatHostPresentation[];
}

export interface IChatCompletedMigration {
	readonly id: string;
	readonly sourceDigest: AgentHostPayloadDigest;
}

export interface IChatPersistedState {
	readonly schemaVersion: typeof ChatPersistenceSchemaVersion;
	readonly revision: number;
	readonly chats: readonly IChatPersistedResourceState[];
	readonly completedMigrations: readonly IChatCompletedMigration[];
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
	record: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string,
): void {
	if (Object.keys(record).length !== keys.length
		|| Object.keys(record).some(key => !keys.includes(key))) {
		throw new TypeError(`${label} contains unsupported or missing properties.`);
	}
}

function requireNonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function requireString(
	value: unknown,
	label: string,
	maximumLength: number,
	allowEmpty = false,
): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
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

function parseInteractionTarget(value: unknown): IAgentHostInteractionTarget {
	assertAgentHostInteractionTarget(value);
	return freezeStructuredValue(value);
}

function parseCanonicalResource(value: unknown, label: string): string {
	const serialized = requireString(value, label, 8_192);
	const resource = URI.parse(serialized);
	if (!resource.scheme || resource.toString(true) !== serialized) {
		throw new TypeError(`${label} must be a canonical URI.`);
	}
	return serialized;
}

function parseComposer(value: unknown, chatIndex: number): IChatPersistedComposerState {
	const composer = requireRecord(value, `Persisted Chat ${chatIndex} composer`);
	requireExactKeys(
		composer,
		['input', 'revision', 'attachments', 'interactionTargets'],
		`Persisted Chat ${chatIndex} composer`,
	);
	if (!Array.isArray(composer.attachments)
		|| composer.attachments.length > maximumPendingChatAttachments) {
		throw new TypeError(`Persisted Chat ${chatIndex} attachments must be a bounded array.`);
	}
	const attachments = Object.freeze(composer.attachments.map(capturePendingChatAttachment));
	if (new Set(attachments.map(attachment => attachment.id)).size !== attachments.length) {
		throw new TypeError(`Persisted Chat ${chatIndex} contains duplicate attachment IDs.`);
	}
	if (!Array.isArray(composer.interactionTargets)
		|| composer.interactionTargets.length > maximumPendingChatInteractionTargets) {
		throw new TypeError(`Persisted Chat ${chatIndex} targets must be a bounded array.`);
	}
	const interactionTargets = Object.freeze(composer.interactionTargets.map(parseInteractionTarget));
	if (new Set(interactionTargets.map(target => target.id)).size !== interactionTargets.length) {
		throw new TypeError(`Persisted Chat ${chatIndex} contains duplicate target IDs.`);
	}
	return Object.freeze({
		input: requireString(
			composer.input,
			`Persisted Chat ${chatIndex} input`,
			maximumPersistedInputLength,
			true,
		),
		revision: requireNonNegativeInteger(composer.revision, `Persisted Chat ${chatIndex} composer revision`),
		attachments,
		interactionTargets,
	});
}

/** Strictly validates and freezes one complete addressed Chat persistence record. */
export function parseChatPersistedResourceState(
	value: unknown,
	chatIndex = 0,
): IChatPersistedResourceState {
	const chat = requireRecord(value, `Persisted Chat ${chatIndex}`);
	requireExactKeys(
		chat,
		['resource', 'composer', 'presentations'],
		`Persisted Chat ${chatIndex}`,
	);
	if (!Array.isArray(chat.presentations)) {
		throw new TypeError(`Persisted Chat ${chatIndex} presentations must be arrays.`);
	}
	const presentations = Object.freeze(
		chat.presentations.map(parseChatHostPresentation),
	);
	const presentationKeys = presentations.map(presentation =>
		`${presentation.session}\0${presentation.chat}\0${presentation.turn}\0${presentation.responsePartIndex}`,
	);
	if (new Set(presentationKeys).size !== presentationKeys.length) {
		throw new TypeError(`Persisted Chat ${chatIndex} contains duplicate Host presentations.`);
	}
	return Object.freeze({
		resource: parseCanonicalResource(chat.resource, `Persisted Chat ${chatIndex} resource`),
		composer: parseComposer(chat.composer, chatIndex),
		presentations,
	});
}

function parseCompletedMigration(value: unknown, index: number): IChatCompletedMigration {
	const migration = requireRecord(value, `Chat migration ${index}`);
	requireExactKeys(migration, ['id', 'sourceDigest'], `Chat migration ${index}`);
	return Object.freeze({
		id: requireString(migration.id, `Chat migration ${index} ID`, 128),
		sourceDigest: createAgentHostPayloadDigest(
			requireString(migration.sourceDigest, `Chat migration ${index} source digest`, 71),
		),
	});
}

/** Parses the only current Chat persistence schema. */
export function parseChatPersistedState(serialized: string | undefined): IChatPersistedState | undefined {
	if (serialized === undefined) {
		return undefined;
	}
	if (new TextEncoder().encode(serialized).byteLength > maximumPersistedChatStateBytes) {
		throw new RangeError('Persisted Chat state exceeds its byte limit.');
	}
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch (error) {
		throw new TypeError('Persisted Chat state is not valid JSON.', { cause: error });
	}
	const root = requireRecord(value, 'Persisted Chat state');
	requireExactKeys(
		root,
		['schemaVersion', 'revision', 'chats', 'completedMigrations'],
		'Persisted Chat state',
	);
	if (root.schemaVersion !== ChatPersistenceSchemaVersion) {
		throw new TypeError('Persisted Chat schema version is unsupported.');
	}
	if (!Array.isArray(root.chats)
		|| root.chats.length > maximumPersistedChatResources
		|| !Array.isArray(root.completedMigrations)) {
		throw new TypeError('Persisted Chat collections are invalid.');
	}
	const chats = Object.freeze(root.chats.map(parseChatPersistedResourceState));
	const resourceKeys = chats.map(chat => getComparisonKey(URI.parse(chat.resource)));
	if (new Set(resourceKeys).size !== resourceKeys.length) {
		throw new TypeError('Persisted Chat resources contain duplicates.');
	}
	const completedMigrations = Object.freeze(root.completedMigrations.map(parseCompletedMigration));
	if (new Set(completedMigrations.map(migration => migration.id)).size !== completedMigrations.length) {
		throw new TypeError('Persisted Chat migration records contain duplicate IDs.');
	}
	return Object.freeze({
		schemaVersion: ChatPersistenceSchemaVersion,
		revision: requireNonNegativeInteger(root.revision, 'Persisted Chat state revision'),
		chats,
		completedMigrations,
	});
}

/** Creates the initial persisted state for the first committed Chat mutation. */
export function createEmptyChatPersistedState(): IChatPersistedState {
	return Object.freeze({
		schemaVersion: ChatPersistenceSchemaVersion,
		revision: 0,
		chats: Object.freeze([]),
		completedMigrations: Object.freeze([]),
	});
}

/** Validates and serializes one complete current Chat persistence snapshot. */
export function serializeChatPersistedState(state: IChatPersistedState): string {
	const serialized = JSON.stringify(state);
	const parsed = parseChatPersistedState(serialized);
	if (parsed === undefined) {
		throw new Error('Serialized Chat state was unexpectedly absent.');
	}
	return serialized;
}

/** Provides revision-preconditioned commits for startup migration composition. */
export class ApplicationStorageChatPersistenceStore {
	private commitTail = Promise.resolve();

	constructor(private readonly storage: IStorage) { }

	async read(): Promise<IChatPersistedState | undefined> {
		await this.commitTail;
		return parseChatPersistedState(this.storage.get(ChatPersistenceStorageKey));
	}

	commit(expectedRevision: number | undefined, state: IChatPersistedState): Promise<void> {
		const commit = this.commitTail.then(async () => {
			const serialized = serializeChatPersistedState(state);
			const existing = parseChatPersistedState(this.storage.get(ChatPersistenceStorageKey));
			if (existing?.revision !== expectedRevision) {
				throw new Error(
					`Chat storage revision conflict: expected ${expectedRevision ?? 'absent'}, `
						+ `found ${existing?.revision ?? 'absent'}.`,
				);
			}
			const nextRevision = expectedRevision === undefined ? 0 : expectedRevision + 1;
			if (state.revision !== nextRevision) {
				throw new Error(`Chat storage requires revision ${nextRevision}, received ${state.revision}.`);
			}
			await this.storage.set(ChatPersistenceStorageKey, serialized);
		});
		this.commitTail = commit.catch(() => undefined);
		return commit;
	}
}
