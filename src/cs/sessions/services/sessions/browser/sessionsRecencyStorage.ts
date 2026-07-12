/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import type { ISession } from 'cs/sessions/services/sessions/common/session';
import {
	isSerializedJsonLargerThan,
	isUtf8StringLargerThan,
} from 'cs/sessions/services/sessions/common/serializedSize';

const SessionsRecencyStorageKey = 'sessions.recency';
const SessionsRecencyStorageVersion = 1;
const MaximumSessionsRecencyStorageBytes = 1024 * 1024;
const MaximumStoredSessions = 65_536;
const MaximumStoredSessionIdLength = 8_192;

interface IStoredSessionsRecency {
	readonly version: typeof SessionsRecencyStorageVersion;
	readonly sessionIds: readonly string[];
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Stored Sessions recency has an invalid root value.');
	}
	return value as Record<string, unknown>;
}

function parseStoredRecency(value: unknown): readonly string[] {
	const stored = requireRecord(value);
	if (Object.keys(stored).some(key => key !== 'version' && key !== 'sessionIds')) {
		throw new Error('Stored Sessions recency has an unknown root field.');
	}
	if (stored.version !== SessionsRecencyStorageVersion) {
		throw new Error('Stored Sessions recency has an unsupported version.');
	}
	if (!Array.isArray(stored.sessionIds) || stored.sessionIds.length > MaximumStoredSessions) {
		throw new Error('Stored Sessions recency has an invalid Session list.');
	}
	if (stored.sessionIds.some(sessionId =>
		typeof sessionId !== 'string'
			|| !sessionId
			|| sessionId.length > MaximumStoredSessionIdLength
	)) {
		throw new Error('Stored Sessions recency has an invalid Session ID.');
	}
	const sessionIds = [...stored.sessionIds] as string[];
	if (new Set(sessionIds).size !== sessionIds.length) {
		throw new Error('Stored Sessions recency contains duplicate Session IDs.');
	}
	return sessionIds;
}

function requireActivityTime(session: ISession): number {
	const updatedAt = session.updatedAt.get();
	const time = updatedAt instanceof Date ? updatedAt.getTime() : Number.NaN;
	if (!Number.isFinite(time)) {
		throw new Error(`Session '${session.sessionId}' has an invalid activity time.`);
	}
	return time;
}

/** Persists the authoritative cross-provider Session activity order. */
export class SessionsRecencyStorage {
	private rankBySessionId: ReadonlyMap<string, number>;

	constructor(private readonly storageService: IStorageService) {
		this.rankBySessionId = this.loadRanks();
	}

	commit(
		sessions: readonly ISession[],
		promotedSessionIds: readonly string[] = [],
	): readonly ISession[] {
		const entries = sessions.map(session => ({
			session,
			activityTime: requireActivityTime(session),
		}));
		const sessionIds = entries.map(entry => entry.session.sessionId);
		const sessionIdSet = new Set(sessionIds);
		if (sessionIdSet.size !== sessionIds.length) {
			throw new Error('Sessions recency cannot contain duplicate Session IDs.');
		}
		if (new Set(promotedSessionIds).size !== promotedSessionIds.length
			|| promotedSessionIds.some(sessionId => !sessionIdSet.has(sessionId))) {
			throw new Error('Sessions recency has invalid promoted Session IDs.');
		}
		const promotedRanks = new Map(promotedSessionIds.map((sessionId, index) => [sessionId, index]));

		const ordered = entries.sort((left, right) => {
			const activityDifference = right.activityTime - left.activityTime;
			if (activityDifference !== 0) {
				return activityDifference;
			}
			const leftPromotedRank = promotedRanks.get(left.session.sessionId);
			const rightPromotedRank = promotedRanks.get(right.session.sessionId);
			if (leftPromotedRank !== undefined || rightPromotedRank !== undefined) {
				if (leftPromotedRank === undefined) {
					return 1;
				}
				if (rightPromotedRank === undefined) {
					return -1;
				}
				return leftPromotedRank - rightPromotedRank;
			}
			const leftRank = this.rankBySessionId.get(left.session.sessionId);
			const rightRank = this.rankBySessionId.get(right.session.sessionId);
			if (leftRank !== undefined || rightRank !== undefined) {
				if (leftRank === undefined) {
					return 1;
				}
				if (rightRank === undefined) {
					return -1;
				}
				if (leftRank !== rightRank) {
					return leftRank - rightRank;
				}
			}
			return left.session.sessionId < right.session.sessionId
				? -1
				: left.session.sessionId > right.session.sessionId ? 1 : 0;
			}).map(entry => entry.session);
		const orderedSessions = Object.freeze(ordered);
		const stored: IStoredSessionsRecency = {
			version: SessionsRecencyStorageVersion,
			sessionIds: orderedSessions.map(session => session.sessionId),
		};
		parseStoredRecency(stored);
		if (isSerializedJsonLargerThan(stored, MaximumSessionsRecencyStorageBytes)) {
			throw new Error(`Sessions recency exceeds ${MaximumSessionsRecencyStorageBytes} bytes.`);
		}
		this.storageService.store(
			SessionsRecencyStorageKey,
			JSON.stringify(stored),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		this.rankBySessionId = new Map(orderedSessions.map((session, index) => [session.sessionId, index]));
		return orderedSessions;
	}

	private loadRanks(): ReadonlyMap<string, number> {
		const serialized = this.storageService.get(SessionsRecencyStorageKey, StorageScope.APPLICATION);
		if (serialized === undefined) {
			return new Map();
		}
		if (isUtf8StringLargerThan(serialized, MaximumSessionsRecencyStorageBytes)) {
			throw new Error(`Stored Sessions recency exceeds ${MaximumSessionsRecencyStorageBytes} bytes.`);
		}
		let value: unknown;
		try {
			value = JSON.parse(serialized);
		} catch {
			throw new Error('Stored Sessions recency is not valid JSON.');
		}
		const sessionIds = parseStoredRecency(value);
		return new Map(sessionIds.map((sessionId, index) => [sessionId, index]));
	}
}
