/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
	SessionKey,
	SessionStore,
	SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

const sessionStoreSchema = 1;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IClaudeAgentSessionStoreRecord {
	readonly schema: typeof sessionStoreSchema;
	readonly key: SessionKey;
	readonly entries: SessionStoreEntry[];
}

function validateKey(key: SessionKey): SessionKey {
	if (
		typeof key.projectKey !== 'string'
		|| key.projectKey.length === 0
		|| key.projectKey.length > 4_096
		|| typeof key.sessionId !== 'string'
		|| !sessionIdPattern.test(key.sessionId)
		|| (key.subpath !== undefined && (
			typeof key.subpath !== 'string'
			|| key.subpath.length === 0
			|| key.subpath.length > 4_096
		))
	) {
		throw new Error('Claude Agent SDK SessionStore key is invalid.');
	}
	return Object.freeze({
		projectKey: key.projectKey,
		sessionId: key.sessionId,
		...(key.subpath === undefined ? {} : { subpath: key.subpath }),
	});
}

function validateEntries(entries: unknown): SessionStoreEntry[] {
	if (!Array.isArray(entries)) {
		throw new Error('Claude Agent SDK SessionStore entries are invalid.');
	}
	for (const entry of entries) {
		if (
			entry === null
			|| typeof entry !== 'object'
			|| Array.isArray(entry)
			|| typeof (entry as { readonly type?: unknown }).type !== 'string'
			|| (
				(entry as { readonly uuid?: unknown }).uuid !== undefined
				&& typeof (entry as { readonly uuid?: unknown }).uuid !== 'string'
			)
		) {
			throw new Error('Claude Agent SDK SessionStore entry is invalid.');
		}
	}
	return entries as SessionStoreEntry[];
}

function recordLine(key: SessionKey, entries: SessionStoreEntry[]): string {
	const record: IClaudeAgentSessionStoreRecord = {
		schema: sessionStoreSchema,
		key,
		entries,
	};
	return `${JSON.stringify(record)}\n`;
}

function entryUuids(entries: readonly SessionStoreEntry[]): Set<string> {
	const uuids = new Set<string>();
	for (const entry of entries) {
		if (typeof entry.uuid === 'string') {
			if (uuids.has(entry.uuid)) {
				throw new Error('Claude Agent SDK SessionStore contains a duplicate entry identity.');
			}
			uuids.add(entry.uuid);
		}
	}
	return uuids;
}

function keyIdentity(key: SessionKey): string {
	return JSON.stringify([key.projectKey, key.sessionId, key.subpath ?? null]);
}

/** Durable SDK-native transcript store with idempotent append and delete semantics. */
export class ClaudeAgentSessionStore implements SessionStore {
	private readonly appendLocks = new Map<string, Promise<void>>();
	private readonly knownEntryUuids = new Map<string, Set<string>>();
	private rootPromise: Promise<string> | undefined;

	constructor(private readonly configuredRoot: string) {
		if (!path.isAbsolute(configuredRoot)) {
			throw new Error('Claude Agent SDK SessionStore root must be absolute.');
		}
	}

	async append(candidateKey: SessionKey, candidateEntries: SessionStoreEntry[]): Promise<void> {
		const key = validateKey(candidateKey);
		const identity = keyIdentity(key);
		const previous = this.appendLocks.get(identity) ?? Promise.resolve();
		const append = previous.then(
			() => this.appendLocked(key, candidateEntries),
			() => this.appendLocked(key, candidateEntries),
		);
		this.appendLocks.set(identity, append);
		try {
			await append;
		} catch (error) {
			this.knownEntryUuids.delete(identity);
			throw error;
		} finally {
			if (this.appendLocks.get(identity) === append) {
				this.appendLocks.delete(identity);
			}
		}
	}

	async load(candidateKey: SessionKey): Promise<SessionStoreEntry[] | null> {
		const key = validateKey(candidateKey);
		const identity = keyIdentity(key);
		await this.appendLocks.get(identity);
		const entries = await this.readEntries(key);
		if (entries === null) {
			this.knownEntryUuids.delete(identity);
			return null;
		}
		this.knownEntryUuids.set(identity, entryUuids(entries));
		return entries;
	}

	async delete(candidateKey: SessionKey): Promise<void> {
		const key = validateKey(candidateKey);
		const pending = [...this.appendLocks.entries()]
			.filter(([identity]) => (JSON.parse(identity) as [string, string, string | null])[1] === key.sessionId)
			.map(([, operation]) => operation);
		await Promise.all(pending);
		this.knownEntryUuids.clear();
		const root = await this.root();
		const sessionDirectory = path.join(root, key.sessionId);
		let metadata;
		try {
			metadata = await lstat(sessionDirectory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}
			throw error;
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK SessionStore Session directory is invalid.');
		}
		const canonicalSessionDirectory = await realpath(sessionDirectory);
		if (path.dirname(canonicalSessionDirectory) !== root) {
			throw new Error('Claude Agent SDK SessionStore Session directory has the wrong parent.');
		}
		await rm(canonicalSessionDirectory, { recursive: true });
	}

	private async appendLocked(key: SessionKey, candidateEntries: SessionStoreEntry[]): Promise<void> {
		const entries = validateEntries(candidateEntries);
		const identity = keyIdentity(key);
		let known = this.knownEntryUuids.get(identity);
		if (known === undefined) {
			const existing = await this.readEntries(key);
			known = entryUuids(existing ?? []);
			this.knownEntryUuids.set(identity, known);
		}
		const accepted: SessionStoreEntry[] = [];
		const acceptedUuids = new Set<string>();
		for (const entry of entries) {
			if (typeof entry.uuid === 'string') {
				if (known.has(entry.uuid) || acceptedUuids.has(entry.uuid)) {
					continue;
				}
				acceptedUuids.add(entry.uuid);
			}
			accepted.push(entry);
		}
		if (accepted.length === 0) {
			return;
		}
		const sessionDirectory = await this.sessionDirectory(key.sessionId);
		const filePath = path.join(sessionDirectory, this.keyFileName(key));
		const handle = await open(
			filePath,
			constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			const metadata = await handle.stat();
			if (!metadata.isFile()) {
				throw new Error('Claude Agent SDK SessionStore transcript must be a regular file.');
			}
			await handle.writeFile(recordLine(key, accepted), 'utf8');
			await handle.sync();
			for (const uuid of acceptedUuids) {
				known.add(uuid);
			}
		} finally {
			await handle.close();
		}
	}

	private async readEntries(key: SessionKey): Promise<SessionStoreEntry[] | null> {
		const root = await this.root();
		const filePath = path.join(root, key.sessionId, this.keyFileName(key));
		let handle;
		try {
			handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
		try {
			const metadata = await handle.stat();
			if (!metadata.isFile()) {
				throw new Error('Claude Agent SDK SessionStore transcript must be a regular file.');
			}
			const contents = await handle.readFile('utf8');
			const entries: SessionStoreEntry[] = [];
			for (const line of contents.split('\n')) {
				if (line.length === 0) {
					continue;
				}
				let value: unknown;
				try {
					value = JSON.parse(line);
				} catch {
					throw new Error('Claude Agent SDK SessionStore transcript is invalid.');
				}
				if (
					value === null
					|| typeof value !== 'object'
					|| Array.isArray(value)
					|| Object.keys(value).length !== 3
					|| !['schema', 'key', 'entries'].every(field => Object.hasOwn(value, field))
					|| (value as { readonly schema?: unknown }).schema !== sessionStoreSchema
					|| keyIdentity(validateKey((value as { readonly key: SessionKey }).key)) !== keyIdentity(key)
				) {
					throw new Error('Claude Agent SDK SessionStore transcript authority is invalid.');
				}
				entries.push(...validateEntries((value as { readonly entries?: unknown }).entries));
			}
			return entries;
		} finally {
			await handle.close();
		}
	}

	private async root(): Promise<string> {
		this.rootPromise ??= this.resolveRoot();
		return this.rootPromise;
	}

	private async resolveRoot(): Promise<string> {
		await mkdir(this.configuredRoot, { recursive: true, mode: 0o700 });
		const metadata = await lstat(this.configuredRoot);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK SessionStore root must be a real directory.');
		}
		const root = await realpath(this.configuredRoot);
		await chmod(root, 0o700);
		return root;
	}

	private async sessionDirectory(sessionId: string): Promise<string> {
		const root = await this.root();
		const candidate = path.join(root, sessionId);
		await mkdir(candidate, { recursive: true, mode: 0o700 });
		const metadata = await lstat(candidate);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK SessionStore Session directory must be real.');
		}
		const directory = await realpath(candidate);
		if (path.dirname(directory) !== root) {
			throw new Error('Claude Agent SDK SessionStore Session directory has the wrong parent.');
		}
		await chmod(directory, 0o700);
		return directory;
	}

	private keyFileName(key: SessionKey): string {
		return `${createHash('sha256').update(keyIdentity(key)).digest('hex')}.jsonl`;
	}
}
