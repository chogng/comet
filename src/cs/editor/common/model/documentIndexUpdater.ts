/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NodeId } from 'cs/editor/common/core/identifiers';
import {
	type DocumentIndex,
	type IDocumentNodeParentLocation,
} from 'cs/editor/common/model/documentIndex';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type InsertableNode,
	type ManuscriptNode,
	type TextNode,
} from 'cs/editor/common/model/manuscript';

export type DocumentIndexUpdaterNodeReadKind =
	| 'affected-subtree'
	| 'changed-path'
	| 'preorder-materialization';

export type DocumentIndexUpdaterShallowCopyKind =
	| 'index-node-overrides'
	| 'index-parent-overrides'
	| 'index-parent-versions'
	| 'index-parent-edits'
	| 'index-parent-edit-log-chunk';

export type DocumentIndexUpdaterOverlayKind =
	| 'nodes'
	| 'parents'
	| 'parent-versions'
	| 'parent-edits';

/**
 * Structural instrumentation accepted by the internal overlay updater.
 *
 * The reducer's public instrumentation interface is structurally compatible
 * with this narrower surface. This module does not own reducer authority.
 */
export interface IDocumentIndexUpdaterInstrumentation {
	readonly onNodePayloadRead?: (
		nodeId: NodeId,
		kind: DocumentIndexUpdaterNodeReadKind,
	) => void;
	readonly onShallowCopy?: (
		kind: DocumentIndexUpdaterShallowCopyKind,
		copiedSlots: number,
	) => void;
	readonly onPreorderMaterialized?: (nodeCount: number) => void;
	readonly onIndexOverlayCardinality?: (
		kind: DocumentIndexUpdaterOverlayKind,
		valueEntries: number,
		tombstoneEntries: number,
	) => void;
	readonly onParentOrdinalEditLogLength?: (
		parentNodeId: NodeId,
		editCount: number,
	) => void;
	readonly onParentOrdinalEditsReplayed?: (
		parentNodeId: NodeId,
		editCount: number,
	) => void;
	readonly onParentOrdinalEditChunksVisited?: (
		parentNodeId: NodeId,
		chunkCount: number,
	) => void;
}

type PersistentOverlayEntry<T> =
	| {
		readonly kind: 'value';
		readonly value: T;
	}
	| {
		readonly kind: 'deleted';
	};

interface IPersistentStringTrieNode<T> {
	readonly entry?: PersistentOverlayEntry<T>;
	readonly children: ReadonlyMap<string, IPersistentStringTrieNode<T>>;
}

const emptyPersistentStringTrieNode: IPersistentStringTrieNode<never> =
	Object.freeze({
		children: new Map(),
	});

class PersistentStringTrie<T> {
	private constructor(
		private readonly root: IPersistentStringTrieNode<T>,
		readonly valueEntryCount: number,
		readonly tombstoneEntryCount: number,
	) {
		Object.freeze(this);
	}

	static empty<T>(): PersistentStringTrie<T> {
		return new PersistentStringTrie<T>(
			emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>,
			0,
			0,
		);
	}

	get(key: string): PersistentOverlayEntry<T> | undefined {
		let node = this.root;
		for (let index = 0; index < key.length; index += 1) {
			const character = key[index];
			if (character === undefined) {
				return undefined;
			}
			const child = node.children.get(character);
			if (child === undefined) {
				return undefined;
			}
			node = child;
		}
		return node.entry;
	}

	set(
		key: string,
		entry: PersistentOverlayEntry<T>,
		instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
		copyKind: DocumentIndexUpdaterShallowCopyKind,
	): PersistentStringTrie<T> {
		const previous = this.get(key);
		return new PersistentStringTrie(
			setPersistentStringTrieEntry(
				this.root,
				key,
				0,
				entry,
				instrumentation,
				copyKind,
			),
			this.valueEntryCount
				- (previous?.kind === 'value' ? 1 : 0)
				+ (entry.kind === 'value' ? 1 : 0),
			this.tombstoneEntryCount
				- (previous?.kind === 'deleted' ? 1 : 0)
				+ (entry.kind === 'deleted' ? 1 : 0),
		);
	}

	unset(
		key: string,
		instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
		copyKind: DocumentIndexUpdaterShallowCopyKind,
	): PersistentStringTrie<T> {
		const previous = this.get(key);
		if (previous === undefined) {
			return this;
		}
		return new PersistentStringTrie(
			unsetPersistentStringTrieEntry(
				this.root,
				key,
				0,
				instrumentation,
				copyKind,
			) ?? emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>,
			this.valueEntryCount - (previous.kind === 'value' ? 1 : 0),
			this.tombstoneEntryCount - (previous.kind === 'deleted' ? 1 : 0),
		);
	}
}

function setPersistentStringTrieEntry<T>(
	node: IPersistentStringTrieNode<T>,
	key: string,
	index: number,
	entry: PersistentOverlayEntry<T>,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
	copyKind: DocumentIndexUpdaterShallowCopyKind,
): IPersistentStringTrieNode<T> {
	if (index === key.length) {
		return Object.freeze({
			entry,
			children: node.children,
		});
	}
	const character = key[index];
	if (character === undefined) {
		throw new Error('A persistent index trie received an invalid key.');
	}
	const child = node.children.get(character)
		?? emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>;
	const nextChild = setPersistentStringTrieEntry(
		child,
		key,
		index + 1,
		entry,
		instrumentation,
		copyKind,
	);
	const children = new Map(node.children);
	instrumentation?.onShallowCopy?.(copyKind, node.children.size);
	children.set(character, nextChild);
	return Object.freeze({
		...(node.entry === undefined ? {} : { entry: node.entry }),
		children,
	});
}

function unsetPersistentStringTrieEntry<T>(
	node: IPersistentStringTrieNode<T>,
	key: string,
	index: number,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
	copyKind: DocumentIndexUpdaterShallowCopyKind,
): IPersistentStringTrieNode<T> | undefined {
	if (index === key.length) {
		if (node.entry === undefined) {
			return node;
		}
		if (node.children.size === 0) {
			return undefined;
		}
		return Object.freeze({
			children: node.children,
		});
	}
	const character = key[index];
	if (character === undefined) {
		throw new Error('A persistent index trie received an invalid key.');
	}
	const child = node.children.get(character);
	if (child === undefined) {
		return node;
	}
	const nextChild = unsetPersistentStringTrieEntry(
		child,
		key,
		index + 1,
		instrumentation,
		copyKind,
	);
	const children = new Map(node.children);
	instrumentation?.onShallowCopy?.(copyKind, node.children.size);
	if (nextChild === undefined) {
		children.delete(character);
	} else {
		children.set(character, nextChild);
	}
	if (node.entry === undefined && children.size === 0) {
		return undefined;
	}
	return Object.freeze({
		...(node.entry === undefined ? {} : { entry: node.entry }),
		children,
	});
}

function persistentValue<T>(value: T): PersistentOverlayEntry<T> {
	return Object.freeze({
		kind: 'value',
		value,
	});
}

const persistentDeleted: PersistentOverlayEntry<never> = Object.freeze({
	kind: 'deleted',
});

interface IVersionedParentLocation {
	readonly location: IDocumentNodeParentLocation;
	readonly parentVersion: number;
}

export type ParentOrdinalMutation =
	| {
		readonly kind: 'insert' | 'delete';
		readonly childIndex: number;
	}
	| {
		readonly kind: 'move';
		readonly sourceChildIndex: number;
		readonly destinationChildIndexAfterRemoval: number;
	};

export type ParentOrdinalMutationAtParent = ParentOrdinalMutation & {
	readonly parentNodeId: NodeId;
};

type ParentOrdinalEdit = ParentOrdinalMutation & {
	readonly version: number;
};

interface IParentOrdinalEditChunk {
	readonly startVersion: number;
	readonly edits: readonly ParentOrdinalEdit[];
	readonly previous?: IParentOrdinalEditChunk;
}

interface IParentOrdinalEditLog {
	readonly length: number;
	readonly tail?: IParentOrdinalEditChunk;
}

const parentOrdinalEditChunkCapacity = 32;
const emptyParentOrdinalEditLog: IParentOrdinalEditLog = Object.freeze({
	length: 0,
});

class LazyPreorderNodeIds {
	private value: readonly NodeId[] | undefined;

	constructor(
		private readonly root: ManuscriptNode | undefined,
		private readonly expectedNodeCount: number,
		private readonly instrumentation:
			| IDocumentIndexUpdaterInstrumentation
			| undefined,
		private readonly source?: DocumentIndex,
	) {
	}

	get(): readonly NodeId[] {
		if (this.value !== undefined) {
			return this.value;
		}
		if (this.source !== undefined) {
			this.value = this.source.preorderNodeIds;
			return this.value;
		}
		if (this.root === undefined) {
			throw new Error('A lazy preorder index is missing its document root.');
		}
		const nodeIds: NodeId[] = [];
		const pending: DocumentNode[] = [this.root];
		while (pending.length > 0) {
			const node = pending.pop();
			if (node === undefined) {
				break;
			}
			this.instrumentation?.onNodePayloadRead?.(
				node.id,
				'preorder-materialization',
			);
			nodeIds.push(node.id);
			const children = getDocumentNodeChildren(node);
			for (
				let childIndex = children.length - 1;
				childIndex >= 0;
				childIndex -= 1
			) {
				const child = children[childIndex];
				if (child !== undefined) {
					pending.push(child);
				}
			}
		}
		if (nodeIds.length !== this.expectedNodeCount) {
			throw new Error('A lazy preorder index observed an inconsistent node count.');
		}
		this.value = Object.freeze(nodeIds);
		this.instrumentation?.onPreorderMaterialized?.(nodeIds.length);
		return this.value;
	}
}

interface IUpdatedDocumentIndexRecord {
	readonly ultimateBase: DocumentIndex;
	readonly nodeOverrides: PersistentStringTrie<DocumentNode>;
	readonly parentOverrides: PersistentStringTrie<IVersionedParentLocation>;
	readonly parentVersions: PersistentStringTrie<number>;
	readonly parentOrdinalEdits: PersistentStringTrie<IParentOrdinalEditLog>;
	readonly preorderProvider: LazyPreorderNodeIds;
	readonly instrumentation:
		| IDocumentIndexUpdaterInstrumentation
		| undefined;
	readonly resolvedParentLocationCache: Map<
		NodeId,
		IDocumentNodeParentLocation | null
	>;
}

const updatedDocumentIndexConstructionToken = Object.freeze({});
const updatedDocumentIndexRecords =
	new WeakMap<UpdatedDocumentIndex, IUpdatedDocumentIndexRecord>();

class UpdatedDocumentIndex implements DocumentIndex {
	readonly rootNodeId: NodeId;
	readonly nodeCount: number;

	constructor(constructionToken: object, options: {
		readonly ultimateBase: DocumentIndex;
		readonly nodeOverrides: PersistentStringTrie<DocumentNode>;
		readonly parentOverrides: PersistentStringTrie<IVersionedParentLocation>;
		readonly parentVersions: PersistentStringTrie<number>;
		readonly parentOrdinalEdits: PersistentStringTrie<IParentOrdinalEditLog>;
		readonly preorderProvider: LazyPreorderNodeIds;
		readonly nodeCount: number;
		readonly instrumentation?: IDocumentIndexUpdaterInstrumentation;
	}) {
		if (constructionToken !== updatedDocumentIndexConstructionToken) {
			throw new TypeError(
				'Updated document indexes can only be constructed by the updater.',
			);
		}
		this.rootNodeId = options.ultimateBase.rootNodeId;
		this.nodeCount = options.nodeCount;
		updatedDocumentIndexRecords.set(this, Object.freeze({
			ultimateBase: options.ultimateBase,
			nodeOverrides: options.nodeOverrides,
			parentOverrides: options.parentOverrides,
			parentVersions: options.parentVersions,
			parentOrdinalEdits: options.parentOrdinalEdits,
			preorderProvider: options.preorderProvider,
			instrumentation: options.instrumentation,
			resolvedParentLocationCache: new Map(),
		}));
		Object.freeze(this);
	}

	get preorderNodeIds(): readonly NodeId[] {
		return getUpdatedDocumentIndexRecord(this).preorderProvider.get();
	}

	hasNode(nodeId: NodeId): boolean {
		const record = getUpdatedDocumentIndexRecord(this);
		const entry = record.nodeOverrides.get(nodeId);
		return entry === undefined
			? record.ultimateBase.hasNode(nodeId)
			: entry.kind === 'value';
	}

	getNode(nodeId: NodeId): DocumentNode | undefined {
		const record = getUpdatedDocumentIndexRecord(this);
		const entry = record.nodeOverrides.get(nodeId);
		return entry === undefined
			? record.ultimateBase.getNode(nodeId)
			: entry.kind === 'value'
				? entry.value
				: undefined;
	}

	getParentLocation(
		nodeId: NodeId,
	): IDocumentNodeParentLocation | undefined {
		const record = getUpdatedDocumentIndexRecord(this);
		if (nodeId === this.rootNodeId || !this.hasNode(nodeId)) {
			return undefined;
		}
		const cached = record.resolvedParentLocationCache.get(nodeId);
		if (cached !== undefined) {
			return cached === null ? undefined : cached;
		}
		const overrideEntry = record.parentOverrides.get(nodeId);
		const override = overrideEntry?.kind === 'value'
			? overrideEntry.value
			: undefined;
		const baseLocation = record.ultimateBase.getParentLocation(nodeId);
		const parentNodeId = override?.location.parentNodeId
			?? baseLocation?.parentNodeId;
		if (parentNodeId === undefined) {
			return undefined;
		}
		const parentVersionEntry = record.parentVersions.get(parentNodeId);
		const parentVersion = parentVersionEntry?.kind === 'value'
			? parentVersionEntry.value
			: 0;
		if (
			override !== undefined
			&& override.parentVersion === parentVersion
		) {
			return override.location;
		}
		if (override === undefined && parentVersion === 0) {
			return baseLocation;
		}
		const previousLocation = override?.location ?? baseLocation;
		const previousVersion = override?.parentVersion ?? 0;
		const editEntry = record.parentOrdinalEdits.get(parentNodeId);
		if (
			previousLocation === undefined
			|| previousVersion > parentVersion
			|| editEntry?.kind !== 'value'
		) {
			record.resolvedParentLocationCache.set(nodeId, null);
			return undefined;
		}
		const childIndex = replayParentOrdinalEdits(
			parentNodeId,
			previousLocation.childIndex,
			previousVersion,
			parentVersion,
			editEntry.value,
			record.instrumentation,
		);
		if (childIndex === undefined) {
			record.resolvedParentLocationCache.set(nodeId, null);
			return undefined;
		}
		const resolved = Object.freeze({
			parentNodeId,
			childIndex,
		});
		record.resolvedParentLocationCache.set(nodeId, resolved);
		return resolved;
	}

	iteratePath(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		getUpdatedDocumentIndexRecord(this);
		const path = this.collectPath(nodeId);
		return path?.[Symbol.iterator]();
	}

	iterateAncestors(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		getUpdatedDocumentIndexRecord(this);
		const path = this.collectPath(nodeId);
		return path === undefined
			? undefined
			: path.slice(0, -1).reverse()[Symbol.iterator]();
	}

	private collectPath(nodeId: NodeId): readonly NodeId[] | undefined {
		getUpdatedDocumentIndexRecord(this);
		if (!this.hasNode(nodeId)) {
			return undefined;
		}
		const reversed: NodeId[] = [];
		const seen = new Set<NodeId>();
		let currentNodeId = nodeId;
		while (true) {
			if (seen.has(currentNodeId) || reversed.length > this.nodeCount) {
				return undefined;
			}
			seen.add(currentNodeId);
			reversed.push(currentNodeId);
			if (currentNodeId === this.rootNodeId) {
				break;
			}
			const parentNodeId = this.getParentNodeId(currentNodeId);
			if (parentNodeId === undefined || !this.hasNode(parentNodeId)) {
				return undefined;
			}
			currentNodeId = parentNodeId;
		}
		reversed.reverse();
		return Object.freeze(reversed);
	}

	private getParentNodeId(nodeId: NodeId): NodeId | undefined {
		const record = getUpdatedDocumentIndexRecord(this);
		const entry = record.parentOverrides.get(nodeId);
		return (
			entry?.kind === 'value'
				? entry.value.location.parentNodeId
				: undefined
		) ?? record.ultimateBase.getParentLocation(nodeId)?.parentNodeId;
	}
}

function getUpdatedDocumentIndexRecord(
	index: UpdatedDocumentIndex,
): IUpdatedDocumentIndexRecord {
	const record = updatedDocumentIndexRecords.get(index);
	if (record === undefined) {
		throw new TypeError('Invalid updated document index receiver.');
	}
	return record;
}

function replayParentOrdinalEdits(
	parentNodeId: NodeId,
	initialChildIndex: number,
	previousVersion: number,
	parentVersion: number,
	log: IParentOrdinalEditLog,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): number | undefined {
	if (
		previousVersion < 0
		|| previousVersion >= parentVersion
		|| log.length !== parentVersion
		|| log.tail === undefined
		|| (
			log.tail.startVersion + log.tail.edits.length - 1
			!== parentVersion
		)
	) {
		return undefined;
	}
	const firstVersion = previousVersion + 1;
	const reverseChunks: IParentOrdinalEditChunk[] = [];
	let chunk: IParentOrdinalEditChunk | undefined = log.tail;
	while (
		chunk !== undefined
		&& chunk.startVersion + chunk.edits.length - 1 >= firstVersion
	) {
		reverseChunks.push(chunk);
		if (chunk.startVersion <= firstVersion) {
			break;
		}
		chunk = chunk.previous;
	}
	instrumentation?.onParentOrdinalEditChunksVisited?.(
		parentNodeId,
		reverseChunks.length,
	);
	if (
		reverseChunks.length === 0
		|| reverseChunks[reverseChunks.length - 1]?.startVersion > firstVersion
	) {
		return undefined;
	}

	let childIndex = initialChildIndex;
	let expectedVersion = firstVersion;
	let replayedEditCount = 0;
	for (
		let chunkIndex = reverseChunks.length - 1;
		chunkIndex >= 0;
		chunkIndex -= 1
	) {
		const currentChunk = reverseChunks[chunkIndex];
		if (currentChunk === undefined) {
			return undefined;
		}
		const firstEditIndex = Math.max(
			0,
			expectedVersion - currentChunk.startVersion,
		);
		for (
			let editIndex = firstEditIndex;
			editIndex < currentChunk.edits.length;
			editIndex += 1
		) {
			const edit = currentChunk.edits[editIndex];
			if (edit === undefined || edit.version !== expectedVersion) {
				return undefined;
			}
			expectedVersion += 1;
			replayedEditCount += 1;
			const nextChildIndex = applyParentOrdinalMutation(
				childIndex,
				edit,
			);
			if (nextChildIndex === undefined) {
				instrumentation?.onParentOrdinalEditsReplayed?.(
					parentNodeId,
					replayedEditCount,
				);
				return undefined;
			}
			childIndex = nextChildIndex;
		}
	}
	if (expectedVersion !== parentVersion + 1) {
		return undefined;
	}
	instrumentation?.onParentOrdinalEditsReplayed?.(
		parentNodeId,
		replayedEditCount,
	);
	return childIndex;
}

export function applyParentOrdinalMutation(
	childIndex: number,
	mutation: ParentOrdinalMutation,
): number | undefined {
	if ('sourceChildIndex' in mutation) {
		if (childIndex === mutation.sourceChildIndex) {
			return undefined;
		}
		const indexAfterRemoval = childIndex > mutation.sourceChildIndex
			? childIndex - 1
			: childIndex;
		return indexAfterRemoval >= mutation.destinationChildIndexAfterRemoval
			? indexAfterRemoval + 1
			: indexAfterRemoval;
	}
	if (mutation.kind === 'insert') {
		return childIndex >= mutation.childIndex
			? childIndex + 1
			: childIndex;
	}
	if (mutation.kind === 'delete') {
		if (childIndex === mutation.childIndex) {
			return undefined;
		}
		return childIndex > mutation.childIndex
			? childIndex - 1
			: childIndex;
	}
	return undefined;
}

function appendParentOrdinalEdit(
	log: IParentOrdinalEditLog,
	currentVersion: number,
	mutation: ParentOrdinalMutation,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): IParentOrdinalEditLog {
	if (
		log.length !== currentVersion
		|| (
			currentVersion === 0
				? log.tail !== undefined
				: (
					log.tail === undefined
					|| (
						log.tail.startVersion + log.tail.edits.length - 1
						!== currentVersion
					)
				)
		)
	) {
		throw new Error('A parent ordinal edit log is inconsistent.');
	}
	const version = currentVersion + 1;
	const edit: ParentOrdinalEdit = mutation.kind === 'move'
		? Object.freeze({
			version,
			kind: mutation.kind,
			sourceChildIndex: mutation.sourceChildIndex,
			destinationChildIndexAfterRemoval:
				mutation.destinationChildIndexAfterRemoval,
		})
		: Object.freeze({
			version,
			kind: mutation.kind,
			childIndex: mutation.childIndex,
		});
	let tail: IParentOrdinalEditChunk;
	if (
		log.tail !== undefined
		&& log.tail.edits.length < parentOrdinalEditChunkCapacity
	) {
		instrumentation?.onShallowCopy?.(
			'index-parent-edit-log-chunk',
			log.tail.edits.length,
		);
		tail = Object.freeze({
			startVersion: log.tail.startVersion,
			edits: Object.freeze([...log.tail.edits, edit]),
			...(log.tail.previous === undefined
				? {}
				: { previous: log.tail.previous }),
		});
	} else {
		instrumentation?.onShallowCopy?.(
			'index-parent-edit-log-chunk',
			0,
		);
		tail = Object.freeze({
			startVersion: version,
			edits: Object.freeze([edit]),
			...(log.tail === undefined ? {} : { previous: log.tail }),
		});
	}
	return Object.freeze({
		length: version,
		tail,
	});
}

Object.defineProperty(UpdatedDocumentIndex.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(UpdatedDocumentIndex.prototype);
Object.freeze(UpdatedDocumentIndex);

interface IDocumentIndexUpdate {
	readonly nodeOverrides: ReadonlyMap<NodeId, DocumentNode>;
	readonly parentLocations?: ReadonlyMap<
		NodeId,
		IDocumentNodeParentLocation
	>;
	readonly parentOrdinalEdits?: readonly ParentOrdinalMutationAtParent[];
	readonly removedNodeIds?: readonly NodeId[];
	readonly nodeCount: number;
	readonly topologyChanged: boolean;
}

function createUpdatedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	update: IDocumentIndexUpdate,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex {
	const previous = (
		base instanceof UpdatedDocumentIndex
		&& updatedDocumentIndexRecords.has(base)
	)
		? base
		: undefined;
	const previousRecord = previous === undefined
		? undefined
		: getUpdatedDocumentIndexRecord(previous);
	const ultimateBase = previousRecord?.ultimateBase ?? base;
	let nodeOverrides = previousRecord?.nodeOverrides
		?? PersistentStringTrie.empty<DocumentNode>();
	let parentOverrides = previousRecord?.parentOverrides
		?? PersistentStringTrie.empty<IVersionedParentLocation>();
	let parentVersions = previousRecord?.parentVersions
		?? PersistentStringTrie.empty<number>();
	let parentOrdinalEdits = previousRecord?.parentOrdinalEdits
		?? PersistentStringTrie.empty<IParentOrdinalEditLog>();
	for (const nodeId of update.removedNodeIds ?? []) {
		if (ultimateBase.hasNode(nodeId)) {
			nodeOverrides = nodeOverrides.set(
				nodeId,
				persistentDeleted,
				instrumentation,
				'index-node-overrides',
			);
		} else {
			nodeOverrides = nodeOverrides.unset(
				nodeId,
				instrumentation,
				'index-node-overrides',
			);
		}
		parentVersions = parentVersions.unset(
			nodeId,
			instrumentation,
			'index-parent-versions',
		);
		parentOrdinalEdits = parentOrdinalEdits.unset(
			nodeId,
			instrumentation,
			'index-parent-edits',
		);
		parentOverrides = parentOverrides.unset(
			nodeId,
			instrumentation,
			'index-parent-overrides',
		);
	}
	for (const edit of update.parentOrdinalEdits ?? []) {
		const parentNodeId = edit.parentNodeId;
		const currentEntry = parentVersions.get(parentNodeId);
		const currentVersion = currentEntry?.kind === 'value'
			? currentEntry.value
			: 0;
		const currentEditsEntry = parentOrdinalEdits.get(parentNodeId);
		const currentLog = currentEditsEntry?.kind === 'value'
			? currentEditsEntry.value
			: emptyParentOrdinalEditLog;
		const nextVersion = currentVersion + 1;
		parentVersions = parentVersions.set(
			parentNodeId,
			persistentValue(nextVersion),
			instrumentation,
			'index-parent-versions',
		);
		const nextLog = appendParentOrdinalEdit(
			currentLog,
			currentVersion,
			edit,
			instrumentation,
		);
		parentOrdinalEdits = parentOrdinalEdits.set(
			parentNodeId,
			persistentValue(nextLog),
			instrumentation,
			'index-parent-edits',
		);
		instrumentation?.onParentOrdinalEditLogLength?.(
			parentNodeId,
			nextLog.length,
		);
	}
	for (const [nodeId, node] of update.nodeOverrides) {
		nodeOverrides = nodeOverrides.set(
			nodeId,
			persistentValue(node),
			instrumentation,
			'index-node-overrides',
		);
	}
	for (const [nodeId, location] of update.parentLocations ?? []) {
		const parentVersionEntry = parentVersions.get(location.parentNodeId);
		const parentVersion = parentVersionEntry?.kind === 'value'
			? parentVersionEntry.value
			: 0;
		parentOverrides = parentOverrides.set(
			nodeId,
			persistentValue(Object.freeze({
				location: Object.freeze({
					parentNodeId: location.parentNodeId,
					childIndex: location.childIndex,
				}),
				parentVersion,
			})),
			instrumentation,
			'index-parent-overrides',
		);
	}
	instrumentation?.onIndexOverlayCardinality?.(
		'nodes',
		nodeOverrides.valueEntryCount,
		nodeOverrides.tombstoneEntryCount,
	);
	instrumentation?.onIndexOverlayCardinality?.(
		'parents',
		parentOverrides.valueEntryCount,
		parentOverrides.tombstoneEntryCount,
	);
	instrumentation?.onIndexOverlayCardinality?.(
		'parent-versions',
		parentVersions.valueEntryCount,
		parentVersions.tombstoneEntryCount,
	);
	instrumentation?.onIndexOverlayCardinality?.(
		'parent-edits',
		parentOrdinalEdits.valueEntryCount,
		parentOrdinalEdits.tombstoneEntryCount,
	);
	const preorderProvider = update.topologyChanged
		? new LazyPreorderNodeIds(
			root,
			update.nodeCount,
			instrumentation,
		)
		: previousRecord?.preorderProvider
			?? new LazyPreorderNodeIds(
				undefined,
				update.nodeCount,
				instrumentation,
				base,
			);
	return new UpdatedDocumentIndex(updatedDocumentIndexConstructionToken, {
		ultimateBase,
		nodeOverrides,
		parentOverrides,
		parentVersions,
		parentOrdinalEdits,
		preorderProvider,
		nodeCount: update.nodeCount,
		instrumentation,
	});
}

export function createInsertedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	childIndex: number,
	insertedNode: InsertableNode,
	insertedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>();
	addInsertedSubtree(
		insertedNode,
		nodeOverrides,
		parentLocations,
		instrumentation,
	);
	parentLocations.set(insertedNode.id, Object.freeze({
		parentNodeId,
		childIndex,
	}));
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		parentOrdinalEdits: [{
			parentNodeId,
			kind: 'insert',
			childIndex,
		}],
		nodeCount: base.nodeCount + insertedNodeIds.length,
		topologyChanged: true,
	}, instrumentation);
}

export function createDeletedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	childIndex: number,
	deletedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentOrdinalEdits: [{
			parentNodeId,
			kind: 'delete',
			childIndex,
		}],
		removedNodeIds: deletedNodeIds,
		nodeCount: base.nodeCount - deletedNodeIds.length,
		topologyChanged: true,
	}, instrumentation);
}

export function createSplitDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	left: TextNode,
	right: TextNode,
	leftChildIndex: number,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	nodeOverrides.set(left.id, left);
	nodeOverrides.set(right.id, right);
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[left.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex,
		})],
		[right.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex + 1,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		parentOrdinalEdits: [{
			parentNodeId,
			kind: 'insert',
			childIndex: leftChildIndex + 1,
		}],
		nodeCount: base.nodeCount + 1,
		topologyChanged: true,
	}, instrumentation);
}

export function createJoinDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	left: TextNode,
	rightNodeId: NodeId,
	leftChildIndex: number,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	nodeOverrides.set(left.id, left);
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[left.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		parentOrdinalEdits: [{
			parentNodeId,
			kind: 'delete',
			childIndex: leftChildIndex + 1,
		}],
		removedNodeIds: [rightNodeId],
		nodeCount: base.nodeCount - 1,
		topologyChanged: true,
	}, instrumentation);
}

export function createMovedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	sourceParentNodeId: NodeId,
	destinationParentNodeId: NodeId,
	sourceChildIndex: number,
	destinationChildIndexAfterRemoval: number,
	movedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const parentOrdinalEdits: readonly ParentOrdinalMutationAtParent[] =
		sourceParentNodeId === destinationParentNodeId
			? [Object.freeze({
				parentNodeId: sourceParentNodeId,
				kind: 'move',
				sourceChildIndex,
				destinationChildIndexAfterRemoval,
			})]
			: [
				Object.freeze({
					parentNodeId: sourceParentNodeId,
					kind: 'delete',
					childIndex: sourceChildIndex,
				}),
				Object.freeze({
					parentNodeId: destinationParentNodeId,
					kind: 'insert',
					childIndex: destinationChildIndexAfterRemoval,
				}),
			];
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		sourceParentNodeId === destinationParentNodeId
			? [sourceParentNodeId]
			: [sourceParentNodeId, destinationParentNodeId],
		instrumentation,
		parentOrdinalEdits,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	const finalDestinationParent = nodeOverrides.get(destinationParentNodeId);
	if (
		finalDestinationParent === undefined
		|| !nodeOwnsChildren(finalDestinationParent)
		|| finalDestinationParent.children[
			destinationChildIndexAfterRemoval
		]?.id !== movedNodeIds[0]
	) {
		return undefined;
	}
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[movedNodeIds[0], Object.freeze({
			parentNodeId: destinationParentNodeId,
			childIndex: destinationChildIndexAfterRemoval,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		parentOrdinalEdits,
		nodeCount: base.nodeCount,
		topologyChanged: true,
	}, instrumentation);
}

export function createPayloadUpdatedIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	targetNodeId: NodeId,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[targetNodeId],
		instrumentation,
	);
	return nodeOverrides === undefined
		? undefined
		: createUpdatedDocumentIndex(base, root, {
			nodeOverrides,
			nodeCount: base.nodeCount,
			topologyChanged: false,
		}, instrumentation);
}

export interface IDocumentIndexNormalizationParentChange {
	readonly parentNodeId: NodeId;
	readonly previousChildren: readonly DocumentNode[];
	readonly normalizedChildren: readonly DocumentNode[];
}

export interface ICreateNormalizedDocumentIndexOptions {
	/** Exact index owned by the draft checkpoint being normalized. */
	readonly base: DocumentIndex;
	/** Exact target root returned by the same normalization evaluation. */
	readonly targetRoot: ManuscriptNode;
	/**
	 * Exact before/after direct-child arrays retained by normalization.
	 *
	 * This updater accepts only removal/join-shaped changes: target children
	 * must be an in-order subsequence of the previous children, removed nodes
	 * must be Text leaves, and only retained Text payloads may be replaced.
	 */
	readonly changedParents:
		readonly IDocumentIndexNormalizationParentChange[];
	/**
	 * Changed parents and their rebuilt ancestors in descendant-to-root order.
	 * Each ID is resolved through exact indexed ordinals in `targetRoot`.
	 */
	readonly rehashNodeIds: readonly NodeId[];
	readonly instrumentation?: IDocumentIndexUpdaterInstrumentation;
}

interface ICapturedNormalizationParentChange {
	readonly parentNodeId: NodeId;
	readonly previousChildren: readonly DocumentNode[];
	readonly previousChildValues: readonly DocumentNode[];
	readonly normalizedChildren: readonly DocumentNode[];
	readonly normalizedChildValues: readonly DocumentNode[];
}

interface ICapturedNormalizedDocumentIndexOptions {
	readonly base: DocumentIndex;
	readonly targetRoot: ManuscriptNode;
	readonly changedParents: readonly ICapturedNormalizationParentChange[];
	readonly rehashNodeIds: readonly NodeId[];
	readonly instrumentation?: IDocumentIndexUpdaterInstrumentation;
}

/**
 * Builds the derived index overlay for one trusted normalization batch.
 *
 * This function does not validate or grant document authority. The caller must
 * own the exact base index, target root, parent arrays, and rehash sequence. A
 * mismatch returns `undefined`; no full-tree index rebuild is attempted.
 */
export function createNormalizedDocumentIndex(
	options: ICreateNormalizedDocumentIndexOptions,
): DocumentIndex | undefined {
	const capturedOptions = captureNormalizedDocumentIndexOptions(options);
	if (capturedOptions === undefined) {
		return undefined;
	}
	const {
		base,
		targetRoot,
		changedParents,
		rehashNodeIds,
		instrumentation,
	} = capturedOptions;
	if (targetRoot.id !== base.rootNodeId) {
		return undefined;
	}
	if (changedParents.length === 0) {
		return (
			rehashNodeIds.length === 0
			&& base.getNode(base.rootNodeId) === targetRoot
		)
			? base
			: undefined;
	}

	const parentNodeIds = new Set<NodeId>();
	const removedNodeIds = new Set<NodeId>();
	const parentOrdinalEdits: ParentOrdinalMutationAtParent[] = [];
	const nodeOverrides = new Map<NodeId, DocumentNode>();
	const rehashDepthByNodeId = new Map<NodeId, number>();
	for (const change of changedParents) {
		if (parentNodeIds.has(change.parentNodeId)) {
			return undefined;
		}
		parentNodeIds.add(change.parentNodeId);
		const previousParent = base.getNode(change.parentNodeId);
		if (
			previousParent === undefined
			|| !nodeOwnsChildren(previousParent)
			|| previousParent.children !== change.previousChildren
			|| change.previousChildren === change.normalizedChildren
		) {
			return undefined;
		}
		const derived = deriveNormalizationParentEdits(
			change,
			removedNodeIds,
		);
		if (derived === undefined || derived.length === 0) {
			return undefined;
		}
		parentOrdinalEdits.push(...derived);
	}

	for (const change of changedParents) {
		const targetPath = collectNodesAtExistingPath(
			targetRoot,
			base,
			change.parentNodeId,
			instrumentation,
			parentOrdinalEdits,
		);
		if (targetPath === undefined) {
			return undefined;
		}
		const targetParent = targetPath.nodes[targetPath.nodes.length - 1];
		if (
			targetParent === undefined
			|| !nodeOwnsChildren(targetParent)
			|| targetParent.children !== change.normalizedChildren
		) {
			return undefined;
		}
		for (
			let pathIndex = 0;
			pathIndex < targetPath.nodes.length;
			pathIndex += 1
		) {
			const pathNode = targetPath.nodes[pathIndex];
			if (pathNode === undefined) {
				return undefined;
			}
			const knownDepth = rehashDepthByNodeId.get(pathNode.id);
			if (knownDepth !== undefined && knownDepth !== pathIndex) {
				return undefined;
			}
			rehashDepthByNodeId.set(pathNode.id, pathIndex);
			nodeOverrides.set(pathNode.id, pathNode);
		}
		for (const child of change.normalizedChildValues) {
			const previousNode = base.getNode(child.id);
			if (previousNode !== child) {
				if (
					previousNode?.type !== 'text'
					|| child.type !== 'text'
					|| base.getParentLocation(child.id)?.parentNodeId
						!== change.parentNodeId
				) {
					return undefined;
				}
				nodeOverrides.set(child.id, child);
				const childDepth = targetPath.nodes.length;
				const knownDepth = rehashDepthByNodeId.get(child.id);
				if (knownDepth !== undefined && knownDepth !== childDepth) {
					return undefined;
				}
				rehashDepthByNodeId.set(child.id, childDepth);
			}
		}
	}

	const expectedRehashNodeIds = [...rehashDepthByNodeId]
		.sort(compareNodeDepthDescending)
		.map(([nodeId]) => nodeId);
	if (
		!sameNodeIdSequence(rehashNodeIds, expectedRehashNodeIds)
		|| expectedRehashNodeIds[expectedRehashNodeIds.length - 1]
			!== targetRoot.id
		|| removedNodeIds.size >= base.nodeCount
	) {
		return undefined;
	}
	return createUpdatedDocumentIndex(base, targetRoot, {
		nodeOverrides,
		parentOrdinalEdits,
		removedNodeIds: Object.freeze([...removedNodeIds]),
		nodeCount: base.nodeCount - removedNodeIds.size,
		topologyChanged: true,
	}, instrumentation);
}

function captureNormalizedDocumentIndexOptions(
	value: unknown,
): ICapturedNormalizedDocumentIndexOptions | undefined {
	try {
		const properties = captureClosedDataRecord(
			value,
			['base', 'targetRoot', 'changedParents', 'rehashNodeIds'],
			['instrumentation'],
			false,
		);
		if (properties === undefined) {
			return undefined;
		}
		const changedParentArray = captureFrozenDenseArray<unknown>(
			properties.get('changedParents'),
		);
		const rehashNodeIdArray = captureFrozenDenseArray<unknown>(
			properties.get('rehashNodeIds'),
		);
		if (
			changedParentArray === undefined
			|| rehashNodeIdArray === undefined
		) {
			return undefined;
		}
		const changedParents: ICapturedNormalizationParentChange[] = [];
		for (const rawChange of changedParentArray.values) {
			const changeProperties = captureClosedDataRecord(
				rawChange,
				['parentNodeId', 'previousChildren', 'normalizedChildren'],
				[],
				true,
			);
			if (changeProperties === undefined) {
				return undefined;
			}
			const parentNodeId = changeProperties.get('parentNodeId');
			const previousChildren = captureFrozenDenseArray<DocumentNode>(
				changeProperties.get('previousChildren'),
			);
			const normalizedChildren = captureFrozenDenseArray<DocumentNode>(
				changeProperties.get('normalizedChildren'),
			);
			if (
				typeof parentNodeId !== 'string'
				|| previousChildren === undefined
				|| normalizedChildren === undefined
			) {
				return undefined;
			}
			changedParents.push(Object.freeze({
				parentNodeId: parentNodeId as NodeId,
				previousChildren: previousChildren.source,
				previousChildValues: previousChildren.values,
				normalizedChildren: normalizedChildren.source,
				normalizedChildValues: normalizedChildren.values,
			}));
		}
		const rehashNodeIds: NodeId[] = [];
		for (const nodeId of rehashNodeIdArray.values) {
			if (typeof nodeId !== 'string') {
				return undefined;
			}
			rehashNodeIds.push(nodeId as NodeId);
		}
		const base = properties.get('base');
		const targetRoot = properties.get('targetRoot');
		if (
			typeof base !== 'object'
			|| base === null
			|| typeof targetRoot !== 'object'
			|| targetRoot === null
		) {
			return undefined;
		}
		const instrumentation = properties.get('instrumentation');
		if (
			instrumentation !== undefined
			&& (
				typeof instrumentation !== 'object'
				|| instrumentation === null
			)
		) {
			return undefined;
		}
		return Object.freeze({
			base: base as DocumentIndex,
			targetRoot: targetRoot as ManuscriptNode,
			changedParents: Object.freeze(changedParents),
			rehashNodeIds: Object.freeze(rehashNodeIds),
			...(instrumentation === undefined
				? {}
				: {
					instrumentation:
						instrumentation as IDocumentIndexUpdaterInstrumentation,
				}),
		});
	} catch {
		return undefined;
	}
}

function captureClosedDataRecord(
	value: unknown,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
	requireFrozen: boolean,
): ReadonlyMap<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	const prototype = Object.getPrototypeOf(value);
	if (
		(prototype !== Object.prototype && prototype !== null)
		|| (requireFrozen && !Object.isFrozen(value))
	) {
		return undefined;
	}
	const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
	const ownKeys = Reflect.ownKeys(value);
	if (
		ownKeys.some(
			key => typeof key !== 'string' || !allowedKeys.has(key),
		)
		|| requiredKeys.some(key => !ownKeys.includes(key))
	) {
		return undefined;
	}
	const properties = new Map<string, unknown>();
	for (const key of ownKeys) {
		if (typeof key !== 'string') {
			return undefined;
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !Object.hasOwn(descriptor, 'value')
			|| descriptor.enumerable !== true
		) {
			return undefined;
		}
		properties.set(key, descriptor.value);
	}
	return properties;
}

function captureFrozenDenseArray<T>(
	value: unknown,
): {
	readonly source: readonly T[];
	readonly values: readonly T[];
} | undefined {
	if (
		!Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Array.prototype
		|| !Object.isFrozen(value)
	) {
		return undefined;
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor?.value;
	if (
		typeof length !== 'number'
		|| !Number.isSafeInteger(length)
		|| length < 0
	) {
		return undefined;
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== length + 1 || !ownKeys.includes('length')) {
		return undefined;
	}
	const values: T[] = [];
	for (let index = 0; index < length; index += 1) {
		const key = String(index);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !Object.hasOwn(descriptor, 'value')
			|| descriptor.enumerable !== true
		) {
			return undefined;
		}
		values.push(descriptor.value as T);
	}
	return Object.freeze({
		source: value as readonly T[],
		values: Object.freeze(values),
	});
}

function compareNodeDepthDescending(
	left: readonly [NodeId, number],
	right: readonly [NodeId, number],
): number {
	const depthOrder = right[1] - left[1];
	if (depthOrder !== 0) {
		return depthOrder;
	}
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

function sameNodeIdSequence(
	left: readonly NodeId[],
	right: readonly NodeId[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function deriveNormalizationParentEdits(
	change: ICapturedNormalizationParentChange,
	removedNodeIds: Set<NodeId>,
): readonly ParentOrdinalMutationAtParent[] | undefined {
	const edits: ParentOrdinalMutationAtParent[] = [];
	let previousIndex = 0;
	let currentChildIndex = 0;
	for (const normalizedChild of change.normalizedChildValues) {
		let previousChild = change.previousChildValues[previousIndex];
		while (
			previousChild !== undefined
			&& previousChild.id !== normalizedChild.id
		) {
			if (!recordRemovedNormalizationTextNode(previousChild, removedNodeIds)) {
				return undefined;
			}
			edits.push(Object.freeze({
				parentNodeId: change.parentNodeId,
				kind: 'delete',
				childIndex: currentChildIndex,
			}));
			previousIndex += 1;
			previousChild = change.previousChildValues[previousIndex];
		}
		if (
			previousChild === undefined
			|| previousChild.id !== normalizedChild.id
			|| (
				previousChild !== normalizedChild
				&& (
					previousChild.type !== 'text'
					|| normalizedChild.type !== 'text'
				)
			)
		) {
			return undefined;
		}
		previousIndex += 1;
		currentChildIndex += 1;
	}
	while (previousIndex < change.previousChildValues.length) {
		const previousChild = change.previousChildValues[previousIndex];
		if (
			previousChild === undefined
			|| !recordRemovedNormalizationTextNode(
				previousChild,
				removedNodeIds,
			)
		) {
			return undefined;
		}
		edits.push(Object.freeze({
			parentNodeId: change.parentNodeId,
			kind: 'delete',
			childIndex: currentChildIndex,
		}));
		previousIndex += 1;
	}
	return Object.freeze(edits);
}

function recordRemovedNormalizationTextNode(
	node: DocumentNode,
	removedNodeIds: Set<NodeId>,
): boolean {
	if (node.type !== 'text' || removedNodeIds.has(node.id)) {
		return false;
	}
	removedNodeIds.add(node.id);
	return true;
}

function collectExistingPathOverrides(
	root: ManuscriptNode,
	base: DocumentIndex,
	nodeIds: readonly NodeId[],
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
	ordinalMutations: readonly ParentOrdinalMutationAtParent[] = [],
): Map<NodeId, DocumentNode> | undefined {
	const overrides = new Map<NodeId, DocumentNode>();
	for (const nodeId of nodeIds) {
		const path = collectNodesAtExistingPath(
			root,
			base,
			nodeId,
			instrumentation,
			ordinalMutations,
		);
		if (path === undefined) {
			return undefined;
		}
		for (const node of path.nodes) {
			overrides.set(node.id, node);
		}
	}
	return overrides;
}

function addInsertedSubtree(
	root: DocumentNode,
	nodeOverrides: Map<NodeId, DocumentNode>,
	parentLocations: Map<NodeId, IDocumentNodeParentLocation>,
	instrumentation: IDocumentIndexUpdaterInstrumentation | undefined,
): void {
	const pending: DocumentNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			break;
		}
		instrumentation?.onNodePayloadRead?.(node.id, 'affected-subtree');
		nodeOverrides.set(node.id, node);
		const children = getDocumentNodeChildren(node);
		for (
			let childIndex = children.length - 1;
			childIndex >= 0;
			childIndex -= 1
		) {
			const child = children[childIndex];
			if (child !== undefined) {
				parentLocations.set(child.id, Object.freeze({
					parentNodeId: node.id,
					childIndex,
				}));
				pending.push(child);
			}
		}
	}
}

interface IExistingDocumentPath {
	readonly nodes: readonly DocumentNode[];
	readonly childIndexes: readonly number[];
}

function collectNodesAtExistingPath(
	root: ManuscriptNode,
	index: DocumentIndex,
	nodeId: NodeId,
	instrumentation?: IDocumentIndexUpdaterInstrumentation,
	ordinalMutations: readonly ParentOrdinalMutationAtParent[] = [],
): IExistingDocumentPath | undefined {
	const pathIterator = index.iteratePath(nodeId);
	if (pathIterator === undefined) {
		return undefined;
	}
	const path = [...pathIterator];
	if (path.length === 0 || path[0] !== root.id) {
		return undefined;
	}
	const nodes: DocumentNode[] = [root];
	const childIndexes: number[] = [];
	instrumentation?.onNodePayloadRead?.(root.id, 'changed-path');
	let current: DocumentNode = root;
	for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
		const expectedNodeId = path[pathIndex];
		const location = expectedNodeId === undefined
			? undefined
			: index.getParentLocation(expectedNodeId);
		if (
			expectedNodeId === undefined
			|| location === undefined
			|| location.parentNodeId !== current.id
			|| !nodeOwnsChildren(current)
		) {
			return undefined;
		}
		const childIndex = applyParentOrdinalMutationsAtParent(
			location.childIndex,
			current.id,
			ordinalMutations,
		);
		if (childIndex === undefined) {
			return undefined;
		}
		const next: DocumentNode | undefined = current.children[childIndex];
		if (next === undefined || next.id !== expectedNodeId) {
			return undefined;
		}
		instrumentation?.onNodePayloadRead?.(next.id, 'changed-path');
		nodes.push(next);
		childIndexes.push(childIndex);
		current = next;
	}
	return Object.freeze({
		nodes: Object.freeze(nodes),
		childIndexes: Object.freeze(childIndexes),
	});
}

function applyParentOrdinalMutationsAtParent(
	initialChildIndex: number,
	parentNodeId: NodeId,
	mutations: readonly ParentOrdinalMutationAtParent[],
): number | undefined {
	let childIndex: number | undefined = initialChildIndex;
	for (const mutation of mutations) {
		if (mutation.parentNodeId !== parentNodeId) {
			continue;
		}
		const nextChildIndex = applyParentOrdinalMutation(
			childIndex,
			mutation,
		);
		if (nextChildIndex === undefined) {
			return undefined;
		}
		childIndex = nextChildIndex;
	}
	return childIndex;
}

function nodeOwnsChildren(
	node: DocumentNode,
): node is Extract<DocumentNode, { readonly children: readonly DocumentNode[] }> {
	return 'children' in node;
}
