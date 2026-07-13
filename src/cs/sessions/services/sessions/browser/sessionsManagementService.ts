/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, DisposableMap, DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import { derived, observableValue, type IObservable } from 'cs/base/common/observable';
import { getComparisonKey, isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IStorageService } from 'cs/platform/storage/common/storage';
import {
	ISessionsProvidersService,
	type IPreparedSessionsProvidersChange,
	type ISessionsProvidersChangeEvent,
	type ISessionsProvidersChangeParticipant,
} from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { SessionsRecencyStorage } from 'cs/sessions/services/sessions/browser/sessionsRecencyStorage';
import {
	assertSessionInvariants,
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
	type ISessionResolvedWorkspaceState,
	type ISessionType,
	type SessionId,
	SessionStatus,
	SessionWorkspaceKind,
	type SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import {
	ISessionsManagementService,
	SessionDraftChangeKind,
	type IProviderSessionType,
	type ISessionChatOwner,
	type ISessionDraftChangeEvent,
	type ISessionsManagementChangeEvent,
	type ISessionsModelsChangeEvent,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import {
	SessionTransitionKind,
	type ISessionDraftOptions,
	type ISessionModel,
	type ISessionsChangeEvent,
	type ISessionsProvider,
} from 'cs/sessions/services/sessions/common/sessionsProvider';

interface ISessionsManagementState {
	readonly sessions: readonly ISession[];
	readonly draftSession: ISession | undefined;
	readonly sessionTypes: readonly IProviderSessionType[];
}

interface IAuthoritativeChangedTransitionTracker {
	readonly provider: ISessionsProvider;
	readonly session: ISession;
	readonly chatResourceSnapshots: string[][];
}

/** Default provider-independent Sessions domain owner. */
export class SessionsManagementService extends Disposable implements ISessionsManagementService, ISessionsProvidersChangeParticipant {
	declare readonly _serviceBrand: undefined;

	private readonly providerSessions = new Map<SessionsProviderId, readonly ISession[]>();
	private readonly providerSessionTypes = new Map<SessionsProviderId, readonly ISessionType[]>();
	private readonly providerSubscriptions = this._register(new DisposableMap<SessionsProviderId, DisposableStore>());
	private readonly providers = new Map<SessionsProviderId, ISessionsProvider>();
	private readonly draftReplacements = new WeakMap<ISession, ISession>();
	private readonly changedTransitionTrackers = new Set<IAuthoritativeChangedTransitionTracker>();
	private readonly sessionCatalogMutations = new Map<SessionId, Promise<void>>();
	private readonly recencyStorage: SessionsRecencyStorage;

	private readonly state = observableValue<ISessionsManagementState>('sessionsManagementState', {
		sessions: [],
		draftSession: undefined,
		sessionTypes: [],
	});

	readonly sessions: IObservable<readonly ISession[]> = derived(this, reader => this.state.read(reader).sessions);
	readonly draftSession: IObservable<ISession | undefined> = derived(this, reader => this.state.read(reader).draftSession);
	readonly sessionTypes: IObservable<readonly IProviderSessionType[]> = derived(this, reader => this.state.read(reader).sessionTypes);

	private readonly sessionsChangeEmitter = this._register(new Emitter<ISessionsManagementChangeEvent>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeSessions: Event<ISessionsManagementChangeEvent> = this.sessionsChangeEmitter.event;

	private readonly draftSessionChangeEmitter = this._register(new Emitter<ISessionDraftChangeEvent>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeDraftSession: Event<ISessionDraftChangeEvent> = this.draftSessionChangeEmitter.event;

	private readonly sessionTypesChangeEmitter = this._register(new Emitter<void>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeSessionTypes: Event<void> = this.sessionTypesChangeEmitter.event;

	private readonly modelsChangeEmitter = this._register(new Emitter<ISessionsModelsChangeEvent>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeModels: Event<ISessionsModelsChangeEvent> = this.modelsChangeEmitter.event;

	constructor(
		@ISessionsProvidersService private readonly sessionsProvidersService: ISessionsProvidersService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		this.recencyStorage = this._register(new SessionsRecencyStorage(storageService));

		const providers = this.sessionsProvidersService.getProviders();
		const initialSessions = new Map<SessionsProviderId, readonly ISession[]>();
		const initialSessionTypes = new Map<SessionsProviderId, readonly ISessionType[]>();
		for (const provider of providers) {
			const sessionTypes = this.snapshotProviderSessionTypes(provider);
			const sessions = [...provider.getSessions()];
			this.assertProviderSnapshot(provider, sessions, sessionTypes);
			initialSessions.set(provider.id, sessions);
			initialSessionTypes.set(provider.id, sessionTypes);
		}
		this.assertGlobalState(initialSessions, undefined);

		const preparedSubscriptions = new Map<SessionsProviderId, DisposableStore>();
		let participantSubscription: IDisposable | undefined;
		try {
			for (const provider of providers) {
				preparedSubscriptions.set(provider.id, this.createProviderSubscription(provider));
			}
			participantSubscription = this.sessionsProvidersService.registerChangeParticipant(this);
			const initialCommittedSessions = this.commitSessions(initialSessions);

			for (const provider of providers) {
				this.providerSessions.set(provider.id, initialSessions.get(provider.id)!);
				this.providerSessionTypes.set(provider.id, initialSessionTypes.get(provider.id)!);
				this.providers.set(provider.id, provider);
				this.providerSubscriptions.set(provider.id, preparedSubscriptions.get(provider.id)!);
				preparedSubscriptions.delete(provider.id);
			}
			this.state.set({
				sessions: initialCommittedSessions,
				draftSession: undefined,
				sessionTypes: this.collectSessionTypes(this.providerSessionTypes),
			}, undefined);

			this._register(participantSubscription);
			participantSubscription = undefined;
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			try {
				participantSubscription?.dispose();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			try {
				this.providerSubscriptions.dispose();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			try {
				this.disposePreparedProviderSubscriptions(preparedSubscriptions);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			if (cleanupErrors.length > 0) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Failed to initialize and release Sessions provider management.',
				);
			}
			throw error;
		}
	}

	getSessions(): readonly ISession[] {
		return this.state.get().sessions;
	}

	getSession(sessionId: SessionId): ISession | undefined {
		return this.state.get().sessions.find(session => session.sessionId === sessionId);
	}

	getSessionByResource(providerId: SessionsProviderId, resource: URI): ISession | undefined {
		const resourceKey = getComparisonKey(resource);
		return this.state.get().sessions.find(session =>
			session.providerId === providerId && getComparisonKey(session.resource) === resourceKey,
		);
	}

	getSessionForChatResource(resource: URI): ISessionChatOwner | undefined {
		const resourceKey = getComparisonKey(resource);
		for (const session of this.state.get().sessions) {
			const chat = session.chats.get().find(candidate => getComparisonKey(candidate.resource) === resourceKey);
			if (chat) {
				return { session, chat };
			}
		}
		return undefined;
	}

	createSessionDraft(providerId: SessionsProviderId, options: ISessionDraftOptions): ISession {
		if (this.state.get().draftSession) {
			throw new Error('A Session draft is already active.');
		}

		const provider = this.requireProvider(providerId);
		this.assertProviderSnapshotMatchesTracked(provider);
		this.assertProviderSessionTypesMatchTracked(provider);
		const sessionType = this.requireTrackedProviderSessionTypes(provider).find(candidate => candidate.id === options.sessionType);
		if (!sessionType) {
			throw new Error(`Sessions provider '${provider.id}' does not offer Session type '${options.sessionType}'.`);
		}
		if (options.workspace.kind === SessionWorkspaceKind.WorkspaceLess && !sessionType.supportsWorkspaceLess) {
			throw new Error(`Session type '${sessionType.id}' does not support workspace-less drafts.`);
		}

		const draftSession = provider.createSessionDraft(options);
		try {
			this.assertProviderOwnsSession(provider, draftSession);
			assertSessionInvariants(draftSession);
			if (draftSession.sessionType !== options.sessionType) {
				throw new Error(`Sessions provider '${provider.id}' created a draft with the wrong Session type.`);
			}
			if (draftSession.status.get() !== SessionStatus.Draft) {
				throw new Error(`Sessions provider '${provider.id}' created a Session that is not a draft.`);
			}
			this.assertDraftWorkspace(draftSession, options.workspace);
			const draftChats = draftSession.chats.get();
			const draftChat = draftChats[0];
			if (draftChats.length !== 1
				|| !draftChat
				|| draftChat.origin.kind !== ChatOriginKind.User
				|| draftChat.interactivity.get() !== ChatInteractivity.Full) {
				throw new Error(`Session draft '${draftSession.sessionId}' must contain one interactive user Chat.`);
			}
			this.assertProviderSnapshotMatchesTracked(provider);
			this.assertGlobalState(this.providerSessions, draftSession);
		} catch (error) {
			try {
				provider.discardSessionDraft(draftSession);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					`Sessions provider '${provider.id}' failed to release an invalid Session draft.`,
				);
			}
			throw error;
		}

		const previousState = this.state.get();
		this.state.set({ ...previousState, draftSession }, undefined);
		this.draftSessionChangeEmitter.fire({
			kind: SessionDraftChangeKind.Created,
			from: undefined,
			to: draftSession,
		});
		return draftSession;
	}

	discardSessionDraft(session: ISession): void {
		if (this.state.get().draftSession !== session) {
			throw new Error(`Session '${session.sessionId}' is not the active draft.`);
		}
		const provider = this.requireProvider(session.providerId);
		this.assertProviderOwnsSession(provider, session);
		assertSessionInvariants(session);
		this.assertProviderSnapshotMatchesTracked(provider);

		provider.discardSessionDraft(session);
		if (this.state.get().draftSession !== session) {
			throw new Error(`Sessions provider '${provider.id}' replaced the draft while discarding it.`);
		}
		this.assertProviderSnapshotMatchesTracked(provider);

		const previousState = this.state.get();
		this.state.set({ ...previousState, draftSession: undefined }, undefined);
		this.draftSessionChangeEmitter.fire({
			kind: SessionDraftChangeKind.Discarded,
			from: session,
			to: undefined,
		});
	}

	getModels(session: ISession, chat: IChat): readonly ISessionModel[] {
		const { provider } = this.requireOwnedSession(session, true);
		this.requireChat(session, chat);
		if (!session.capabilities.get().supportsModels) {
			throw new Error(`Session '${session.sessionId}' does not support model selection.`);
		}

		const models = [...provider.getModels(session, chat)];
		this.assertModels(provider, models);
		return models;
	}

	async sendRequest(session: ISession, chat: IChat): Promise<void> {
		const ownership = this.requireOwnedSession(session, true);
		this.requireChat(session, chat);
		this.requireInteractiveChat(session, chat);
		await ownership.provider.sendRequest(session, chat);
		if (ownership.isDraft) {
			const replacement = this.draftReplacements.get(session);
			if (!replacement || !this.state.get().sessions.includes(replacement)) {
				throw new Error(`Session draft '${session.sessionId}' was not explicitly replaced by a committed Session.`);
			}
		}
	}

	createChat(session: ISession): Promise<IChat> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			const capabilities = session.capabilities.get();
			if (!capabilities.supportsCreateChat) {
				throw new Error(`Session '${session.sessionId}' does not support user-created peer Chats.`);
			}
			this.assertChatCapacity(session, capabilities.maximumChatCount);

			const previousChatResources = new Set(session.chats.get().map(chat => getComparisonKey(chat.resource)));
			const transitionTracker: IAuthoritativeChangedTransitionTracker = { provider, session, chatResourceSnapshots: [] };
			this.changedTransitionTrackers.add(transitionTracker);
			let chat: IChat;
			try {
				chat = await provider.createChat(session);
			} finally {
				this.changedTransitionTrackers.delete(transitionTracker);
			}
			this.requireOwnedSession(session, false);
			this.requireChat(session, chat);
			assertSessionInvariants(session);
			const chatResourceKey = getComparisonKey(chat.resource);
			const currentChatResourceKeys = session.chats.get().map(candidate => getComparisonKey(candidate.resource));
			const currentChatResources = new Set(currentChatResourceKeys);
			if (previousChatResources.has(chatResourceKey)
				|| currentChatResources.size !== previousChatResources.size + 1
				|| !currentChatResources.has(chatResourceKey)
				|| [...previousChatResources].some(resource => !currentChatResources.has(resource))) {
				throw new Error(`Sessions provider '${provider.id}' did not preserve the Chat collection and add exactly one new Chat resource.`);
			}
			if (!transitionTracker.chatResourceSnapshots.some(snapshot =>
				snapshot.length === currentChatResourceKeys.length
				&& snapshot.every((resource, index) => resource === currentChatResourceKeys[index]),
			)) {
				throw new Error(`Sessions provider '${provider.id}' did not publish an authoritative changed transition for the new Chat.`);
			}
			if (chat.origin.kind !== ChatOriginKind.User) {
				throw new Error(`Sessions provider '${provider.id}' did not create a user-origin peer Chat.`);
			}
			if (chat.interactivity.get() !== ChatInteractivity.Full) {
				throw new Error(`Sessions provider '${provider.id}' created a non-interactive peer Chat.`);
			}
			this.assertGlobalState(this.providerSessions, this.state.get().draftSession);
			return chat;
		});
	}

	forkChat(session: ISession, sourceChat: IChat, turnId: string): Promise<IChat> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			this.requireChat(session, sourceChat);
			const capabilities = session.capabilities.get();
			if (!capabilities.supportsFork) {
				throw new Error(`Session '${session.sessionId}' does not support Chat forks.`);
			}
			this.assertChatCapacity(session, capabilities.maximumChatCount);
			if (!turnId.trim()) {
				throw new Error('A Chat fork requires a source turn ID.');
			}

			const previousChatResources = new Set(session.chats.get().map(chat => getComparisonKey(chat.resource)));
			const transitionTracker: IAuthoritativeChangedTransitionTracker = { provider, session, chatResourceSnapshots: [] };
			this.changedTransitionTrackers.add(transitionTracker);
			let chat: IChat;
			try {
				chat = await provider.forkChat(session, sourceChat, turnId);
			} finally {
				this.changedTransitionTrackers.delete(transitionTracker);
			}
			this.requireOwnedSession(session, false);
			this.requireChat(session, chat);
			assertSessionInvariants(session);
			const chatResourceKey = getComparisonKey(chat.resource);
			const currentChatResourceKeys = session.chats.get().map(candidate => getComparisonKey(candidate.resource));
			const currentChatResources = new Set(currentChatResourceKeys);
			if (previousChatResources.has(chatResourceKey)
				|| currentChatResources.size !== previousChatResources.size + 1
				|| !currentChatResources.has(chatResourceKey)
				|| [...previousChatResources].some(resource => !currentChatResources.has(resource))) {
				throw new Error(`Sessions provider '${provider.id}' did not preserve the Chat collection and add exactly one Chat fork resource.`);
			}
			if (!transitionTracker.chatResourceSnapshots.some(snapshot =>
				snapshot.length === currentChatResourceKeys.length
				&& snapshot.every((resource, index) => resource === currentChatResourceKeys[index]),
			)) {
				throw new Error(`Sessions provider '${provider.id}' did not publish an authoritative changed transition for the Chat fork.`);
			}
			if (chat.origin.kind !== ChatOriginKind.Fork || !isEqual(chat.origin.parentChat, sourceChat.resource)) {
				throw new Error(`Sessions provider '${provider.id}' created a fork with the wrong origin.`);
			}
			if (chat.interactivity.get() !== ChatInteractivity.Full) {
				throw new Error(`Sessions provider '${provider.id}' created a non-interactive Chat fork.`);
			}
			this.assertGlobalState(this.providerSessions, this.state.get().draftSession);
			return chat;
		});
	}

	async renameSession(session: ISession, title: string): Promise<void> {
		const { provider } = this.requireOwnedSession(session, false);
		if (!session.capabilities.get().supportsRename) {
			throw new Error(`Session '${session.sessionId}' does not support rename.`);
		}
		this.requireNonEmptyTitle(title);
		await provider.renameSession(session, title);
		this.requireOwnedSession(session, false);
		if (session.title.get() !== title) {
			throw new Error(`Sessions provider '${provider.id}' did not apply the requested Session title.`);
		}
	}

	async renameChat(session: ISession, chat: IChat, title: string): Promise<void> {
		const { provider } = this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
		this.requireInteractiveChat(session, chat);
		if (!chat.capabilities.get().supportsRename) {
			throw new Error(`Chat '${chat.resource.toString()}' does not support rename.`);
		}
		this.requireNonEmptyTitle(title);
		await provider.renameChat(session, chat, title);
		this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
		if (chat.title.get() !== title) {
			throw new Error(`Sessions provider '${provider.id}' did not apply the requested Chat title.`);
		}
	}

	async setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void> {
		const { provider } = this.requireOwnedSession(session, true);
		this.requireChat(session, chat);
		this.requireInteractiveChat(session, chat);
		if (!session.capabilities.get().supportsModels) {
			throw new Error(`Session '${session.sessionId}' does not support model selection.`);
		}
		const models = [...provider.getModels(session, chat)];
		this.assertModels(provider, models);
		if (modelId !== undefined && !models.some(model => model.id === modelId && model.enabled)) {
			throw new Error(`Model '${modelId}' is not available for Chat '${chat.resource.toString()}'.`);
		}

		await provider.setChatModel(session, chat, modelId);
		this.requireOwnedSession(session, true);
		this.requireChat(session, chat);
		if (chat.modelId.get() !== modelId) {
			throw new Error(`Sessions provider '${provider.id}' did not apply the requested Chat model.`);
		}
	}

	async setSessionArchived(session: ISession, archived: boolean): Promise<void> {
		const { provider } = this.requireOwnedSession(session, false);
		if (!session.capabilities.get().supportsArchive) {
			throw new Error(`Session '${session.sessionId}' does not support archive.`);
		}

		await provider.setSessionArchived(session, archived);
		this.requireOwnedSession(session, false);
		if (session.isArchived.get() !== archived) {
			throw new Error(`Sessions provider '${provider.id}' did not apply the requested archive state.`);
		}
	}

	releaseSession(session: ISession): Promise<void> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			const providerId = session.providerId;
			const sessionId = session.sessionId;
			const resourceKey = getComparisonKey(session.resource);
			await provider.releaseSession(session);
			this.requireOwnedSession(session, false);
			const released = this.state.get().sessions.find(candidate => candidate.sessionId === sessionId);
			if (
				!released
				|| released !== session
				|| released.providerId !== providerId
				|| released.sessionId !== sessionId
				|| getComparisonKey(released.resource) !== resourceKey
				|| !provider.getSessions().includes(released)
			) {
				throw new Error(`Sessions provider '${provider.id}' did not preserve released Session identity '${sessionId}'.`);
			}
		});
	}

	releaseChat(session: ISession, chat: IChat): Promise<void> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			this.requireChat(session, chat);
			const chatResourceKey = getComparisonKey(chat.resource);
			await provider.releaseChat(session, chat);
			this.requireOwnedSession(session, false);
			const released = session.chats.get().find(candidate => getComparisonKey(candidate.resource) === chatResourceKey);
			if (released !== chat) {
				throw new Error(`Sessions provider '${provider.id}' did not preserve released Chat '${chat.resource.toString()}'.`);
			}
		});
	}

	async cancelTurn(session: ISession, chat: IChat, turnId: string): Promise<void> {
		const { provider } = this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
		const exactTurnId = this.requireTurnId(turnId);
		await provider.cancelTurn(session, chat, exactTurnId);
		this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
	}

	async steerTurn(session: ISession, chat: IChat, turnId: string, message: string): Promise<void> {
		const { provider } = this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
		const exactTurnId = this.requireTurnId(turnId);
		const exactMessage = message.trim();
		if (!exactMessage) {
			throw new Error('Turn steering requires a non-empty message.');
		}
		await provider.steerTurn(session, chat, exactTurnId, exactMessage);
		this.requireOwnedSession(session, false);
		this.requireChat(session, chat);
	}

	deleteSession(session: ISession): Promise<void> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			if (!session.capabilities.get().supportsDelete) {
				throw new Error(`Session '${session.sessionId}' does not support delete.`);
			}

			const providerId = session.providerId;
			const sessionId = session.sessionId;
			const resourceKey = getComparisonKey(session.resource);
			await provider.deleteSession(session);
			const hasDeletedIdentity = (candidate: ISession): boolean =>
				candidate.sessionId === sessionId
				|| (candidate.providerId === providerId && getComparisonKey(candidate.resource) === resourceKey);
			if (this.state.get().sessions.some(hasDeletedIdentity) || provider.getSessions().some(hasDeletedIdentity)) {
				throw new Error(`Sessions provider '${provider.id}' did not remove Session identity '${sessionId}'.`);
			}
		});
	}

	deleteChat(session: ISession, chat: IChat): Promise<void> {
		return this.runSessionCatalogMutation(session, async () => {
			const { provider } = this.requireOwnedSession(session, false);
			this.requireChat(session, chat);
			if (!chat.capabilities.get().supportsDelete) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support delete.`);
			}

			const chatResourceKey = getComparisonKey(chat.resource);
			await provider.deleteChat(session, chat);
			this.requireOwnedSession(session, false);
			if (session.chats.get().some(candidate => getComparisonKey(candidate.resource) === chatResourceKey)) {
				throw new Error(`Sessions provider '${provider.id}' did not remove Chat '${chat.resource.toString()}'.`);
			}
			assertSessionInvariants(session);
			this.assertGlobalState(this.providerSessions, this.state.get().draftSession);
		});
	}

	private assertChatCapacity(session: ISession, maximumChatCount: number | undefined): void {
		if (maximumChatCount !== undefined && session.chats.get().length >= maximumChatCount) {
			throw new Error(`Session '${session.sessionId}' has reached its maximum Chat count of ${maximumChatCount}.`);
		}
	}

	private requireTurnId(turnId: string): string {
		const exactTurnId = turnId.trim();
		if (!exactTurnId) {
			throw new Error('A Turn operation requires an exact Turn ID.');
		}
		return exactTurnId;
	}

	private async runSessionCatalogMutation<T>(session: ISession, mutation: () => Promise<T>): Promise<T> {
		const sessionId = session.sessionId;
		const previousMutation = this.sessionCatalogMutations.get(sessionId);
		let releaseMutation!: () => void;
		const mutationReservation = new Promise<void>(resolve => releaseMutation = resolve);
		this.sessionCatalogMutations.set(sessionId, mutationReservation);

		if (previousMutation) {
			await previousMutation;
		}

		try {
			return await mutation();
		} finally {
			releaseMutation();
			if (this.sessionCatalogMutations.get(sessionId) === mutationReservation) {
				this.sessionCatalogMutations.delete(sessionId);
			}
		}
	}

	prepareProvidersChange(event: ISessionsProvidersChangeEvent): IPreparedSessionsProvidersChange {
		const nextProviderSessions = new Map(this.providerSessions);
		const nextProviderSessionTypes = new Map(this.providerSessionTypes);
		let nextDraftSession = this.state.get().draftSession;
		const changes: ISessionsManagementChangeEvent[] = [];
		let draftChange: ISessionDraftChangeEvent | undefined;

		for (const provider of event.removed) {
			if (this.providers.get(provider.id) !== provider) {
				throw new Error(`Removed Sessions provider '${provider.id}' is not managed.`);
			}
			const sessions = nextProviderSessions.get(provider.id)!;
			nextProviderSessions.delete(provider.id);
			nextProviderSessionTypes.delete(provider.id);
			if (sessions.length > 0) {
				changes.push({
					providerId: provider.id,
					transitions: sessions.map(session => ({ kind: SessionTransitionKind.Removed, session })),
				});
			}
			if (nextDraftSession?.providerId === provider.id) {
				draftChange = {
					kind: SessionDraftChangeKind.ProviderRemoved,
					from: nextDraftSession,
					to: undefined,
				};
				nextDraftSession = undefined;
			}
		}

		for (const provider of event.added) {
			if (nextProviderSessions.has(provider.id)) {
				throw new Error(`Added Sessions provider '${provider.id}' is already managed.`);
			}
			const sessionTypes = this.snapshotProviderSessionTypes(provider);
			const sessions = [...provider.getSessions()];
			this.assertProviderSnapshot(provider, sessions, sessionTypes);
			nextProviderSessions.set(provider.id, sessions);
			nextProviderSessionTypes.set(provider.id, sessionTypes);
			if (sessions.length > 0) {
				changes.push({
					providerId: provider.id,
					transitions: sessions.map(session => ({ kind: SessionTransitionKind.Added, session })),
				});
			}
		}

		this.assertGlobalState(nextProviderSessions, nextDraftSession);

		const preparedSubscriptions = new Map<SessionsProviderId, DisposableStore>();
		try {
			for (const provider of event.added) {
				preparedSubscriptions.set(provider.id, this.createProviderSubscription(provider));
			}
		} catch (error) {
			try {
				this.disposePreparedProviderSubscriptions(preparedSubscriptions);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Failed to prepare and release Sessions provider subscriptions.',
				);
			}
			throw error;
		}

		let completed = false;
		return {
			commit: () => {
				if (completed) {
					throw new Error('A prepared Sessions provider change can only be completed once.');
				}
				const nextSessions = this.commitSessions(nextProviderSessions);
				const nextSessionTypes = this.collectSessionTypes(nextProviderSessionTypes);
				completed = true;

				const removedSubscriptions: DisposableStore[] = [];
				for (const provider of event.removed) {
					const subscription = this.providerSubscriptions.deleteAndLeak(provider.id);
					if (subscription) {
						removedSubscriptions.push(subscription);
					}
					this.providers.delete(provider.id);
				}
				for (const provider of event.added) {
					this.providers.set(provider.id, provider);
					this.providerSubscriptions.set(provider.id, preparedSubscriptions.get(provider.id)!);
					preparedSubscriptions.delete(provider.id);
				}
				this.replaceProviderSessions(nextProviderSessions);
				this.replaceProviderSessionTypes(nextProviderSessionTypes);

				try {
					this.state.set({
						sessions: nextSessions,
						draftSession: nextDraftSession,
						sessionTypes: nextSessionTypes,
					}, undefined);
				} catch (error) {
					onUnexpectedError(error);
				}

				for (const subscription of removedSubscriptions) {
					try {
						subscription.dispose();
					} catch (error) {
						onUnexpectedError(error);
					}
				}
				for (const change of changes) {
					this.sessionsChangeEmitter.fire(change);
				}
				if (draftChange) {
					this.draftSessionChangeEmitter.fire(draftChange);
				}
				if (event.added.length > 0 || event.removed.length > 0) {
					this.sessionTypesChangeEmitter.fire();
				}
			},
			dispose: () => {
				if (completed) {
					return;
				}
				completed = true;
				this.disposePreparedProviderSubscriptions(preparedSubscriptions);
			},
		};
	}

	private createProviderSubscription(provider: ISessionsProvider): DisposableStore {
		const store = new DisposableStore();
		try {
			store.add(provider.onDidChangeSessions(event => this.handleProviderSessionsChanged(provider, event)));
			store.add(provider.onDidChangeSessionTypes(() => this.handleProviderSessionTypesChanged(provider)));
			store.add(provider.onDidChangeModels(() => this.handleProviderModelsChanged(provider)));
			return store;
		} catch (error) {
			try {
				store.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					`Failed to subscribe to and release Sessions provider '${provider.id}'.`,
				);
			}
			throw error;
		}
	}

	private disposePreparedProviderSubscriptions(
		preparedSubscriptions: ReadonlyMap<SessionsProviderId, DisposableStore>,
	): void {
		const errors: unknown[] = [];
		for (const subscription of preparedSubscriptions.values()) {
			try {
				subscription.dispose();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, 'Failed to release prepared Sessions provider subscriptions.');
		}
	}

	private handleProviderSessionsChanged(provider: ISessionsProvider, event: ISessionsChangeEvent): void {
		this.requireManagedProvider(provider);
		this.assertProviderSessionTypesMatchTracked(provider);
		if (event.transitions.length === 0) {
			throw new Error(`Sessions provider '${provider.id}' emitted an empty Session transition batch.`);
		}
		this.assertNoImplicitReplacement(event);

		const currentSessions = this.providerSessions.get(provider.id)!;
		let workingSessions = [...currentSessions];
		let workingDraft = this.state.get().draftSession;
		let draftChange: ISessionDraftChangeEvent | undefined;
		const replacements: Array<{ from: ISession; to: ISession }> = [];

		for (const transition of event.transitions) {
			switch (transition.kind) {
				case SessionTransitionKind.Added:
					this.assertProviderOwnsSession(provider, transition.session);
					assertSessionInvariants(transition.session);
					if (workingSessions.includes(transition.session)) {
						throw new Error(`Session '${transition.session.sessionId}' is already present.`);
					}
					workingSessions.push(transition.session);
					break;
				case SessionTransitionKind.Removed: {
					const index = workingSessions.indexOf(transition.session);
					if (index === -1) {
						throw new Error(`Removed Session '${transition.session.sessionId}' is not the current model.`);
					}
					workingSessions.splice(index, 1);
					break;
				}
				case SessionTransitionKind.Changed:
					if (!workingSessions.includes(transition.session)) {
						throw new Error(`Changed Session '${transition.session.sessionId}' is not the current model.`);
					}
					this.assertProviderOwnsSession(provider, transition.session);
					assertSessionInvariants(transition.session);
					break;
				case SessionTransitionKind.Replaced: {
					this.assertProviderOwnsSession(provider, transition.from);
					this.assertProviderOwnsSession(provider, transition.to);
					assertSessionInvariants(transition.from);
					assertSessionInvariants(transition.to);
					if (transition.from === transition.to) {
						throw new Error(`Session '${transition.from.sessionId}' cannot replace itself.`);
					}
					const index = workingSessions.indexOf(transition.from);
					if (index !== -1) {
						workingSessions.splice(index, 1, transition.to);
					} else if (workingDraft === transition.from) {
						workingDraft = undefined;
						workingSessions.push(transition.to);
						draftChange = {
							kind: SessionDraftChangeKind.Replaced,
							from: transition.from,
							to: transition.to,
						};
					} else {
						throw new Error(`Replaced Session '${transition.from.sessionId}' is not the current model or draft.`);
					}
					replacements.push(transition);
					break;
				}
				default:
					throw new Error(`Sessions provider '${provider.id}' emitted an unknown Session transition.`);
			}

		}

		const afterSessions = [...provider.getSessions()];
		this.assertProviderSnapshot(provider, afterSessions, this.requireTrackedProviderSessionTypes(provider));
		this.assertSameModels(workingSessions, afterSessions, provider);
		for (const replacement of replacements) {
			if (!afterSessions.includes(replacement.to) || afterSessions.includes(replacement.from)) {
				throw new Error(`Sessions provider '${provider.id}' emitted a replacement inconsistent with getSessions().`);
			}
		}

		const nextProviderSessions = new Map(this.providerSessions);
		nextProviderSessions.set(provider.id, afterSessions);
		this.assertGlobalState(nextProviderSessions, workingDraft);
		const promotedSessionIds = [...new Set(event.transitions.flatMap(transition => {
			switch (transition.kind) {
				case SessionTransitionKind.Added:
				case SessionTransitionKind.Changed:
					return [transition.session.sessionId];
				case SessionTransitionKind.Replaced:
					return [transition.to.sessionId];
				case SessionTransitionKind.Removed:
					return [];
			}
		}))];
		const nextSessions = this.commitSessions(nextProviderSessions, promotedSessionIds);
		this.replaceProviderSessions(nextProviderSessions);

		const previousState = this.state.get();
		this.state.set({
			...previousState,
			sessions: nextSessions,
			draftSession: workingDraft,
		}, undefined);
		for (const tracker of this.changedTransitionTrackers) {
			if (tracker.provider === provider && event.transitions.some(transition =>
				transition.kind === SessionTransitionKind.Changed && transition.session === tracker.session,
			)) {
				tracker.chatResourceSnapshots.push(
					tracker.session.chats.get().map(chat => getComparisonKey(chat.resource)),
				);
			}
		}
		if (draftChange?.to) {
			this.draftReplacements.set(draftChange.from!, draftChange.to);
		}
		this.sessionsChangeEmitter.fire({ providerId: provider.id, transitions: event.transitions });
		if (draftChange) {
			this.draftSessionChangeEmitter.fire(draftChange);
		}
	}

	private handleProviderSessionTypesChanged(provider: ISessionsProvider): void {
		this.requireManagedProvider(provider);
		const sessionTypes = this.snapshotProviderSessionTypes(provider);
		const sessions = this.providerSessions.get(provider.id)!;
		this.assertSameModels(sessions, [...provider.getSessions()], provider);
		this.assertProviderSnapshot(provider, sessions, sessionTypes);
		const nextProviderSessionTypes = new Map(this.providerSessionTypes);
		nextProviderSessionTypes.set(provider.id, sessionTypes);
		const nextSessionTypes = this.collectSessionTypes(nextProviderSessionTypes);
		this.replaceProviderSessionTypes(nextProviderSessionTypes);
		const previousState = this.state.get();
		this.state.set({ ...previousState, sessionTypes: nextSessionTypes }, undefined);
		this.sessionTypesChangeEmitter.fire();
	}

	private handleProviderModelsChanged(provider: ISessionsProvider): void {
		this.requireManagedProvider(provider);
		this.modelsChangeEmitter.fire({ providerId: provider.id });
	}

	private requireOwnedSession(session: ISession, allowDraft: boolean): {
		readonly provider: ISessionsProvider;
		readonly isDraft: boolean;
	} {
		assertSessionInvariants(session);
		const provider = this.requireProvider(session.providerId);
		this.assertProviderOwnsSession(provider, session);
		this.assertProviderSessionTypesMatchTracked(provider);
		this.assertProviderSnapshotMatchesTracked(provider);
		this.assertGlobalState(this.providerSessions, this.state.get().draftSession);

		if (this.state.get().sessions.includes(session)) {
			return { provider, isDraft: false };
		}
		if (allowDraft && this.state.get().draftSession === session) {
			return { provider, isDraft: true };
		}
		const current = this.state.get().sessions.find(candidate => candidate.sessionId === session.sessionId);
		if (current) {
			throw new Error(`Session '${session.sessionId}' is a stale model.`);
		}
		throw new Error(`Session '${session.sessionId}' is not managed by the Sessions service.`);
	}

	private requireChat(session: ISession, chat: IChat): void {
		if (!session.chats.get().includes(chat)) {
			throw new Error(`Chat '${chat.resource.toString()}' is not owned by Session '${session.sessionId}'.`);
		}
	}

	private requireInteractiveChat(session: ISession, chat: IChat): void {
		if (chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error(`Chat '${chat.resource.toString()}' in Session '${session.sessionId}' is not interactive.`);
		}
	}

	private requireProvider(providerId: SessionsProviderId): ISessionsProvider {
		const provider = this.sessionsProvidersService.getProvider(providerId);
		if (!provider || this.providers.get(providerId) !== provider) {
			throw new Error(`Sessions provider '${providerId}' is not registered with the management service.`);
		}
		return provider;
	}

	private requireManagedProvider(provider: ISessionsProvider): void {
		if (this.providers.get(provider.id) !== provider) {
			throw new Error(`Sessions provider '${provider.id}' is not managed.`);
		}
	}

	private assertProviderOwnsSession(provider: ISessionsProvider, session: ISession): void {
		if (session.providerId !== provider.id) {
			throw new Error(`Sessions provider '${provider.id}' reported Session '${session.sessionId}' owned by '${session.providerId}'.`);
		}
	}

	private assertProviderSnapshot(
		provider: ISessionsProvider,
		sessions: readonly ISession[],
		sessionTypes: readonly ISessionType[],
	): void {
		for (const session of sessions) {
			this.assertProviderOwnsSession(provider, session);
			assertSessionInvariants(session);
			this.assertCommittedSession(session);
			if (!sessionTypes.some(sessionType => sessionType.id === session.sessionType)) {
				throw new Error(
					`Committed Session '${session.sessionId}' uses Session type '${session.sessionType}' not offered by provider '${provider.id}'.`,
				);
			}
		}
	}

	private assertProviderSnapshotMatchesTracked(provider: ISessionsProvider): void {
		const tracked = this.providerSessions.get(provider.id);
		if (!tracked) {
			throw new Error(`Sessions provider '${provider.id}' has no tracked Session snapshot.`);
		}
		const actual = [...provider.getSessions()];
		this.assertProviderSnapshot(provider, actual, this.requireTrackedProviderSessionTypes(provider));
		this.assertSameModels(tracked, actual, provider);
	}

	private assertSameModels(
		expected: readonly ISession[],
		actual: readonly ISession[],
		provider: ISessionsProvider,
	): void {
		if (expected.length !== actual.length || expected.some((session, index) => actual[index] !== session)) {
			throw new Error(`Sessions provider '${provider.id}' getSessions() does not match its ordered transitions.`);
		}
	}

	private assertGlobalState(
		providerSessions: ReadonlyMap<SessionsProviderId, readonly ISession[]>,
		draftSession: ISession | undefined,
	): void {
		const sessionIds = new Map<SessionId, ISession>();
		const chatResources = new Map<string, { readonly session: ISession; readonly chat: IChat }>();

		const registerSession = (providerId: SessionsProviderId, session: ISession): void => {
			if (session.providerId !== providerId) {
				throw new Error(`Session '${session.sessionId}' is stored under the wrong provider.`);
			}
			assertSessionInvariants(session);
			if (sessionIds.has(session.sessionId)) {
				throw new Error(`Session identity '${session.sessionId}' is not globally unique.`);
			}
			sessionIds.set(session.sessionId, session);

			for (const chat of session.chats.get()) {
				const chatResourceKey = getComparisonKey(chat.resource);
				const existing = chatResources.get(chatResourceKey);
				if (existing) {
					throw new Error(
						`Chat resource '${chat.resource.toString()}' is owned by both Session '${existing.session.sessionId}' and '${session.sessionId}'.`,
					);
				}
				chatResources.set(chatResourceKey, { session, chat });
			}
		};

		for (const [providerId, sessions] of providerSessions) {
			for (const session of sessions) {
				this.assertCommittedSession(session);
				registerSession(providerId, session);
			}
		}
		if (draftSession) {
			registerSession(draftSession.providerId, draftSession);
		}
	}

	private assertNoImplicitReplacement(event: ISessionsChangeEvent): void {
		const removed = event.transitions
			.filter(transition => transition.kind === SessionTransitionKind.Removed)
			.map(transition => transition.session);
		const added = event.transitions
			.filter(transition => transition.kind === SessionTransitionKind.Added)
			.map(transition => transition.session);
		for (const from of removed) {
			if (added.some(to => to.sessionId === from.sessionId || isEqual(to.resource, from.resource))) {
				throw new Error(`Session '${from.sessionId}' must use an explicit replacement transition.`);
			}
		}
	}

	private snapshotProviderSessionTypes(provider: ISessionsProvider): readonly ISessionType[] {
		const sessionTypes = provider.sessionTypes.map(sessionType => ({
			id: sessionType.id,
			label: sessionType.label,
			icon: sessionType.icon.color
				? { id: sessionType.icon.id, color: { id: sessionType.icon.color.id } }
				: { id: sessionType.icon.id },
			supportsWorkspaceLess: sessionType.supportsWorkspaceLess,
		}));
		this.assertProviderSessionTypes(provider, sessionTypes);
		return sessionTypes;
	}

	private assertProviderSessionTypes(provider: ISessionsProvider, sessionTypes: readonly ISessionType[]): void {
		const typeIds = new Set<string>();
		for (const sessionType of sessionTypes) {
			if (!sessionType.id) {
				throw new Error(`Sessions provider '${provider.id}' has a Session type without an ID.`);
			}
			if (typeIds.has(sessionType.id)) {
				throw new Error(`Sessions provider '${provider.id}' has duplicate Session type '${sessionType.id}'.`);
			}
			typeIds.add(sessionType.id);
		}
	}

	private assertProviderSessionTypesMatchTracked(provider: ISessionsProvider): void {
		const tracked = this.requireTrackedProviderSessionTypes(provider);
		const actual = this.snapshotProviderSessionTypes(provider);
		if (tracked.length !== actual.length || tracked.some((sessionType, index) => {
			const candidate = actual[index];
			return candidate.id !== sessionType.id
				|| candidate.label !== sessionType.label
				|| candidate.icon.id !== sessionType.icon.id
				|| candidate.icon.color?.id !== sessionType.icon.color?.id
				|| candidate.supportsWorkspaceLess !== sessionType.supportsWorkspaceLess;
		})) {
			throw new Error(`Sessions provider '${provider.id}' Session types do not match its tracked snapshot.`);
		}
	}

	private requireTrackedProviderSessionTypes(provider: ISessionsProvider): readonly ISessionType[] {
		const sessionTypes = this.providerSessionTypes.get(provider.id);
		if (!sessionTypes) {
			throw new Error(`Sessions provider '${provider.id}' has no tracked Session type snapshot.`);
		}
		return sessionTypes;
	}

	private commitSessions(
		providerSessions: ReadonlyMap<SessionsProviderId, readonly ISession[]>,
		promotedSessionIds: readonly string[] = [],
	): readonly ISession[] {
		const sessions: ISession[] = [];
		for (const provider of this.sessionsProvidersService.getProviders()) {
			const snapshot = providerSessions.get(provider.id);
			if (!snapshot) {
				throw new Error(`Sessions provider '${provider.id}' has no aggregate snapshot.`);
			}
			sessions.push(...snapshot);
		}
		return this.recencyStorage.update(sessions, promotedSessionIds);
	}

	private collectSessionTypes(
		providerSessionTypes: ReadonlyMap<SessionsProviderId, readonly ISessionType[]>,
	): readonly IProviderSessionType[] {
		const sessionTypes: IProviderSessionType[] = [];
		for (const provider of this.sessionsProvidersService.getProviders()) {
			const snapshot = providerSessionTypes.get(provider.id);
			if (!snapshot) {
				throw new Error(`Sessions provider '${provider.id}' has no aggregate Session type snapshot.`);
			}
			for (const sessionType of snapshot) {
				sessionTypes.push({ providerId: provider.id, sessionType });
			}
		}
		return sessionTypes;
	}

	private replaceProviderSessions(providerSessions: ReadonlyMap<SessionsProviderId, readonly ISession[]>): void {
		this.providerSessions.clear();
		for (const [providerId, sessions] of providerSessions) {
			this.providerSessions.set(providerId, sessions);
		}
	}

	private replaceProviderSessionTypes(
		providerSessionTypes: ReadonlyMap<SessionsProviderId, readonly ISessionType[]>,
	): void {
		this.providerSessionTypes.clear();
		for (const [providerId, sessionTypes] of providerSessionTypes) {
			this.providerSessionTypes.set(providerId, sessionTypes);
		}
	}

	private assertDraftWorkspace(session: ISession, expected: ISessionResolvedWorkspaceState): void {
		const actual = session.workspace.get();
		if (actual.kind !== expected.kind) {
			throw new Error(`Session draft '${session.sessionId}' has the wrong workspace state.`);
		}
		if (actual.kind === SessionWorkspaceKind.Workspace
			&& expected.kind === SessionWorkspaceKind.Workspace
			&& !isEqual(actual.workspace.resource, expected.workspace.resource)) {
			throw new Error(`Session draft '${session.sessionId}' has the wrong workspace resource.`);
		}
	}

	private assertModels(
		provider: ISessionsProvider,
		models: readonly ISessionModel[],
	): void {
		const identifiers = new Set<string>();
		for (const model of models) {
			if (!model.id) {
				throw new Error(`Sessions provider '${provider.id}' returned a model without an identifier.`);
			}
			if (!model.label) {
				throw new Error(`Sessions provider '${provider.id}' returned model '${model.id}' without a label.`);
			}
			if (identifiers.has(model.id)) {
				throw new Error(`Sessions provider '${provider.id}' returned duplicate model '${model.id}'.`);
			}
			identifiers.add(model.id);
		}
	}

	private requireNonEmptyTitle(title: string): void {
		if (!title.trim()) {
			throw new Error('A Session or Chat title must be non-empty.');
		}
	}

	private assertCommittedSession(session: ISession): void {
		if (session.status.get() === SessionStatus.Draft) {
			throw new Error(`Committed Session snapshot '${session.sessionId}' contains a draft.`);
		}
	}

	override dispose(): void {
		try {
			const draftSession = this.state.get().draftSession;
			if (draftSession) {
				const provider = this.requireProvider(draftSession.providerId);
				provider.discardSessionDraft(draftSession);
				const previousState = this.state.get();
				this.state.set({ ...previousState, draftSession: undefined }, undefined);
			}
		} finally {
			super.dispose();
		}
	}
}

registerSingleton(ISessionsManagementService, SessionsManagementService, InstantiationType.Delayed);
