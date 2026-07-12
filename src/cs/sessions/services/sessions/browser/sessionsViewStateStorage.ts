/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import type { IVisibleSessionViewState } from 'cs/sessions/services/sessions/browser/visibleSessions';
import {
	isSerializedJsonLargerThan,
	isUtf8StringLargerThan,
} from 'cs/sessions/services/sessions/common/serializedSize';

const SessionsViewStateStorageKey = 'sessions.viewState';
const SessionsViewStateStorageVersion = 1;
const MaximumSessionsViewStateStorageBytes = 4 * 1024 * 1024;
const MaximumStoredVisibleSlots = 256;
const MaximumStoredSessionViewStates = 4096;
const MaximumStoredChatKeysPerSession = 1024;
const MaximumStoredKeyLength = 4096;

export type IStoredVisibleSessionSlot =
	| { readonly kind: 'new-session' }
	| { readonly kind: 'session'; readonly sessionId: string };

export interface IStoredSessionViewState {
	readonly sessionId: string;
	readonly state: IVisibleSessionViewState;
}

export interface ISessionsViewStateSnapshot {
	readonly slots: readonly IStoredVisibleSessionSlot[];
	readonly activeSlotIndex: number;
	readonly sessionViewStates: readonly IStoredSessionViewState[];
}

interface IStoredSessionsViewState extends ISessionsViewStateSnapshot {
	readonly version: typeof SessionsViewStateStorageVersion;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Stored Sessions view state has an invalid ${name}.`);
	}
	return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value.length > MaximumStoredKeyLength) {
		throw new Error(`Stored Sessions view state has an invalid ${name}.`);
	}
	return value;
}

function requireStringArray(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value)
		|| value.length > MaximumStoredChatKeysPerSession
		|| value.some(item => typeof item !== 'string' || !item || item.length > MaximumStoredKeyLength)) {
		throw new Error(`Stored Sessions view state has an invalid ${name}.`);
	}
	const values = value as string[];
	if (new Set(values).size !== values.length) {
		throw new Error(`Stored Sessions view state has duplicate ${name}.`);
	}
	return [...values];
}

function parseSlot(value: unknown): IStoredVisibleSessionSlot {
	const slot = requireRecord(value, 'visible slot');
	if (slot.kind === 'new-session') {
		return { kind: 'new-session' };
	}
	if (slot.kind === 'session') {
		return { kind: 'session', sessionId: requireString(slot.sessionId, 'slot Session ID') };
	}
	throw new Error('Stored Sessions view state has an unknown visible slot kind.');
}

function parseSessionViewState(value: unknown): IStoredSessionViewState {
	const entry = requireRecord(value, 'Session view-state entry');
	const state = requireRecord(entry.state, 'Session view state');
	if (typeof state.sticky !== 'boolean') {
		throw new Error('Stored Sessions view state has invalid stickiness.');
	}
	return {
		sessionId: requireString(entry.sessionId, 'view-state Session ID'),
		state: {
			activeChatKey: requireString(state.activeChatKey, 'active Chat key'),
			closedChatKeys: requireStringArray(state.closedChatKeys, 'closed Chat keys'),
			shownToolChatKeys: requireStringArray(state.shownToolChatKeys, 'shown Tool Chat keys'),
			sticky: state.sticky,
		},
	};
}

function parseSnapshot(value: unknown): ISessionsViewStateSnapshot {
	const stored = requireRecord(value, 'root value');
	if (stored.version !== SessionsViewStateStorageVersion) {
		throw new Error('Stored Sessions view state has an unsupported version.');
	}
	if (!Array.isArray(stored.slots)
		|| stored.slots.length === 0
		|| stored.slots.length > MaximumStoredVisibleSlots) {
		throw new Error('Stored Sessions view state requires at least one visible slot.');
	}
	const slots = stored.slots.map(parseSlot);
	const sessionIds = slots.flatMap(slot => slot.kind === 'session' ? [slot.sessionId] : []);
	if (new Set(sessionIds).size !== sessionIds.length) {
		throw new Error('Stored Sessions view state has duplicate visible Sessions.');
	}
	if (slots.filter(slot => slot.kind === 'new-session').length > 1) {
		throw new Error('Stored Sessions view state has multiple new-Session slots.');
	}
	if (!Number.isInteger(stored.activeSlotIndex)
		|| (stored.activeSlotIndex as number) < 0
		|| (stored.activeSlotIndex as number) >= slots.length) {
		throw new Error('Stored Sessions view state has an invalid active slot index.');
	}
	if (!Array.isArray(stored.sessionViewStates)
		|| stored.sessionViewStates.length > MaximumStoredSessionViewStates) {
		throw new Error('Stored Sessions view state has invalid per-Session state.');
	}
	const sessionViewStates = stored.sessionViewStates.map(parseSessionViewState);
	const viewStateSessionIds = sessionViewStates.map(entry => entry.sessionId);
	if (new Set(viewStateSessionIds).size !== viewStateSessionIds.length) {
		throw new Error('Stored Sessions view state has duplicate per-Session state.');
	}
	return {
		slots,
		activeSlotIndex: stored.activeSlotIndex as number,
		sessionViewStates,
	};
}

/** Persists the view-facing Sessions state owned by `ISessionsService`. */
export class SessionsViewStateStorage {
	constructor(private readonly storageService: IStorageService) {}

	load(): ISessionsViewStateSnapshot | undefined {
		const stored = this.storageService.get(SessionsViewStateStorageKey, StorageScope.APPLICATION);
		if (!stored) {
			return undefined;
		}
		if (isUtf8StringLargerThan(stored, MaximumSessionsViewStateStorageBytes)) {
			throw new Error(`Stored Sessions view state exceeds ${MaximumSessionsViewStateStorageBytes} bytes.`);
		}
		return parseSnapshot(JSON.parse(stored) as unknown);
	}

	store(snapshot: ISessionsViewStateSnapshot): void {
		const stored: IStoredSessionsViewState = {
			version: SessionsViewStateStorageVersion,
			slots: snapshot.slots,
			activeSlotIndex: snapshot.activeSlotIndex,
			sessionViewStates: snapshot.sessionViewStates,
		};
		parseSnapshot(stored);
		if (isSerializedJsonLargerThan(stored, MaximumSessionsViewStateStorageBytes)) {
			throw new Error(`Sessions view state exceeds ${MaximumSessionsViewStateStorageBytes} bytes.`);
		}
		const serialized = JSON.stringify(stored);
		this.storageService.store(
			SessionsViewStateStorageKey,
			serialized,
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}
}
