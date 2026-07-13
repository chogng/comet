/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import {
	autorun,
	observableValue,
	type IObservable,
	type IObservableReader,
	type ISettableObservable,
} from 'cs/base/common/observable';
import { getComparisonKey } from 'cs/base/common/resources';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
} from 'cs/sessions/services/sessions/common/session';
import {
	NewSessionSlot,
	type IActiveSession,
	type IVisibleSessionSlot,
	isNewSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';

export interface IVisibleSessionViewState {
	readonly activeChatKey: string;
	readonly closedChatKeys: readonly string[];
	readonly shownToolChatKeys: readonly string[];
	readonly sticky: boolean;
}

interface IVisibleSessionState {
	readonly session: ISession;
	readonly activeChatKey: string;
	readonly closedChatKeys: ReadonlySet<string>;
	readonly shownToolChatKeys: ReadonlySet<string>;
	readonly sticky: boolean;
}

function chatKey(chat: IChat): string {
	return getComparisonKey(chat.resource);
}

function isVisibleChat(chat: IChat): boolean {
	return chat.interactivity.get() !== ChatInteractivity.Hidden;
}

function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	return left.size === right.size && [...left].every(value => right.has(value));
}

/** Stable view-owned wrapper for one slot-bound Session model. */
export class VisibleSession extends Disposable implements IActiveSession {
	private readonly state: ISettableObservable<IVisibleSessionState>;
	private readonly disposed = observableValue('visibleSessionDisposed', false);

	readonly title: ISession['title'];
	readonly updatedAt: ISession['updatedAt'];
	readonly status: ISession['status'];
	readonly isRead: ISession['isRead'];
	readonly isArchived: ISession['isArchived'];
	readonly workspace: ISession['workspace'];
	readonly changes: ISession['changes'];
	readonly mainChat: ISession['mainChat'];
	readonly chats: ISession['chats'];
	readonly capabilities: ISession['capabilities'];
	readonly activeChat: IObservable<IChat>;
	readonly openChats: IObservable<readonly IChat[]>;
	readonly closedChats: IObservable<readonly IChat[]>;
	readonly visibleChatTabs: IObservable<readonly IChat[]>;
	readonly sticky: IObservable<boolean>;

	constructor(
		session: ISession,
		initialChat: IChat,
		initialState: IVisibleSessionViewState | undefined,
		private readonly saveViewState: (sessionId: string, state: IVisibleSessionViewState) => void,
	) {
		super();
		this.assertOwnedVisibleChat(session, initialChat);
		const restoredActiveChat = session.chats.get().find(chat =>
			chatKey(chat) === initialState?.activeChatKey && isVisibleChat(chat),
		) ?? initialChat;
		const restoredActiveChatKey = chatKey(restoredActiveChat);
		const restoredShownToolChatKeys = new Set(initialState?.shownToolChatKeys);
		if (restoredActiveChat.origin?.kind === ChatOriginKind.Tool) {
			restoredShownToolChatKeys.add(restoredActiveChatKey);
		}
		const restoredClosedChatKeys = new Set(initialState?.closedChatKeys);
		restoredClosedChatKeys.delete(restoredActiveChatKey);
		const restoredState = this.reconcileState({
			session,
			activeChatKey: restoredActiveChatKey,
			closedChatKeys: restoredClosedChatKeys,
			shownToolChatKeys: restoredShownToolChatKeys,
			sticky: initialState?.sticky ?? false,
		}, session);
		this.state = observableValue<IVisibleSessionState>(`visibleSession-${session.sessionId}`, restoredState);

		this.title = this.createProjection(reader =>
			this.state.read(reader).session.title.read(reader));
		this.updatedAt = this.createProjection(reader =>
			this.state.read(reader).session.updatedAt.read(reader));
		this.status = this.createProjection(reader =>
			this.state.read(reader).session.status.read(reader));
		this.isRead = this.createProjection(reader =>
			this.state.read(reader).session.isRead.read(reader));
		this.isArchived = this.createProjection(reader =>
			this.state.read(reader).session.isArchived.read(reader));
		this.workspace = this.createProjection(reader =>
			this.state.read(reader).session.workspace.read(reader));
		this.changes = this.createProjection(reader =>
			this.state.read(reader).session.changes.read(reader));
		this.mainChat = this.createProjection(reader =>
			this.state.read(reader).session.mainChat.read(reader));
		this.chats = this.createProjection(reader =>
			this.state.read(reader).session.chats.read(reader));
		this.capabilities = this.createProjection(reader =>
			this.state.read(reader).session.capabilities.read(reader));
		this.activeChat = this.createProjection(reader => {
			const state = this.state.read(reader);
			const selected = state.session.chats.read(reader).find(chat => chatKey(chat) === state.activeChatKey);
			if (selected
				&& selected.interactivity.read(reader) !== ChatInteractivity.Hidden
				&& !state.closedChatKeys.has(state.activeChatKey)
				&& (selected.origin?.kind !== ChatOriginKind.Tool || state.shownToolChatKeys.has(state.activeChatKey))) {
				return selected;
			}
			return state.session.mainChat.read(reader);
		});
		this.openChats = this.createProjection(reader => {
			const state = this.state.read(reader);
			return state.session.chats.read(reader).filter(chat =>
				chat.interactivity.read(reader) !== ChatInteractivity.Hidden
				&& !state.closedChatKeys.has(chatKey(chat))
				&& (chat.origin?.kind !== ChatOriginKind.Tool || state.shownToolChatKeys.has(chatKey(chat))),
			);
		});
		this.closedChats = this.createProjection(reader => {
			const state = this.state.read(reader);
			return state.session.chats.read(reader).filter(chat =>
				chat.interactivity.read(reader) !== ChatInteractivity.Hidden
				&& chat.origin?.kind !== ChatOriginKind.Tool
				&& state.closedChatKeys.has(chatKey(chat)),
			);
		});
		this.visibleChatTabs = this.createProjection(reader => {
			return this.openChats.read(reader);
		});
		this.sticky = this.createProjection(reader => this.state.read(reader).sticky);
		this._register(autorun(reader => {
			const previous = this.state.read(reader);
			const next = this.reconcileState(previous, previous.session, reader);
			if (previous.activeChatKey !== next.activeChatKey
				|| !areSetsEqual(previous.closedChatKeys, next.closedChatKeys)
				|| !areSetsEqual(previous.shownToolChatKeys, next.shownToolChatKeys)) {
				this.publishState(next);
			}
		}));
		this.persistViewState(restoredState);
	}

	get sessionId() { return this.state.get().session.sessionId; }
	get resource() { return this.state.get().session.resource; }
	get providerId() { return this.state.get().session.providerId; }
	get sessionType() { return this.state.get().session.sessionType; }
	get createdAt() { return this.state.get().session.createdAt; }

	isBoundTo(session: ISession): boolean {
		return this.state.get().session === session;
	}

	getSessionModel(): ISession {
		return this.state.get().session;
	}

	setSticky(sticky: boolean): void {
		const state = this.state.get();
		if (state.sticky !== sticky) {
			this.publishState({ ...state, sticky });
		}
	}

	setActiveChat(chat: IChat): void {
		const state = this.state.get();
		const current = this.requireCurrentVisibleChat(state.session, chat);
		const key = chatKey(current);
		if (current.origin?.kind === ChatOriginKind.Tool && !state.shownToolChatKeys.has(key)) {
			throw new Error(`Tool Chat '${current.resource.toString()}' must be opened before it can become active.`);
		}
		if (state.closedChatKeys.has(key)) {
			throw new Error(`Chat '${current.resource.toString()}' is closed.`);
		}
		if (state.activeChatKey !== key) {
			this.publishState({ ...state, activeChatKey: key });
		}
	}

	openChat(chat: IChat): void {
		const state = this.state.get();
		const current = this.requireCurrentVisibleChat(state.session, chat);
		const key = chatKey(current);
		const closedChatKeys = new Set(state.closedChatKeys);
		const shownToolChatKeys = new Set(state.shownToolChatKeys);
		closedChatKeys.delete(key);
		if (current.origin?.kind === ChatOriginKind.Tool) {
			shownToolChatKeys.add(key);
		}
		this.publishState({
			...state,
			activeChatKey: key,
			closedChatKeys,
			shownToolChatKeys,
		});
	}

	closeChat(chat: IChat): void {
		const state = this.state.get();
		const current = this.requireCurrentVisibleChat(state.session, chat);
		const key = chatKey(current);
		if (key === chatKey(state.session.mainChat.get())) {
			throw new Error(`The main Chat of Session '${state.session.sessionId}' cannot be closed.`);
		}

		const closedChatKeys = new Set(state.closedChatKeys);
		const shownToolChatKeys = new Set(state.shownToolChatKeys);
		if (current.origin?.kind === ChatOriginKind.Tool) {
			shownToolChatKeys.delete(key);
		} else {
			closedChatKeys.add(key);
		}
		this.publishState({
			...state,
			activeChatKey: state.activeChatKey === key
				? this.defaultActiveChatKey(state.session, closedChatKeys, shownToolChatKeys)
				: state.activeChatKey,
			closedChatKeys,
			shownToolChatKeys,
		});
	}

	reconcileChats(): void {
		this.publishState(this.reconcileState(this.state.get(), this.state.get().session));
	}

	replaceSession(session: ISession): void {
		this.publishState(this.reconcileState(this.state.get(), session));
	}

	private publishState(state: IVisibleSessionState): void {
		this.state.set(state, undefined);
		this.persistViewState(state);
	}

	private persistViewState(state: IVisibleSessionState): void {
		this.saveViewState(state.session.sessionId, {
			activeChatKey: state.activeChatKey,
			closedChatKeys: [...state.closedChatKeys],
			shownToolChatKeys: [...state.shownToolChatKeys],
			sticky: state.sticky,
		});
	}

	private createProjection<T>(compute: (reader: IObservableReader | undefined) => T): IObservable<T> {
		let lastValue = compute(undefined);
		return {
			get: () => {
				if (!this.disposed.get()) {
					lastValue = compute(undefined);
				}
				return lastValue;
			},
			read: reader => {
				if (!this.disposed.read(reader)) {
					lastValue = compute(reader);
				}
				return lastValue;
			},
		};
	}

	private reconcileState(
		previous: IVisibleSessionState,
		session: ISession,
		reader?: IObservableReader,
	): IVisibleSessionState {
		const chats = reader ? session.chats.read(reader) : session.chats.get();
		const mainChat = reader ? session.mainChat.read(reader) : session.mainChat.get();
		const mainChatKey = chatKey(mainChat);
		const visibleChats = chats.filter(chat =>
			(reader ? chat.interactivity.read(reader) : chat.interactivity.get()) !== ChatInteractivity.Hidden,
		);
		const visibleKeys = new Set(visibleChats.map(chatKey));
		const peerKeys = new Set(chats
			.filter(chat => chat.origin?.kind !== ChatOriginKind.Tool && chatKey(chat) !== mainChatKey)
			.map(chatKey));
		const toolKeys = new Set(chats
			.filter(chat => chat.origin?.kind === ChatOriginKind.Tool)
			.map(chatKey));
		const closedChatKeys = new Set([...previous.closedChatKeys].filter(key => peerKeys.has(key)));
		const shownToolChatKeys = new Set([...previous.shownToolChatKeys].filter(key => toolKeys.has(key)));
		const activeChatKey = visibleKeys.has(previous.activeChatKey)
			&& !closedChatKeys.has(previous.activeChatKey)
			&& (toolKeys.has(previous.activeChatKey) ? shownToolChatKeys.has(previous.activeChatKey) : true)
			? previous.activeChatKey
			: mainChatKey;
		return {
			session,
			activeChatKey,
			closedChatKeys,
			shownToolChatKeys,
			sticky: previous.sticky,
		};
	}

	private defaultActiveChatKey(
		session: ISession,
		closedChatKeys: ReadonlySet<string>,
		shownToolChatKeys: ReadonlySet<string>,
	): string {
		const candidates = session.chats.get().filter(chat => {
			const key = chatKey(chat);
			return isVisibleChat(chat)
				&& !closedChatKeys.has(key)
				&& (chat.origin?.kind !== ChatOriginKind.Tool || shownToolChatKeys.has(key));
		});
		return chatKey(candidates.at(-1) ?? session.mainChat.get());
	}

	private assertOwnedVisibleChat(session: ISession, chat: IChat): void {
		if (!session.chats.get().some(candidate => chatKey(candidate) === chatKey(chat))) {
			throw new Error(`Chat '${chat.resource.toString()}' is not owned by Session '${session.sessionId}'.`);
		}
		if (!isVisibleChat(chat)) {
			throw new Error(`Hidden Chat '${chat.resource.toString()}' cannot be displayed.`);
		}
	}

	private requireCurrentVisibleChat(session: ISession, chat: IChat): IChat {
		if (!session.chats.get().includes(chat)) {
			throw new Error(`Chat '${chat.resource.toString()}' is not owned by Session '${session.sessionId}'.`);
		}
		if (!isVisibleChat(chat)) {
			throw new Error(`Hidden Chat '${chat.resource.toString()}' cannot be displayed.`);
		}
		return chat;
	}

	override dispose(): void {
		if (!this.disposed.get()) {
			this.disposed.set(true, undefined);
		}
		super.dispose();
	}
}

interface IVisibleSessionsState {
	readonly slots: readonly IVisibleSessionSlot[];
	readonly activeSlot: IVisibleSessionSlot;
}

/** Owns ordered visible Session slots and their stable view wrappers. */
export class VisibleSessions extends Disposable {
	private readonly state = observableValue<IVisibleSessionsState>('visibleSessions', {
		slots: [NewSessionSlot],
		activeSlot: NewSessionSlot,
	});
	private readonly disposed = observableValue('visibleSessionsDisposed', false);
	private mostRecentNonStickySlot: IVisibleSessionSlot = NewSessionSlot;

	readonly visibleSessions: IObservable<readonly IVisibleSessionSlot[]>;
	readonly activeSession: IObservable<IActiveSession | undefined>;

	constructor(
		private readonly viewStates: Map<string, IVisibleSessionViewState>,
		private readonly notifyViewStateChanged: () => void,
	) {
		super();
		this.visibleSessions = this.createProjection(reader => this.state.read(reader).slots);
		this.activeSession = this.createProjection<IActiveSession | undefined>(reader => {
				const activeSlot = this.state.read(reader).activeSlot;
				return isNewSessionSlot(activeSlot) ? undefined : activeSlot;
		});
	}

	restore(slots: readonly (ISession | undefined)[], activeIndex: number): void {
		if (slots.length === 0) {
			throw new Error('Visible Sessions restoration requires at least one slot.');
		}
		if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= slots.length) {
			throw new Error('Visible Sessions restoration requires a valid active slot index.');
		}
		const sessionIds = new Set<string>();
		let newSessionSlotCount = 0;
		for (const slot of slots) {
			if (!slot) {
				newSessionSlotCount += 1;
				continue;
			}
			if (sessionIds.has(slot.sessionId)) {
				throw new Error(`Visible Sessions restoration contains duplicate Session '${slot.sessionId}'.`);
			}
			sessionIds.add(slot.sessionId);
		}
		if (newSessionSlotCount > 1) {
			throw new Error('Visible Sessions restoration contains multiple new-Session slots.');
		}

		const currentSlots = this.state.get().slots;
		const currentSessions = new Map(currentSlots
			.filter((slot): slot is VisibleSession => slot instanceof VisibleSession)
			.map(slot => [slot.sessionId, slot]));
		for (const slot of slots) {
			if (!slot) {
				continue;
			}
			const current = currentSessions.get(slot.sessionId);
			if (current && !current.isBoundTo(slot)) {
				throw new Error(`Session '${slot.sessionId}' must be updated through an explicit replacement.`);
			}
		}
		const retainedSessions = new Set<VisibleSession>();
		const restoredSlots = slots.map(slot => {
			if (!slot) {
				return NewSessionSlot;
			}
			const current = currentSessions.get(slot.sessionId);
			if (current) {
				retainedSessions.add(current);
				return current;
			}
			const created = this.createVisibleSession(slot);
			retainedSessions.add(created);
			return created;
		});
		const activeSlot = restoredSlots[activeIndex];
		this.mostRecentNonStickySlot = isNewSessionSlot(activeSlot) || !activeSlot.sticky.get()
			? activeSlot
			: this.findLastNonSticky(restoredSlots) ?? NewSessionSlot;
		this.state.set({ slots: restoredSlots, activeSlot }, undefined);
		for (const currentSlot of currentSlots) {
			if (currentSlot instanceof VisibleSession && !retainedSessions.has(currentSlot)) {
				currentSlot.dispose();
			}
		}
	}

	setActive(session: ISession | undefined): VisibleSession | undefined {
		const current = this.state.get();
		const existing = session
			? current.slots.find((slot): slot is VisibleSession => slot instanceof VisibleSession && slot.sessionId === session.sessionId)
			: current.slots.find(isNewSessionSlot);
		if (existing) {
			if (session && existing instanceof VisibleSession && !existing.isBoundTo(session)) {
				throw new Error(`Session '${session.sessionId}' must be updated through an explicit replacement.`);
			}
			this.publishActive(current.slots, existing);
			return isNewSessionSlot(existing) ? undefined : existing;
		}

		const target: IVisibleSessionSlot = session ? this.createVisibleSession(session) : NewSessionSlot;
		const replacement = this.chooseReplacement(current);
		const slots = [...current.slots];
		let removedWrapper: VisibleSession | undefined;
		if (replacement) {
			const index = slots.indexOf(replacement);
			slots.splice(index, 1, target);
			if (replacement instanceof VisibleSession) {
				removedWrapper = replacement;
			}
		} else {
			slots.push(target);
		}
		this.mostRecentNonStickySlot = isNewSessionSlot(target) || !target.sticky.get()
			? target
			: this.findLastNonSticky(slots) ?? NewSessionSlot;
		this.state.set({ slots, activeSlot: target }, undefined);
		removedWrapper?.dispose();
		return target instanceof VisibleSession ? target : undefined;
	}

	setActiveVisibleSession(session: IActiveSession | undefined): void {
		const state = this.state.get();
		const target = session ?? state.slots.find(isNewSessionSlot);
		if (!target || !state.slots.includes(target)) {
			throw new Error(session
				? `Session '${session.sessionId}' is not visible.`
				: 'The new-Session slot is not visible.');
		}
		this.publishActive(state.slots, target);
	}

	setSticky(session: IActiveSession, sticky: boolean): void {
		const wrapper = this.requireVisibleSession(session);
		wrapper.setSticky(sticky);
		if (!sticky) {
			this.mostRecentNonStickySlot = wrapper;
		} else if (this.mostRecentNonStickySlot === wrapper) {
			this.mostRecentNonStickySlot = this.findLastNonSticky(this.state.get().slots) ?? NewSessionSlot;
		}
	}

	getVisibleSession(session: ISession): VisibleSession | undefined {
		return this.state.get().slots.find((slot): slot is VisibleSession =>
			slot instanceof VisibleSession && slot.sessionId === session.sessionId,
		);
	}

	getSessionModel(session: IActiveSession): ISession {
		return this.requireVisibleSession(session).getSessionModel();
	}

	openChat(session: IActiveSession, chat: IChat): void {
		this.requireVisibleSession(session).openChat(chat);
	}

	closeChat(session: IActiveSession, chat: IChat): void {
		this.requireVisibleSession(session).closeChat(chat);
	}

	reconcileSession(session: ISession): void {
		const wrapper = this.state.get().slots.find((slot): slot is VisibleSession =>
			slot instanceof VisibleSession && slot.isBoundTo(session),
		);
		if (wrapper) {
			wrapper.reconcileChats();
			const state = this.state.get();
			this.state.set({ ...state, slots: [...state.slots] }, undefined);
		}
	}

	replaceSession(from: ISession, to: ISession): void {
		const slots = this.state.get().slots;
		const wrapper = slots.find((slot): slot is VisibleSession =>
			slot instanceof VisibleSession && slot.isBoundTo(from),
		);
		if (from.sessionId !== to.sessionId && this.viewStates.has(to.sessionId)) {
			throw new Error(`Replacement Session identity '${to.sessionId}' already has retained view state.`);
		}
		if (wrapper) {
			const previousSessionId = wrapper.sessionId;
			const visibleConflict = slots.find(slot =>
				slot instanceof VisibleSession && slot !== wrapper && slot.sessionId === to.sessionId,
			);
			if (visibleConflict) {
				throw new Error(`Replacement Session identity '${to.sessionId}' is already visible.`);
			}
			wrapper.replaceSession(to);
			if (previousSessionId !== to.sessionId) {
				this.viewStates.delete(previousSessionId);
			}
			const state = this.state.get();
			this.state.set({ ...state, slots: [...state.slots] }, undefined);
			return;
		}

		if (from.sessionId !== to.sessionId) {
			const retainedState = this.viewStates.get(from.sessionId);
			if (retainedState) {
				this.viewStates.set(to.sessionId, retainedState);
				this.viewStates.delete(from.sessionId);
				this.notifyViewStateChanged();
			}
		}
	}

	forgetSession(session: ISession): void {
		if (this.viewStates.delete(session.sessionId)) {
			this.notifyViewStateChanged();
		}
	}

	removeSession(session: ISession | undefined): void {
		const current = this.state.get();
		const target = session
			? current.slots.find((slot): slot is VisibleSession => slot instanceof VisibleSession && (slot === session || slot.isBoundTo(session)))
			: current.slots.find(isNewSessionSlot);
		if (!target) {
			return;
		}
		const index = current.slots.indexOf(target);
		const slots = current.slots.filter(slot => slot !== target);
		if (slots.length === 0) {
			slots.push(NewSessionSlot);
		}
		const activeSlot = current.activeSlot === target
			? slots[Math.max(0, Math.min(index - 1, slots.length - 1))]
			: current.activeSlot;
		if (this.mostRecentNonStickySlot === target || !slots.includes(this.mostRecentNonStickySlot)) {
			this.mostRecentNonStickySlot = this.findLastNonSticky(slots) ?? NewSessionSlot;
		}
		this.state.set({ slots, activeSlot }, undefined);
		if (target instanceof VisibleSession) {
			target.dispose();
		}
	}

	private publishActive(slots: readonly IVisibleSessionSlot[], target: IVisibleSessionSlot): void {
		if (isNewSessionSlot(target) || !target.sticky.get()) {
			this.mostRecentNonStickySlot = target;
		}
		this.state.set({ slots, activeSlot: target }, undefined);
	}

	private createVisibleSession(session: ISession): VisibleSession {
		return new VisibleSession(
			session,
			session.mainChat.get(),
			this.viewStates.get(session.sessionId),
			(sessionId, state) => {
				this.viewStates.set(sessionId, state);
				this.notifyViewStateChanged();
			},
		);
	}

	private createProjection<T>(compute: (reader: IObservableReader | undefined) => T): IObservable<T> {
		let lastValue = compute(undefined);
		return {
			get: () => {
				if (!this.disposed.get()) {
					lastValue = compute(undefined);
				}
				return lastValue;
			},
			read: reader => {
				if (!this.disposed.read(reader)) {
					lastValue = compute(reader);
				}
				return lastValue;
			},
		};
	}

	private chooseReplacement(state: IVisibleSessionsState): IVisibleSessionSlot | undefined {
		if (isNewSessionSlot(state.activeSlot) || !state.activeSlot.sticky.get()) {
			return state.activeSlot;
		}
		if (state.slots.includes(this.mostRecentNonStickySlot)
			&& (isNewSessionSlot(this.mostRecentNonStickySlot) || !this.mostRecentNonStickySlot.sticky.get())) {
			return this.mostRecentNonStickySlot;
		}
		return this.findLastNonSticky(state.slots);
	}

	private findLastNonSticky(slots: readonly IVisibleSessionSlot[]): IVisibleSessionSlot | undefined {
		return [...slots].reverse().find(slot => isNewSessionSlot(slot) || !slot.sticky.get());
	}

	private requireVisibleSession(session: IActiveSession): VisibleSession {
		const wrapper = this.state.get().slots.find((slot): slot is VisibleSession => slot instanceof VisibleSession && slot === session);
		if (!wrapper) {
			throw new Error(`Session '${session.sessionId}' is not visible.`);
		}
		return wrapper;
	}

	override dispose(): void {
		if (!this.disposed.get()) {
			this.disposed.set(true, undefined);
		}
		for (const slot of this.state.get().slots) {
			if (slot instanceof VisibleSession) {
				slot.dispose();
			}
		}
		super.dispose();
	}
}
