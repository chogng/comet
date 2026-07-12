/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const MaxEditorViewStateGroupIdLength = 256;
const MaxEditorViewStatePaneIdLength = 256;
const MaxEditorViewStateResourceKeyLength = 65_536;

export type EditorViewStateKey = {
	readonly groupId: string;
	readonly paneId: string;
	readonly resourceKey: string;
};

export type SerializedEditorViewStateEntry = {
	readonly key: EditorViewStateKey;
	readonly state: unknown;
};

export type SerializedEditorViewState = {
	readonly version: 2;
	readonly entries: readonly SerializedEditorViewStateEntry[];
};

export type ParsedEditorViewState = {
	readonly entries: readonly SerializedEditorViewStateEntry[];
};

function parseEditorViewStateKey(value: unknown): EditorViewStateKey | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 3 ||
		!keys.includes('groupId') ||
		!keys.includes('paneId') ||
		!keys.includes('resourceKey') ||
		typeof candidate.groupId !== 'string' ||
		candidate.groupId.length === 0 ||
		candidate.groupId.length > MaxEditorViewStateGroupIdLength ||
		typeof candidate.paneId !== 'string' ||
		candidate.paneId.length === 0 ||
		candidate.paneId.length > MaxEditorViewStatePaneIdLength ||
		typeof candidate.resourceKey !== 'string' ||
		candidate.resourceKey.length === 0 ||
		candidate.resourceKey.length > MaxEditorViewStateResourceKeyLength
	) {
		return undefined;
	}
	return {
		groupId: candidate.groupId,
		paneId: candidate.paneId,
		resourceKey: candidate.resourceKey,
	};
}

export function serializeEditorViewStateKey(key: EditorViewStateKey): string {
	const parsed = parseEditorViewStateKey(key);
	if (!parsed) {
		throw new Error('Editor view-state key is invalid.');
	}
	return JSON.stringify([parsed.groupId, parsed.paneId, parsed.resourceKey]);
}

export class EditorViewStateStore {
	private readonly viewStateByKey = new Map<string, SerializedEditorViewStateEntry>();

	constructor(entries: readonly SerializedEditorViewStateEntry[] = []) {
		this.replaceAll(entries);
	}

	get<TViewState>(key: EditorViewStateKey): TViewState | undefined {
		return this.viewStateByKey.get(serializeEditorViewStateKey(key))?.state as TViewState | undefined;
	}

	set<TViewState>(key: EditorViewStateKey, state: TViewState): void {
		const parsedKey = parseEditorViewStateKey(key);
		if (!parsedKey) {
			throw new Error('Editor view-state key is invalid.');
		}
		this.viewStateByKey.set(serializeEditorViewStateKey(parsedKey), { key: parsedKey, state });
	}

	delete(key: EditorViewStateKey): void {
		this.viewStateByKey.delete(serializeEditorViewStateKey(key));
	}

	clear(): void {
		this.viewStateByKey.clear();
	}

	entries(): SerializedEditorViewStateEntry[] {
		return [...this.viewStateByKey.values()];
	}

	replaceAll(entries: readonly SerializedEditorViewStateEntry[]): void {
		this.clear();
		for (const entry of entries) {
			this.set(entry.key, entry.state);
		}
	}
}

export function parseSerializedEditorViewState(value: unknown): ParsedEditorViewState {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Stored Editor view state must be an object.');
	}
	const candidate = value as Partial<SerializedEditorViewState>;
	if (
		Object.keys(value).length !== 2 ||
		candidate.version !== 2 ||
		!Array.isArray(candidate.entries)
	) {
		throw new Error('Stored Editor view state has an unsupported schema.');
	}

	const parsedEntries: SerializedEditorViewStateEntry[] = [];
	const keys = new Set<string>();
	for (const entry of candidate.entries) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error('Stored Editor view-state entry must be an object.');
		}
		const storedEntry = entry as Partial<SerializedEditorViewStateEntry>;
		const parsedKey = parseEditorViewStateKey(storedEntry.key);
		if (Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'state') || !parsedKey) {
			throw new Error('Stored Editor view-state entry is invalid.');
		}
		const serializedKey = serializeEditorViewStateKey(parsedKey);
		if (keys.has(serializedKey)) {
			throw new Error('Stored Editor view state contains a duplicate key.');
		}
		keys.add(serializedKey);
		parsedEntries.push({ key: parsedKey, state: storedEntry.state });
	}

	return { entries: parsedEntries };
}
