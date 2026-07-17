/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import { autorun, observableValue, type IObservable } from 'cs/base/common/observable';
import { getComparisonKey } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { IStorageService } from 'cs/platform/storage/common/storage';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
	type SessionId,
	SessionStatus,
	type SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import {
	ISessionsManagementService,
	SessionDraftChangeKind,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import {
	SessionTransitionKind,
	type ISessionDraftOptions,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	type IActiveSession,
	type IVisibleSessionSlot,
	isNewSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';
import {
	ISessionsPartService,
	type ISessionsPartFocusTarget,
} from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	VisibleSessions,
	type IVisibleSessionViewState,
} from 'cs/sessions/services/sessions/browser/visibleSessions';
import {
	SessionsViewStateStorage,
	type ISessionsViewStateSnapshot,
} from 'cs/sessions/services/sessions/browser/sessionsViewStateStorage';

export const enum OpenNewSessionKind {
	Empty = 'empty',
	Draft = 'draft',
}

export type IOpenNewSessionOptions =
	| {
		readonly kind: OpenNewSessionKind.Empty;
		readonly preserveFocus?: boolean;
	}
	| {
		readonly kind: OpenNewSessionKind.Draft;
		readonly providerId: SessionsProviderId;
		readonly draft: ISessionDraftOptions;
		readonly preserveFocus?: boolean;
	};

export interface IOpenSessionOptions {
	readonly preserveFocus?: boolean;
}

export const ISessionsService = createDecorator<ISessionsService>('sessionsService');

/** Owns canonical visible Session and per-slot Chat presentation state. */
export interface ISessionsService {
	readonly _serviceBrand: undefined;
	readonly visibleSessions: IObservable<readonly IVisibleSessionSlot[]>;
	readonly activeSession: IObservable<IActiveSession | undefined>;
	openSession(sessionId: SessionId, options?: IOpenSessionOptions): void;
	openNewSession(options?: IOpenNewSessionOptions): Promise<ISession | undefined>;
	openChat(session: ISession, chatResource: URI, options?: IOpenSessionOptions): void;
	closeChat(session: IActiveSession, chat: IChat): void;
	reopenChat(session: IActiveSession, chat: IChat, options?: IOpenSessionOptions): void;
	closeSession(session: IActiveSession | undefined): void;
	setActiveSession(session: IActiveSession | undefined): void;
	setSessionSticky(session: IActiveSession, sticky: boolean): void;
	focusSession(session: IActiveSession | undefined): void;
}

/** Default provider-independent view-facing Sessions service. */
export class SessionsService extends Disposable implements ISessionsService {
	declare readonly _serviceBrand: undefined;

	private readonly sessionViewStates: Map<SessionId, IVisibleSessionViewState>;
	private readonly viewStateRevision = observableValue('sessionsViewStateRevision', 0);
	private readonly viewStateStorage: SessionsViewStateStorage;
	private readonly visibility: VisibleSessions;
	private pendingStoredViewState: ISessionsViewStateSnapshot | undefined;
	private viewStateDirty = false;
	readonly visibleSessions: IObservable<readonly IVisibleSessionSlot[]>;
	readonly activeSession: IObservable<IActiveSession | undefined>;

	constructor(
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@ISessionsPartService private readonly sessionsPartService: ISessionsPartService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		this.viewStateStorage = new SessionsViewStateStorage(storageService);
		const storedViewState = this.viewStateStorage.load();
		this.pendingStoredViewState = storedViewState;
		this.sessionViewStates = new Map(storedViewState?.sessionViewStates.map(entry => [entry.sessionId, entry.state]));
		this.visibility = this._register(new VisibleSessions(
			this.sessionViewStates,
			() => {
				this.viewStateDirty = true;
				this.viewStateRevision.set(this.viewStateRevision.get() + 1, undefined);
			},
		));
		this.visibleSessions = this.visibility.visibleSessions;
		this.activeSession = this.visibility.activeSession;
		this.tryRestorePendingVisibility();
		this._register(storageService.onWillSaveState(() => this.storeViewStateIfDirty()));
		this._register(this.sessionsManagementService.onDidChangeSessions(event => {
			const previousActiveSession = this.activeSession.get();
			for (const transition of event.transitions) {
				switch (transition.kind) {
					case SessionTransitionKind.Added:
						break;
					case SessionTransitionKind.Removed:
						this.visibility.removeSession(transition.session);
						this.visibility.forgetSession(transition.session);
						break;
					case SessionTransitionKind.Changed:
						this.visibility.reconcileSession(transition.session);
						break;
					case SessionTransitionKind.Replaced:
						this.visibility.replaceSession(transition.from, transition.to);
						break;
				}
			}
			this.tryRestorePendingVisibility();
			this.focusChangedActiveSession(previousActiveSession);
		}));
		this._register(this.sessionsManagementService.onDidChangeDraftSession(event => {
			const previousActiveSession = this.activeSession.get();
			if (event.from && (
				event.kind === SessionDraftChangeKind.Discarded
					|| event.kind === SessionDraftChangeKind.ProviderRemoved
			)) {
				this.visibility.removeSession(event.from);
				this.visibility.forgetSession(event.from);
			}
			this.tryRestorePendingVisibility();
			this.focusChangedActiveSession(previousActiveSession);
		}));
		this._register(this.sessionsPartService.onDidFocusSlot(target => this.handlePartFocus(target)));
		let initialized = false;
		this._register(autorun(reader => {
			this.viewStateRevision.read(reader);
			const visibleSessions = this.visibleSessions.read(reader);
			const activeSession = this.activeSession.read(reader);
			this.sessionsPartService.updateVisibleSessions(visibleSessions, activeSession);
			if (initialized) {
				this.viewStateDirty = true;
			}
			initialized = true;
		}));
	}

	openSession(sessionId: SessionId, options: IOpenSessionOptions = {}): void {
		const session = this.sessionsManagementService.getSession(sessionId);
		if (!session) {
			throw new Error(`Session '${sessionId}' is not managed.`);
		}
		this.cancelPendingRestore();
		const visibleSession = this.visibility.setActive(session)!;
		this.focusUnlessPreserved(visibleSession, options.preserveFocus);
	}

	async openNewSession(
		options: IOpenNewSessionOptions = { kind: OpenNewSessionKind.Empty },
	): Promise<ISession | undefined> {
		if (options.kind === OpenNewSessionKind.Empty) {
			this.cancelPendingRestore();
			const draft = this.sessionsManagementService.draftSession.get();
			const visibleSession = this.visibility.setActive(draft, draft ? this.requireDraftChat(draft) : undefined);
			this.focusUnlessPreserved(visibleSession, options.preserveFocus);
			return draft;
		}

		this.cancelPendingRestore();
		const draft = await this.sessionsManagementService.createSessionDraft(options.providerId, options.draft);
		try {
			const visibleSession = this.visibility.setActive(draft, this.requireDraftChat(draft))!;
			this.focusUnlessPreserved(visibleSession, options.preserveFocus);
			return draft;
		} catch (error) {
			this.sessionsManagementService.discardSessionDraft(draft);
			throw error;
		}
	}

	private requireDraftChat(session: ISession): IChat {
		const chats = session.chats.get();
		const chat = chats[0];
		if (chats.length !== 1
			|| !chat
			|| chat.origin.kind !== ChatOriginKind.User
			|| chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error(`Session draft '${session.sessionId}' must contain one interactive user Chat.`);
		}
		return chat;
	}

	openChat(session: ISession, chatResource: URI, options: IOpenSessionOptions = {}): void {
		const currentSession = this.requireCurrentSession(session);
		const resourceKey = getComparisonKey(chatResource);
		const chat = currentSession.chats.get().find(candidate => getComparisonKey(candidate.resource) === resourceKey);
		if (!chat) {
			throw new Error(`Chat '${chatResource.toString()}' is not owned by Session '${currentSession.sessionId}'.`);
		}
		if (chat.interactivity.get() === ChatInteractivity.Hidden) {
			throw new Error(`Hidden Chat '${chat.resource.toString()}' cannot be opened.`);
		}
		this.cancelPendingRestore();
		const visibleSession = this.visibility.setActive(currentSession, chat)!;
		this.focusUnlessPreserved(visibleSession, options.preserveFocus);
	}

	closeChat(session: IActiveSession, chat: IChat): void {
		const visibleSession = this.requireVisibleSession(session);
		if (visibleSession.status.get() === SessionStatus.Draft) {
			throw new Error(`Session draft '${visibleSession.sessionId}' must be discarded instead of closing its Chat.`);
		}
		const currentChat = this.requireCurrentChat(visibleSession, chat);
		this.cancelPendingRestore();
		this.visibility.closeChat(visibleSession, currentChat);
	}

	reopenChat(session: IActiveSession, chat: IChat, options: IOpenSessionOptions = {}): void {
		const visibleSession = this.requireVisibleSession(session);
		const currentChat = this.requireCurrentChat(visibleSession, chat);
		this.cancelPendingRestore();
		this.visibility.openChat(visibleSession, currentChat);
		this.focusUnlessPreserved(visibleSession, options.preserveFocus);
	}

	closeSession(session: IActiveSession | undefined): void {
		if (!session) {
			this.cancelPendingRestore();
			this.visibility.removeSession(undefined);
			this.sessionsPartService.focusSession(this.activeSession.get());
			return;
		}

		const visibleSession = this.requireVisibleSession(session);
		const sessionModel = this.visibility.getSessionModel(visibleSession);
		this.cancelPendingRestore();
		const draft = this.sessionsManagementService.draftSession.get();
		if (draft === sessionModel) {
			this.sessionsManagementService.discardSessionDraft(draft);
			return;
		}

		this.visibility.removeSession(visibleSession);
		this.sessionsPartService.focusSession(this.activeSession.get());
	}

	setActiveSession(session: IActiveSession | undefined): void {
		if (session) {
			this.requireVisibleSession(session);
		} else if (!this.visibleSessions.get().some(isNewSessionSlot)) {
			throw new Error('The new-Session slot is not visible.');
		}
		this.cancelPendingRestore();
		this.visibility.setActiveVisibleSession(session);
	}

	setSessionSticky(session: IActiveSession, sticky: boolean): void {
		this.requireVisibleSession(session);
		this.cancelPendingRestore();
		this.visibility.setSticky(session, sticky);
	}

	focusSession(session: IActiveSession | undefined): void {
		if (session) {
			this.requireVisibleSession(session);
		} else if (!this.visibleSessions.get().some(isNewSessionSlot)) {
			throw new Error('The new-Session slot is not visible.');
		}
		this.cancelPendingRestore();
		this.sessionsPartService.focusSession(session);
	}

	private handlePartFocus(target: ISessionsPartFocusTarget): void {
		if (target.kind === 'new-session') {
			if (!this.visibleSessions.get().some(isNewSessionSlot)) {
				throw new Error('The Sessions Part focused a stale new-Session slot.');
			}
			if (!this.activeSession.get()) {
				return;
			}
			this.cancelPendingRestore();
			this.visibility.setActiveVisibleSession(undefined);
			return;
		}
		if (!this.visibleSessions.get().includes(target.session)) {
			throw new Error(`Sessions Part focused stale Session '${target.session.sessionId}'.`);
		}
		if (this.activeSession.get() === target.session) {
			return;
		}
		this.cancelPendingRestore();
		this.visibility.setActiveVisibleSession(target.session);
	}

	private requireCurrentSession(session: ISession): ISession {
		const visibleSession = this.visibleSessions.get().find((slot): slot is IActiveSession =>
			!isNewSessionSlot(slot) && slot === session,
		);
		if (visibleSession) {
			return this.visibility.getSessionModel(visibleSession);
		}
		const current = this.sessionsManagementService.getSession(session.sessionId);
		if (current === session || this.sessionsManagementService.draftSession.get() === session) {
			return session;
		}
		throw new Error(`Session '${session.sessionId}' is not the current managed model.`);
	}

	private requireVisibleSession(session: IActiveSession): IActiveSession {
		if (!this.visibleSessions.get().includes(session)) {
			throw new Error(`Session '${session.sessionId}' is not visible.`);
		}
		return session;
	}

	private requireCurrentChat(session: IActiveSession, chat: IChat): IChat {
		if (!session.chats.get().includes(chat)) {
			throw new Error(`Chat '${chat.resource.toString()}' is not owned by Session '${session.sessionId}'.`);
		}
		return chat;
	}

	private focusUnlessPreserved(session: IActiveSession | undefined, preserveFocus: boolean | undefined): void {
		if (!preserveFocus) {
			this.sessionsPartService.focusSession(session);
		}
	}

	private focusChangedActiveSession(previousActiveSession: IActiveSession | undefined): void {
		const activeSession = this.activeSession.get();
		if (previousActiveSession !== activeSession) {
			this.sessionsPartService.focusSession(activeSession);
		}
	}

	private restoreStoredVisibility(snapshot: ISessionsViewStateSnapshot): boolean {
		const slots: Array<ISession | undefined> = [];
		let activeSlotIndex = -1;
		let hasUnresolvedSession = false;
		for (let index = 0; index < snapshot.slots.length; index += 1) {
			const storedSlot = snapshot.slots[index];
			const session = storedSlot.kind === 'new-session'
				? undefined
				: this.getStoredSession(storedSlot.sessionId);
			if (storedSlot.kind === 'session' && !session) {
				hasUnresolvedSession = true;
				continue;
			}
			slots.push(session);
			if (index === snapshot.activeSlotIndex) {
				activeSlotIndex = slots.length - 1;
			}
		}
		if (slots.length === 0) {
			slots.push(undefined);
			activeSlotIndex = 0;
		} else if (activeSlotIndex === -1) {
			activeSlotIndex = 0;
		}
		const currentSlots = this.visibleSessions.get();
		const currentSlotIds = currentSlots.map(slot => isNewSessionSlot(slot) ? undefined : slot.sessionId);
		const nextSlotIds = slots.map(slot => slot?.sessionId);
		const currentActiveSessionId = this.activeSession.get()?.sessionId;
		const nextActiveSessionId = slots[activeSlotIndex]?.sessionId;
		if (currentSlotIds.length !== nextSlotIds.length
			|| currentSlotIds.some((sessionId, index) => sessionId !== nextSlotIds[index])
			|| currentActiveSessionId !== nextActiveSessionId) {
			this.visibility.restore(slots, activeSlotIndex);
		}
		return hasUnresolvedSession;
	}

	private getStoredSession(sessionId: SessionId): ISession | undefined {
		const session = this.sessionsManagementService.getSession(sessionId);
		if (session) {
			return session;
		}
		const draft = this.sessionsManagementService.draftSession.get();
		return draft?.sessionId === sessionId ? draft : undefined;
	}

	private tryRestorePendingVisibility(): void {
		const snapshot = this.pendingStoredViewState;
		if (snapshot && !this.restoreStoredVisibility(snapshot)) {
			this.pendingStoredViewState = undefined;
		}
	}

	private cancelPendingRestore(): void {
		if (this.pendingStoredViewState) {
			this.pendingStoredViewState = undefined;
			this.viewStateDirty = true;
		}
	}

	private storeViewStateIfDirty(): void {
		if (!this.viewStateDirty || this.pendingStoredViewState) {
			return;
		}
		const visibleSessions = this.visibleSessions.get();
		const activeSession = this.activeSession.get();
		const activeSlotIndex = visibleSessions.findIndex(slot => activeSession
			? slot === activeSession
			: isNewSessionSlot(slot));
		if (activeSlotIndex === -1) {
			throw new Error('Visible Sessions state does not contain its active slot.');
		}
		this.viewStateStorage.store({
			slots: visibleSessions.map(slot => isNewSessionSlot(slot)
				? { kind: 'new-session' }
				: { kind: 'session', sessionId: slot.sessionId }),
			activeSlotIndex,
			sessionViewStates: [...this.sessionViewStates].map(([sessionId, state]) => ({ sessionId, state })),
		});
		this.viewStateDirty = false;
	}
}

registerSingleton(ISessionsService, SessionsService, InstantiationType.Delayed);
