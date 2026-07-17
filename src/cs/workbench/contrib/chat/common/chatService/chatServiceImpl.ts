/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { cloneAndChange } from 'cs/base/common/objects';
import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	createAgentChatId,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolId,
	createAgentTurnId,
	type AgentToolId,
	type AgentSubmissionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostChatState,
	type IAgentHostChatState,
} from 'cs/platform/agentHost/common/protocol';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	IStorageService,
	StorageScope,
	StorageTarget,
} from 'cs/platform/storage/common/storage';
import {
	IChatService as IChatServiceDecorator,
	type IChatModel,
	type IChatModelInitialState,
	type IChatHostModelIdentity,
	type IChatHostPresentationUpdate,
	type IChatModelReference,
	type IChatModelOwnerReference,
	type IChatModelSnapshot,
	type IPreparedChatSubmission,
	type IChatService,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	ChatAttachmentProducerRegistry,
	capturePendingChatAttachment,
	maximumPendingChatAttachments,
	maximumPendingChatInteractionTargets,
	prepareChatAttachments,
	type IChatAttachmentProducer,
	type IPreparedChatAttachments,
	type IChatSubmissionCapture,
	type IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import {
	ChatImageAttachmentProducer,
	ChatSelectionAttachmentProducer,
	ChatTextAttachmentProducer,
} from 'cs/workbench/contrib/chat/common/chatService/chatOwnedAttachments';
import {
	ChatPersistenceSchemaVersion,
	ChatPersistenceStorageKey,
	parseChatPersistedResourceState,
	parseChatPersistedState,
	serializeChatPersistedState,
	type IChatPersistedResourceState,
	type IChatPersistedState,
} from 'cs/workbench/contrib/chat/common/chatService/chatPersistence';
import {
	ChatHostPresentationSchemaVersion,
	parseChatHostPresentation,
	parseChatHostPresentationProjection,
	type IChatHostPresentation,
	type IChatHostPresentationIdentity,
	type IChatHostPresentationProvider,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';

interface ILiveChatModel {
	readonly model: ChatModel;
	readonly persistenceListener: IDisposable;
	referenceCount: number;
	permanentlyDeleted: boolean;
}

function cloneStructuredValue<T>(value: T): T {
	return cloneAndChange(value, () => undefined);
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

function captureInteractionTarget(target: IAgentHostInteractionTarget): IAgentHostInteractionTarget {
	assertAgentHostInteractionTarget(target);
	return freezeStructuredValue(cloneStructuredValue(target));
}

function hostPresentationKey(
	presentation: IChatHostPresentationIdentity,
): string {
	return `${presentation.session}\0${presentation.chat}\0${presentation.turn}\0${presentation.behaviorIndex}`;
}

function hostPresentationContentKey(presentation: IChatHostPresentation): string {
	return encodeAgentHostProtocolValue({
		type: presentation.type,
		value: presentation.value,
	});
}

function validateHostPresentations(
	identity: IChatHostModelIdentity,
	state: IAgentHostChatState,
	presentations: readonly IChatHostPresentation[],
): readonly IChatHostPresentation[] {
	const turns = new Map(state.turns.map(turn => [turn.id, turn]));
	const keys = new Set<string>();
	return Object.freeze(presentations.map(rawPresentation => {
		const presentation = parseChatHostPresentation(rawPresentation);
		const turn = turns.get(presentation.turn);
		const key = hostPresentationKey(presentation);
		if (presentation.session !== identity.session
			|| presentation.chat !== identity.chat
			|| !turn
			|| turn.behaviors[presentation.behaviorIndex] === undefined) {
			throw new Error(`Host presentation '${key}' does not match canonical Host history.`);
		}
		if (keys.has(key)) {
			throw new Error(`Host presentation '${key}' is duplicated.`);
		}
		keys.add(key);
		return presentation;
	}));
}

function mergeHostPresentations(
	projected: readonly IChatHostPresentation[],
	sources: readonly (readonly IChatHostPresentation[])[],
): readonly IChatHostPresentation[] {
	const ordered: IChatHostPresentation[] = [];
	const byKey = new Map<string, IChatHostPresentation>();
	for (const presentation of projected) {
		const key = hostPresentationKey(presentation);
		if (byKey.has(key)) {
			throw new Error(`Projected Host presentation '${key}' is duplicated.`);
		}
		byKey.set(key, presentation);
		ordered.push(presentation);
	}
	for (const source of sources) {
		for (const rawPresentation of source) {
			const presentation = parseChatHostPresentation(rawPresentation);
			const key = hostPresentationKey(presentation);
			const candidate = byKey.get(key);
			if (candidate) {
				if (hostPresentationContentKey(candidate) !== hostPresentationContentKey(presentation)) {
					throw new Error(`Host presentation '${key}' conflicts with canonical Host history.`);
				}
				continue;
			}
			byKey.set(key, presentation);
			ordered.push(presentation);
		}
	}
	return Object.freeze(ordered);
}

function requireComposerRevision(value: number | undefined): number {
	const revision = value ?? 0;
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new TypeError('A Chat composer revision must be a non-negative safe integer.');
	}
	return revision;
}

function nextComposerRevision(revision: number): number {
	if (revision === Number.MAX_SAFE_INTEGER) {
		throw new RangeError('A Chat composer revision cannot advance beyond Number.MAX_SAFE_INTEGER.');
	}
	return revision + 1;
}

function requireMutableComposer(resource: URI, snapshot: IChatModelSnapshot): void {
	if (snapshot.preparingSubmission) {
		throw new Error(
			`Chat composer '${resource.toString()}' is preparing submission '${snapshot.preparingSubmission.id}'.`,
		);
	}
}

function createInitialSnapshot(initialState: IChatModelInitialState | undefined): IChatModelSnapshot {
	const pendingAttachments = (initialState?.pendingAttachments ?? []).map(capturePendingChatAttachment);
	if (pendingAttachments.length > maximumPendingChatAttachments) {
		throw new RangeError(`A Chat composer accepts at most ${maximumPendingChatAttachments} attachments.`);
	}
	if (new Set(pendingAttachments.map(attachment => attachment.id)).size !== pendingAttachments.length) {
		throw new Error('A restored Chat composer contains duplicate attachment IDs.');
	}

	const interactionTargets = (initialState?.interactionTargets ?? []).map(captureInteractionTarget);
	if (interactionTargets.length > maximumPendingChatInteractionTargets) {
		throw new RangeError(
			`A Chat composer accepts at most ${maximumPendingChatInteractionTargets} interaction targets.`,
		);
	}
	if (new Set(interactionTargets.map(target => target.id)).size !== interactionTargets.length) {
		throw new Error('A restored Chat composer contains duplicate interaction-target IDs.');
	}

	return {
		hostState: undefined,
		hostPresentations: [],
		input: initialState?.input ?? '',
		composerRevision: requireComposerRevision(initialState?.composerRevision),
		pendingAttachments,
		interactionTargets,
		preparingSubmission: undefined,
		errorMessage: initialState?.errorMessage,
	};
}

class ChatModel extends Disposable implements IChatModel {
	private readonly onDidChangeEmitter = this._register(new EventEmitter<void>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChange = this.onDidChangeEmitter.event;
	private snapshot: IChatModelSnapshot;
	private hostIdentity: IChatHostModelIdentity | undefined;
	private isDisposed = false;

	constructor(
		readonly resource: URI,
		initialState: IChatModelInitialState | undefined,
	) {
		super();
		this.snapshot = freezeStructuredValue(createInitialSnapshot(initialState));
	}

	getSnapshot(): IChatModelSnapshot {
		this.assertNotDisposed();
		return this.snapshot;
	}

	getHostPresentation(identity: IChatHostPresentationIdentity): IChatHostPresentation | undefined {
		this.assertNotDisposed();
		const session = createAgentSessionId(identity.session);
		const chat = createAgentChatId(identity.chat);
		const turn = createAgentTurnId(identity.turn);
		if (!Number.isSafeInteger(identity.behaviorIndex) || identity.behaviorIndex < 0) {
			throw new TypeError('Host presentation behavior index must be a non-negative safe integer.');
		}
		return this.snapshot.hostPresentations.find(presentation =>
			presentation.session === session
			&& presentation.chat === chat
			&& presentation.turn === turn
			&& presentation.behaviorIndex === identity.behaviorIndex,
		);
	}

	update(updater: (snapshot: IChatModelSnapshot) => IChatModelSnapshot): void {
		this.assertNotDisposed();
		const nextSnapshot = updater(this.snapshot);
		if (Object.is(nextSnapshot, this.snapshot)) {
			return;
		}

		this.snapshot = freezeStructuredValue(nextSnapshot);
		this.onDidChangeEmitter.fire();
	}

	getHostIdentity(): IChatHostModelIdentity | undefined {
		return this.hostIdentity;
	}

	validateHostState(identity: IChatHostModelIdentity, state: IAgentHostChatState): IChatHostModelIdentity {
		assertAgentHostChatState(state);
		const session = createAgentSessionId(identity.session);
		const chat = createAgentChatId(identity.chat);
		if (state.session !== session || state.id !== chat) {
			throw new Error(
				`Agent Host Chat state '${state.session}/${state.id}' does not match model binding '${session}/${chat}'.`,
			);
		}
		if (this.hostIdentity
			&& (this.hostIdentity.session !== session || this.hostIdentity.chat !== chat)) {
			throw new Error(
				`Chat model '${this.resource.toString()}' is already bound to `
				+ `'${this.hostIdentity.session}/${this.hostIdentity.chat}'.`,
			);
		}
		return Object.freeze({ session, chat });
	}

	replaceHostState(
		identity: IChatHostModelIdentity,
		state: IAgentHostChatState,
		hostPresentations: readonly IChatHostPresentation[],
	): void {
		const validatedIdentity = this.validateHostState(identity, state);
		const capturedState = freezeStructuredValue(cloneStructuredValue(state));
		const capturedPresentations = validateHostPresentations(
			validatedIdentity,
			capturedState,
			hostPresentations,
		);
		this.update(snapshot => ({
			...snapshot,
			hostState: capturedState,
			hostPresentations: capturedPresentations,
		}));
		this.hostIdentity ??= validatedIdentity;
	}

	replaceHostPresentations(
		identity: IChatHostModelIdentity,
		hostPresentations: readonly IChatHostPresentation[],
	): void {
		const state = this.snapshot.hostState;
		if (!state) {
			throw new Error(`Chat model '${this.resource.toString()}' has no canonical Host state.`);
		}
		const validatedIdentity = this.validateHostState(identity, state);
		const capturedPresentations = validateHostPresentations(
			validatedIdentity,
			state,
			hostPresentations,
		);
		this.update(snapshot => ({ ...snapshot, hostPresentations: capturedPresentations }));
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		super.dispose();
	}

	private assertNotDisposed(): void {
		if (this.isDisposed) {
			throw new Error(`Chat model has been disposed: ${this.resource.toString()}`);
		}
	}
}

export class ChatService implements IChatService {
	declare readonly _serviceBrand: undefined;

	private readonly models = new Map<string, ILiveChatModel>();
	private readonly attachmentProducers = new ChatAttachmentProducerRegistry();
	private readonly hostPresentationProviders = new Map<AgentToolId, IChatHostPresentationProvider>();
	private readonly persistedChats = new Map<string, IChatPersistedResourceState>();
	private persistedState: IChatPersistedState | undefined;
	private readonly onDidDeleteModelEmitter = new EventEmitter<URI>({
		onListenerError: onUnexpectedError,
	});
	readonly onDidDeleteModel = this.onDidDeleteModelEmitter.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		this.attachmentProducers.register(ChatTextAttachmentProducer);
		this.attachmentProducers.register(ChatSelectionAttachmentProducer);
		this.attachmentProducers.register(ChatImageAttachmentProducer);
		this.persistedState = parseChatPersistedState(
			storageService.get(ChatPersistenceStorageKey, StorageScope.APPLICATION),
		);
		for (const chat of this.persistedState?.chats ?? []) {
			this.persistedChats.set(getComparisonKey(URI.parse(chat.resource)), chat);
		}
	}

	createModel(
		resource: URI,
		initialState?: IChatModelInitialState,
	): IChatModelOwnerReference {
		const resourceKey = getComparisonKey(resource);
		if (this.models.has(resourceKey)) {
			throw new Error(`Chat model already exists: ${resource.toString()}`);
		}

		const persisted = this.persistedChats.get(resourceKey);
		if (persisted && persisted.resource !== resource.toString(true)) {
			throw new Error(
				`Persisted Chat resource '${persisted.resource}' conflicts with '${resource.toString(true)}'.`,
			);
		}
		if (persisted && initialState && [
			'input',
			'composerRevision',
			'pendingAttachments',
			'interactionTargets',
		].some(key => Object.hasOwn(initialState, key))) {
			throw new Error(`Chat model '${resource.toString()}' has conflicting restored composer state.`);
		}
		const restoredInitialState = persisted
			? {
				...initialState,
				input: persisted.composer.input,
				composerRevision: persisted.composer.revision,
				pendingAttachments: persisted.composer.attachments,
				interactionTargets: persisted.composer.interactionTargets,
			}
			: initialState;
		for (const attachment of persisted?.composer.attachments ?? []) {
			if (this.attachmentProducers.has(attachment.producerType)) {
				this.attachmentProducers.validate(attachment);
			}
		}

		const model = new ChatModel(resource, restoredInitialState);
		const liveModel: ILiveChatModel = {
			model,
			persistenceListener: model.onDidChange(() => this.persistModel(model)),
			referenceCount: 0,
			permanentlyDeleted: false,
		};
		this.models.set(resourceKey, liveModel);
		this.persistModel(model);
		return this.createOwnerReference(resourceKey, liveModel);
	}

	acquireModel(resource: URI): IChatModelReference {
		const resourceKey = getComparisonKey(resource);
		const liveModel = this.models.get(resourceKey);
		if (!liveModel) {
			throw new Error(`Chat model does not exist: ${resource.toString()}`);
		}

		return this.createReference(resourceKey, liveModel);
	}

	registerAttachmentProducer(producer: IChatAttachmentProducer): IDisposable {
		if (this.attachmentProducers.has(producer.type)) {
			throw new Error(`Chat attachment producer '${producer.type}' is already registered.`);
		}
		for (const { model } of this.models.values()) {
			for (const attachment of model.getSnapshot().pendingAttachments) {
				if (attachment.producerType !== producer.type) {
					continue;
				}
				if (attachment.producerStateVersion !== producer.stateVersion) {
					throw new Error(
						`Stored Chat attachment '${attachment.id}' uses producer-state version `
						+ `${attachment.producerStateVersion}; producer '${producer.type}' requires ${producer.stateVersion}.`,
					);
				}
				producer.validateState(attachment.state);
			}
		}
		return this.attachmentProducers.register(producer);
	}

	registerHostPresentationProvider(provider: IChatHostPresentationProvider): IDisposable {
		const tool = createAgentToolId(provider.tool);
		if (typeof provider.project !== 'function') {
			throw new TypeError(`Host presentation provider '${tool}' is invalid.`);
		}
		if (this.hostPresentationProviders.has(tool)) {
			throw new Error(`Host presentation provider '${tool}' is already registered.`);
		}

		this.hostPresentationProviders.set(tool, provider);
		const prepared: {
			readonly model: ChatModel;
			readonly identity: IChatHostModelIdentity;
			readonly presentations: readonly IChatHostPresentation[];
		}[] = [];
		try {
			for (const { model } of this.models.values()) {
				const snapshot = model.getSnapshot();
				const identity = model.getHostIdentity();
				if (!snapshot.hostState || !identity) {
					continue;
				}
				const projected = this.projectHostPresentations(
					identity,
					snapshot.hostState,
					snapshot.hostPresentations,
				);
				prepared.push({
					model,
					identity,
					presentations: mergeHostPresentations(projected, [
						snapshot.hostPresentations,
					]),
				});
			}
		} catch (error) {
			this.hostPresentationProviders.delete(tool);
			throw error;
		}
		for (const item of prepared) {
			item.model.replaceHostPresentations(item.identity, item.presentations);
		}

		let registered = true;
		return toDisposable(() => {
			if (!registered) {
				return;
			}
			registered = false;
			if (this.hostPresentationProviders.get(tool) === provider) {
				this.hostPresentationProviders.delete(tool);
			}
		});
	}

	updateHostPresentation(resource: URI, update: IChatHostPresentationUpdate): void {
		const expected = parseChatHostPresentation({
			schemaVersion: ChatHostPresentationSchemaVersion,
			...update.identity,
			type: update.type,
			value: update.expectedValue,
		});
		const replacement = parseChatHostPresentation({
			schemaVersion: ChatHostPresentationSchemaVersion,
			...update.identity,
			type: update.type,
			value: update.value,
		});
		const model = this.getModel(resource);
		const identity = model.getHostIdentity();
		const state = model.getSnapshot().hostState;
		if (!identity || !state) {
			throw new Error(`Chat model '${resource.toString()}' has no canonical Host binding.`);
		}
		model.update(snapshot => {
			const key = hostPresentationKey(expected);
			const current = snapshot.hostPresentations.find(presentation =>
				hostPresentationKey(presentation) === key,
			);
			if (!current
				|| current.type !== expected.type
				|| hostPresentationContentKey(current) !== hostPresentationContentKey(expected)) {
				throw new Error(`Host presentation '${key}' changed before its Feature update committed.`);
			}
			return {
				...snapshot,
				hostPresentations: snapshot.hostPresentations.map(presentation =>
					presentation === current ? replacement : presentation,
				),
			};
		});
	}

	setInput(resource: URI, value: string): void {
		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.input === value && snapshot.errorMessage === undefined) {
				return snapshot;
			}

			return {
				...snapshot,
				input: value,
				composerRevision: snapshot.input === value
					? snapshot.composerRevision
					: nextComposerRevision(snapshot.composerRevision),
				errorMessage: undefined,
			};
		});
	}

	addComposerContext(
		resource: URI,
		attachments: readonly IPendingChatAttachment[],
		targets: readonly IAgentHostInteractionTarget[],
	): void {
		if (attachments.length === 0 || targets.length === 0) {
			throw new Error('An atomic Chat composer context requires attachments and interaction targets.');
		}
		const capturedAttachments = attachments.map(capturePendingChatAttachment);
		for (const attachment of capturedAttachments) {
			this.attachmentProducers.validate(attachment);
		}
		const attachmentIds = capturedAttachments.map(attachment => attachment.id);
		if (new Set(attachmentIds).size !== attachmentIds.length) {
			throw new Error('A Chat composer context contains duplicate attachment IDs.');
		}
		const capturedTargets = targets.map(captureInteractionTarget);
		const targetIds = capturedTargets.map(target => target.id);
		if (new Set(targetIds).size !== targetIds.length) {
			throw new Error('A Chat composer context contains duplicate interaction-target IDs.');
		}

		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.pendingAttachments.length + capturedAttachments.length > maximumPendingChatAttachments) {
				throw new RangeError(`A Chat composer accepts at most ${maximumPendingChatAttachments} attachments.`);
			}
			if (snapshot.interactionTargets.length + capturedTargets.length > maximumPendingChatInteractionTargets) {
				throw new RangeError(
					`A Chat composer accepts at most ${maximumPendingChatInteractionTargets} interaction targets.`,
				);
			}
			const existingAttachmentIds = new Set(snapshot.pendingAttachments.map(attachment => attachment.id));
			const duplicateAttachment = capturedAttachments.find(attachment =>
				existingAttachmentIds.has(attachment.id),
			);
			if (duplicateAttachment) {
				throw new Error(`Chat attachment '${duplicateAttachment.id}' is already pending.`);
			}
			const existingTargetIds = new Set(snapshot.interactionTargets.map(target => target.id));
			const duplicateTarget = capturedTargets.find(target => existingTargetIds.has(target.id));
			if (duplicateTarget) {
				throw new Error(`Chat interaction target '${duplicateTarget.id}' is already bound.`);
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				pendingAttachments: [...snapshot.pendingAttachments, ...capturedAttachments],
				interactionTargets: [...snapshot.interactionTargets, ...capturedTargets],
				errorMessage: undefined,
			};
		});
	}

	addPendingAttachments(resource: URI, attachments: readonly IPendingChatAttachment[]): void {
		if (attachments.length === 0) {
			return;
		}
		const captured = attachments.map(attachment => capturePendingChatAttachment(attachment));
		for (const attachment of captured) {
			this.attachmentProducers.validate(attachment);
		}
		const capturedIds = captured.map(attachment => attachment.id);
		if (new Set(capturedIds).size !== capturedIds.length) {
			throw new Error('A pending Chat attachment batch contains duplicate attachment IDs.');
		}

		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.pendingAttachments.length + captured.length > maximumPendingChatAttachments) {
				throw new RangeError(`A Chat composer accepts at most ${maximumPendingChatAttachments} attachments.`);
			}
			const existingIds = new Set(snapshot.pendingAttachments.map(attachment => attachment.id));
			const duplicate = captured.find(attachment => existingIds.has(attachment.id));
			if (duplicate) {
				throw new Error(`Chat attachment '${duplicate.id}' is already pending.`);
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				pendingAttachments: [...snapshot.pendingAttachments, ...captured],
				errorMessage: undefined,
			};
		});
	}

	removePendingAttachment(resource: URI, attachmentId: IPendingChatAttachment['id']): void {
		let discarded: IPendingChatAttachment | undefined;
		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			discarded = snapshot.pendingAttachments.find(attachment => attachment.id === attachmentId);
			if (!discarded) {
				throw new Error(`Chat attachment '${attachmentId}' is not pending.`);
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				pendingAttachments: snapshot.pendingAttachments.filter(attachment => attachment !== discarded),
			};
		});
		this.attachmentProducers.discard(discarded!);
	}

	clearPendingAttachments(resource: URI): void {
		let discarded: readonly IPendingChatAttachment[] = [];
		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.pendingAttachments.length === 0) {
				return snapshot;
			}
			discarded = snapshot.pendingAttachments;
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				pendingAttachments: [],
			};
		});
		this.attachmentProducers.discardAll(discarded);
	}

	addInteractionTargets(resource: URI, targets: readonly IAgentHostInteractionTarget[]): void {
		if (targets.length === 0) {
			return;
		}
		const captured = targets.map(captureInteractionTarget);
		const capturedIds = captured.map(target => target.id);
		if (new Set(capturedIds).size !== capturedIds.length) {
			throw new Error('A Chat interaction-target batch contains duplicate target IDs.');
		}

		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.interactionTargets.length + captured.length > maximumPendingChatInteractionTargets) {
				throw new RangeError(
					`A Chat composer accepts at most ${maximumPendingChatInteractionTargets} interaction targets.`,
				);
			}
			const existingIds = new Set(snapshot.interactionTargets.map(target => target.id));
			const duplicate = captured.find(target => existingIds.has(target.id));
			if (duplicate) {
				throw new Error(`Chat interaction target '${duplicate.id}' is already bound.`);
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				interactionTargets: [...snapshot.interactionTargets, ...captured],
				errorMessage: undefined,
			};
		});
	}

	removeInteractionTarget(resource: URI, targetId: IAgentHostInteractionTarget['id']): void {
		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			const interactionTargets = snapshot.interactionTargets.filter(target => target.id !== targetId);
			if (interactionTargets.length === snapshot.interactionTargets.length) {
				throw new Error(`Chat interaction target '${targetId}' is not bound.`);
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				interactionTargets,
			};
		});
	}

	clearInteractionTargets(resource: URI): void {
		this.updateModel(resource, snapshot => {
			requireMutableComposer(resource, snapshot);
			if (snapshot.interactionTargets.length === 0) {
				return snapshot;
			}
			return {
				...snapshot,
				composerRevision: nextComposerRevision(snapshot.composerRevision),
				interactionTargets: [],
			};
		});
	}

	async prepareSubmission(
		resource: URI,
		submissionId: AgentSubmissionId,
		token: CancellationToken,
	): Promise<IPreparedChatSubmission> {
		const capturedSubmissionId = createAgentSubmissionId(submissionId);
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}

		const resourceKey = getComparisonKey(resource);
		const liveModel = this.models.get(resourceKey);
		if (!liveModel) {
			throw new Error(`Chat model does not exist: ${resource.toString()}`);
		}
		const model = liveModel.model;
		const initialSnapshot = model.getSnapshot();
		requireMutableComposer(resource, initialSnapshot);
		if (!initialSnapshot.input.trim()) {
			throw new Error('A Chat submission requires a non-empty prompt.');
		}

		const capture: IChatSubmissionCapture = freezeStructuredValue({
			submissionId: capturedSubmissionId,
			composerRevision: initialSnapshot.composerRevision,
			prompt: initialSnapshot.input,
			attachments: [...initialSnapshot.pendingAttachments],
			interactionTargets: [...initialSnapshot.interactionTargets],
		});
		model.update(snapshot => {
			if (snapshot !== initialSnapshot) {
				throw new Error(`Chat composer changed before preparation began: ${resource.toString()}`);
			}
			return {
				...snapshot,
				preparingSubmission: {
					id: capturedSubmissionId,
					composerRevision: capture.composerRevision,
				},
				errorMessage: undefined,
			};
		});
		const preparationReference = this.createReference(resourceKey, liveModel);

		let preparedAttachments: IPreparedChatAttachments | undefined;
		try {
			preparedAttachments = await prepareChatAttachments(
				this.attachmentProducers,
				resource,
				capture,
				token,
			);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			if (preparedAttachments) {
				try {
					await preparedAttachments.release();
				} catch (releaseError) {
					cleanupErrors.push(releaseError);
				}
			}
			try {
				this.clearPreparingSubmission(model, capturedSubmissionId, capture.composerRevision);
			} catch (stateError) {
				cleanupErrors.push(stateError);
			}
			try {
				preparationReference.dispose();
			} catch (referenceError) {
				cleanupErrors.push(referenceError);
			}
			if (cleanupErrors.length === 0) {
				throw error;
			}
			throw new AggregateError(
				[error, ...cleanupErrors],
				`Failed to discard Chat submission '${capturedSubmissionId}' preparation.`,
			);
		}
		if (!preparedAttachments) {
			preparationReference.dispose();
			throw new Error(`Chat submission '${capturedSubmissionId}' completed without prepared attachments.`);
		}

		let active = true;
		const finish = async (accepted: boolean): Promise<void> => {
			if (!active) {
				throw new Error(`Prepared Chat submission '${capturedSubmissionId}' is no longer active.`);
			}
			active = false;
			const finishErrors: unknown[] = [];
			let acceptedComposer = false;
			try {
				if (accepted) {
					model.update(snapshot => {
						this.requirePreparingSubmission(
							resource,
							snapshot,
							capturedSubmissionId,
							capture.composerRevision,
						);
						return {
							...snapshot,
							input: '',
							composerRevision: nextComposerRevision(snapshot.composerRevision),
							pendingAttachments: [],
							interactionTargets: [],
							preparingSubmission: undefined,
							errorMessage: undefined,
						};
					});
					acceptedComposer = true;
				} else {
					this.clearPreparingSubmission(model, capturedSubmissionId, capture.composerRevision);
				}
			} catch (error) {
				finishErrors.push(error);
			}

			if (acceptedComposer) {
				try {
					this.attachmentProducers.discardAll(capture.attachments);
				} catch (discardError) {
					finishErrors.push(discardError);
				}
			}

			try {
				await preparedAttachments.release();
			} catch (releaseError) {
				finishErrors.push(releaseError);
			}
			try {
				preparationReference.dispose();
			} catch (referenceError) {
				finishErrors.push(referenceError);
			}
			if (finishErrors.length === 1) {
				throw finishErrors[0];
			}
			if (finishErrors.length > 1) {
				throw new AggregateError(
					finishErrors,
					`Failed to finish Chat submission '${capturedSubmissionId}'.`,
				);
			}
		};

		return Object.freeze({
			capture,
			attachments: preparedAttachments.attachments,
			interactionTargets: capture.interactionTargets,
			accept: () => finish(true),
			reject: () => finish(false),
		});
	}

	private requirePreparingSubmission(
		resource: URI,
		snapshot: IChatModelSnapshot,
		submissionId: AgentSubmissionId,
		composerRevision: number,
	): void {
		const preparing = snapshot.preparingSubmission;
		if (!preparing
			|| preparing.id !== submissionId
			|| preparing.composerRevision !== composerRevision
			|| snapshot.composerRevision !== composerRevision) {
			throw new Error(
				`Chat submission '${submissionId}' no longer owns composer revision ${composerRevision} `
				+ `for ${resource.toString()}.`,
			);
		}
	}

	private clearPreparingSubmission(
		model: ChatModel,
		submissionId: AgentSubmissionId,
		composerRevision: number,
	): void {
		model.update(snapshot => {
			this.requirePreparingSubmission(
				model.resource,
				snapshot,
				submissionId,
				composerRevision,
			);
			return { ...snapshot, preparingSubmission: undefined };
		});
	}

	private createReference(resourceKey: string, liveModel: ILiveChatModel): IChatModelReference {
		if (liveModel.permanentlyDeleted) {
			throw new Error(`Chat model was permanently deleted: ${liveModel.model.resource.toString()}`);
		}
		liveModel.referenceCount += 1;
		let isDisposed = false;
		return {
			object: liveModel.model,
			dispose: () => {
				if (isDisposed) {
					return;
				}

				isDisposed = true;
				liveModel.referenceCount -= 1;
				if (liveModel.referenceCount > 0) {
					return;
				}

				if (!liveModel.permanentlyDeleted) {
					if (this.models.get(resourceKey) !== liveModel) {
						throw new Error(`Chat model registry ownership changed: ${liveModel.model.resource.toString()}`);
					}
					this.models.delete(resourceKey);
				}

				liveModel.persistenceListener.dispose();
				liveModel.model.dispose();
			},
		};
	}

	private createOwnerReference(
		resourceKey: string,
		liveModel: ILiveChatModel,
	): IChatModelOwnerReference {
		const reference = this.createReference(resourceKey, liveModel);
		let isDisposed = false;
		return {
			object: reference.object,
			replaceHostState: (identity, state) => {
				if (isDisposed) {
					throw new Error(`Chat model owner is disposed: ${liveModel.model.resource.toString()}`);
				}
				this.replaceHostState(liveModel.model, identity, state);
			},
			importHostPresentations: (identity, presentations) => {
				if (isDisposed) {
					throw new Error(`Chat model owner is disposed: ${liveModel.model.resource.toString()}`);
				}
				this.importHostPresentations(liveModel.model, identity, presentations);
			},
			delete: () => {
				if (isDisposed) {
					throw new Error(`Chat model owner is disposed: ${liveModel.model.resource.toString()}`);
				}
				if (liveModel.model.getSnapshot().preparingSubmission) {
					throw new Error(
						`Chat model cannot be deleted while preparing a submission: ${liveModel.model.resource.toString()}`,
					);
				}
				isDisposed = true;
				try {
					this.deleteModel(resourceKey, liveModel);
				} finally {
					reference.dispose();
				}
			},
			dispose: () => {
				if (isDisposed) {
					return;
				}
				isDisposed = true;
				reference.dispose();
			},
		};
	}

	private replaceHostState(
		model: ChatModel,
		identity: IChatHostModelIdentity,
		state: IAgentHostChatState,
	): void {
		const validatedIdentity = model.validateHostState(identity, state);
		const stored = this.persistedChats.get(getComparisonKey(model.resource));
		const retained = validateHostPresentations(
			validatedIdentity,
			state,
			mergeHostPresentations([], [
				model.getSnapshot().hostPresentations,
				...(stored ? [stored.presentations] : []),
			]),
		);
		const projected = this.projectHostPresentations(validatedIdentity, state, retained);
		model.replaceHostState(
			validatedIdentity,
			state,
			mergeHostPresentations(projected, [retained]),
		);
	}

	private importHostPresentations(
		model: ChatModel,
		identity: IChatHostModelIdentity,
		presentations: readonly IChatHostPresentation[],
	): void {
		const state = model.getSnapshot().hostState;
		if (!state) {
			throw new Error(`Chat model '${model.resource.toString()}' has no canonical Host state.`);
		}
		const validatedIdentity = model.validateHostState(identity, state);
		const retained = validateHostPresentations(validatedIdentity, state, mergeHostPresentations([], [
			model.getSnapshot().hostPresentations,
			presentations,
		]));
		const projected = this.projectHostPresentations(validatedIdentity, state, retained);
		model.replaceHostPresentations(
			validatedIdentity,
			mergeHostPresentations(projected, [retained]),
		);
	}

	private projectHostPresentations(
		identity: IChatHostModelIdentity,
		state: IAgentHostChatState,
		persisted: readonly IChatHostPresentation[],
	): readonly IChatHostPresentation[] {
		if (state.id !== identity.chat || state.session !== identity.session) {
			throw new Error(`Canonical Host state does not match '${identity.session}/${identity.chat}'.`);
		}
		const persistedByKey = new Map(persisted.map(presentation => [
			hostPresentationKey(presentation),
			presentation,
		]));
		const presentations: IChatHostPresentation[] = [];
		for (const turn of state.turns) {
			const calls = new Map(turn.behaviors.flatMap(behavior =>
				behavior.kind === 'contributedToolCall' ? [[behavior.call, behavior] as const] : [],
			));
			for (const [behaviorIndex, behavior] of turn.behaviors.entries()) {
				if (behavior.kind === 'contributedToolCall') {
					calls.set(behavior.call, behavior);
					continue;
				}
				if (behavior.kind !== 'contributedToolResult' || behavior.status !== 'completed') {
					continue;
				}
				const call = calls.get(behavior.call);
				if (!call) {
					throw new Error(`Completed Host Tool result '${behavior.call}' has no exact call.`);
				}
				const provider = this.hostPresentationProviders.get(call.tool);
				if (!provider) {
					continue;
				}
				if (!Object.hasOwn(behavior, 'output') || behavior.output === undefined) {
					throw new Error(`Completed Host Tool result '${behavior.call}' has no canonical output.`);
				}
				const output = behavior.output;
				const presentationIdentity = {
					session: identity.session,
					chat: identity.chat,
					turn: turn.id,
					behaviorIndex,
				};
				const persistedPresentation = persistedByKey.get(hostPresentationKey(presentationIdentity));
				const projection = parseChatHostPresentationProjection(provider.tool, provider.project({
					session: identity.session,
					chat: identity.chat,
					turn,
					behaviorIndex,
					call,
					result: { ...behavior, status: 'completed', output },
				}, persistedPresentation?.value));
				presentations.push(parseChatHostPresentation({
					schemaVersion: ChatHostPresentationSchemaVersion,
					session: identity.session,
					chat: identity.chat,
					turn: turn.id,
					behaviorIndex,
					type: projection.type,
					value: projection.value,
				}));
			}
		}
		return Object.freeze(presentations);
	}

	private persistModel(model: ChatModel): void {
		const resourceKey = getComparisonKey(model.resource);
		const snapshot = model.getSnapshot();
		const existing = this.persistedChats.get(resourceKey);
		const presentations = snapshot.hostState
			? snapshot.hostPresentations
			: existing?.presentations ?? [];
		const shouldPersist = snapshot.input.length > 0
			|| snapshot.pendingAttachments.length > 0
			|| snapshot.interactionTargets.length > 0
			|| presentations.length > 0;
		const next = shouldPersist
			? parseChatPersistedResourceState({
				resource: model.resource.toString(true),
				composer: {
					input: snapshot.input,
					revision: snapshot.composerRevision,
					attachments: snapshot.pendingAttachments,
					interactionTargets: snapshot.interactionTargets,
				},
				presentations,
			})
			: undefined;
		if (JSON.stringify(existing) === JSON.stringify(next)) {
			return;
		}
		if (next) {
			this.persistedChats.set(resourceKey, next);
		} else {
			this.persistedChats.delete(resourceKey);
		}
		this.commitPersistedChats();
	}

	private deleteModel(resourceKey: string, liveModel: ILiveChatModel): void {
		if (liveModel.permanentlyDeleted
			|| this.models.get(resourceKey) !== liveModel) {
			throw new Error(`Chat model cannot be permanently deleted: ${liveModel.model.resource.toString()}`);
		}
		liveModel.permanentlyDeleted = true;
		liveModel.persistenceListener.dispose();
		this.models.delete(resourceKey);
		if (this.persistedChats.delete(resourceKey)) {
			this.commitPersistedChats();
		}
		this.onDidDeleteModelEmitter.fire(liveModel.model.resource);
		this.attachmentProducers.discardAll(liveModel.model.getSnapshot().pendingAttachments);
	}

	private commitPersistedChats(): void {
		if (this.persistedState?.revision === Number.MAX_SAFE_INTEGER) {
			throw new RangeError('Persisted Chat state revision cannot advance further.');
		}
		const nextState: IChatPersistedState = Object.freeze({
			schemaVersion: ChatPersistenceSchemaVersion,
			revision: this.persistedState ? this.persistedState.revision + 1 : 0,
			chats: Object.freeze(
				[...this.persistedChats.values()].sort((left, right) =>
					left.resource.localeCompare(right.resource),
				),
			),
			completedMigrations: this.persistedState?.completedMigrations ?? Object.freeze([]),
		});
		this.storageService.store(
			ChatPersistenceStorageKey,
			serializeChatPersistedState(nextState),
			StorageScope.APPLICATION,
			StorageTarget.USER,
		);
		this.persistedState = nextState;
	}

	private getModel(resource: URI): ChatModel {
		const liveModel = this.models.get(getComparisonKey(resource));
		if (!liveModel) {
			throw new Error(`Chat model does not exist: ${resource.toString()}`);
		}

		return liveModel.model;
	}

	private updateModel(
		resource: URI,
		updater: (snapshot: IChatModelSnapshot) => IChatModelSnapshot,
	): void {
		this.getModel(resource).update(updater);
	}

}

registerSingleton(IChatServiceDecorator, ChatService, InstantiationType.Delayed);
