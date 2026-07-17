/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ContentHash,
	EntityId,
	NodeId,
} from 'cs/editor/common/core/identifiers';
import type { ManuscriptMerkleVector } from 'cs/editor/common/model/merkleVector';
import type { DocumentIndex } from 'cs/editor/common/model/documentIndex';
import type {
	DocumentContent,
	RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

export type RevisionMerkleStoreKind =
	| 'node-hashes'
	| 'node-child-vectors'
	| 'entity-hashes'
	| 'relation-hashes';

const revisionMerkleIdentifierTrieDepth = 32;
const revisionMerkleRelationTrieDepth = 64;

export interface IRevisionMerkleStoreInstrumentation {
	readonly onTrieNodeVisit?: (kind: RevisionMerkleStoreKind) => void;
	/**
	 * Reports the slot span allocated by one copy-on-write child array.
	 *
	 * A set that extends a sparse child array reports the resulting span; an
	 * unset reports the source span copied before trailing slots are pruned.
	 */
	readonly onTrieNodeCopy?: (
		kind: RevisionMerkleStoreKind,
		allocatedSlots: number,
	) => void;
}

interface IPersistentRevisionMerkleTrieNode<T> {
	readonly value?: T;
	readonly children: readonly (
		IPersistentRevisionMerkleTrieNode<T> | undefined
	)[];
}

const emptyPersistentRevisionMerkleTrieNode:
	IPersistentRevisionMerkleTrieNode<never> = Object.freeze({
		children: Object.freeze([]),
	});

const persistentRevisionMerkleMapConstructionToken = Object.freeze({});

/**
 * Internal fixed-fanout persistent map keyed by canonical UUID nibbles.
 *
 * Instances are immutable. Updates copy at most one 16-slot path node at each
 * of the 32 identifier levels (64 for a relation key).
 */
export class PersistentRevisionMerkleMap<T> {
	readonly size: number;
	readonly #root: IPersistentRevisionMerkleTrieNode<T>;

	private constructor(
		constructionToken: object,
		root: IPersistentRevisionMerkleTrieNode<T>,
		size: number,
	) {
		if (constructionToken !== persistentRevisionMerkleMapConstructionToken) {
			throw new TypeError(
				'Revision Merkle maps can only be constructed by their owner.',
			);
		}
		this.#root = root;
		this.size = size;
		Object.freeze(this);
	}

	static empty<T>(): PersistentRevisionMerkleMap<T> {
		return new PersistentRevisionMerkleMap<T>(
			persistentRevisionMerkleMapConstructionToken,
			(emptyPersistentRevisionMerkleTrieNode as
				IPersistentRevisionMerkleTrieNode<T>),
			0,
		);
	}

	get(
		key: string,
		kind?: RevisionMerkleStoreKind,
		instrumentation?: IRevisionMerkleStoreInstrumentation,
	): T | undefined {
		const path = encodeRevisionMerkleStoreKey(key);
		let node = this.#root;
		for (const nibble of path) {
			if (kind !== undefined) {
				instrumentation?.onTrieNodeVisit?.(kind);
			}
			const child = node.children[nibble];
			if (child === undefined) {
				return undefined;
			}
			node = child;
		}
		if (kind !== undefined) {
			instrumentation?.onTrieNodeVisit?.(kind);
		}
		return node.value;
	}

	set(
		key: string,
		value: T,
		kind?: RevisionMerkleStoreKind,
		instrumentation?: IRevisionMerkleStoreInstrumentation,
	): PersistentRevisionMerkleMap<T> {
		const path = encodeRevisionMerkleStoreKey(key);
		const previous = this.get(key, kind, instrumentation);
		if (previous === value) {
			return this;
		}
		const root = setPersistentRevisionMerkleTrieValue(
			this.#root,
			path,
			0,
			value,
			kind,
			instrumentation,
		);
		return new PersistentRevisionMerkleMap(
			persistentRevisionMerkleMapConstructionToken,
			root,
			this.size + (previous === undefined ? 1 : 0),
		);
	}

	unset(
		key: string,
		kind?: RevisionMerkleStoreKind,
		instrumentation?: IRevisionMerkleStoreInstrumentation,
	): PersistentRevisionMerkleMap<T> {
		const path = encodeRevisionMerkleStoreKey(key);
		if (this.get(key, kind, instrumentation) === undefined) {
			return this;
		}
		return new PersistentRevisionMerkleMap(
			persistentRevisionMerkleMapConstructionToken,
			unsetPersistentRevisionMerkleTrieValue(
				this.#root,
				path,
				0,
				kind,
				instrumentation,
			) ?? (emptyPersistentRevisionMerkleTrieNode as
				IPersistentRevisionMerkleTrieNode<T>),
			this.size - 1,
		);
	}
}

Object.defineProperty(PersistentRevisionMerkleMap.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(PersistentRevisionMerkleMap.prototype);
Object.freeze(PersistentRevisionMerkleMap);

function setPersistentRevisionMerkleTrieValue<T>(
	node: IPersistentRevisionMerkleTrieNode<T>,
	path: readonly number[],
	depth: number,
	value: T,
	kind: RevisionMerkleStoreKind | undefined,
	instrumentation: IRevisionMerkleStoreInstrumentation | undefined,
): IPersistentRevisionMerkleTrieNode<T> {
	if (kind !== undefined) {
		instrumentation?.onTrieNodeVisit?.(kind);
	}
	if (depth === path.length) {
		return Object.freeze({
			value,
			children: node.children,
		});
	}
	const nibble = path[depth];
	if (nibble === undefined) {
		throw new Error('A Revision Merkle trie received an incomplete key.');
	}
	const child = node.children[nibble]
		?? (emptyPersistentRevisionMerkleTrieNode as
			IPersistentRevisionMerkleTrieNode<T>);
	const nextChild = setPersistentRevisionMerkleTrieValue(
		child,
		path,
		depth + 1,
		value,
		kind,
		instrumentation,
	);
	const children = node.children.slice();
	children[nibble] = nextChild;
	if (kind !== undefined) {
		instrumentation?.onTrieNodeCopy?.(kind, children.length);
	}
	return Object.freeze({
		...(node.value === undefined ? {} : { value: node.value }),
		children: Object.freeze(children),
	});
}

function unsetPersistentRevisionMerkleTrieValue<T>(
	node: IPersistentRevisionMerkleTrieNode<T>,
	path: readonly number[],
	depth: number,
	kind: RevisionMerkleStoreKind | undefined,
	instrumentation: IRevisionMerkleStoreInstrumentation | undefined,
): IPersistentRevisionMerkleTrieNode<T> | undefined {
	if (kind !== undefined) {
		instrumentation?.onTrieNodeVisit?.(kind);
	}
	if (depth === path.length) {
		if (node.children.length === 0) {
			return undefined;
		}
		return Object.freeze({
			children: node.children,
		});
	}
	const nibble = path[depth];
	if (nibble === undefined) {
		return node;
	}
	const child = node.children[nibble];
	if (child === undefined) {
		return node;
	}
	const nextChild = unsetPersistentRevisionMerkleTrieValue(
		child,
		path,
		depth + 1,
		kind,
		instrumentation,
	);
	const children = node.children.slice();
	if (kind !== undefined) {
		instrumentation?.onTrieNodeCopy?.(kind, children.length);
	}
	children[nibble] = nextChild;
	while (
		children.length > 0
		&& children[children.length - 1] === undefined
	) {
		children.pop();
	}
	if (node.value === undefined && children.length === 0) {
		return undefined;
	}
	return Object.freeze({
		...(node.value === undefined ? {} : { value: node.value }),
		children: Object.freeze(children),
	});
}

function encodeRevisionMerkleStoreKey(key: string): readonly number[] {
	const identifiers = key.includes('\0') ? key.split('\0') : [key];
	if (
		(identifiers.length !== 1 && identifiers.length !== 2)
		|| identifiers.some(identifier => !isCanonicalUuid(identifier))
	) {
		throw new TypeError('A Revision Merkle store key must contain canonical UUIDs.');
	}
	const path: number[] = [];
	for (const identifier of identifiers) {
		for (const character of identifier) {
			if (character === '-') {
				continue;
			}
			const nibble = Number.parseInt(character, 16);
			if (!Number.isInteger(nibble) || nibble < 0 || nibble > 15) {
				throw new TypeError('A Revision Merkle store key has a non-hex nibble.');
			}
			path.push(nibble);
		}
	}
	const expectedDepth = identifiers.length === 1
		? revisionMerkleIdentifierTrieDepth
		: revisionMerkleRelationTrieDepth;
	if (path.length !== expectedDepth) {
		throw new TypeError('A Revision Merkle store key has invalid depth.');
	}
	return path;
}

function isCanonicalUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
		.test(value);
}

export interface IRevisionMerkleStateStores {
	readonly nodeHashes: PersistentRevisionMerkleMap<ContentHash>;
	readonly nodeChildVectors:
		PersistentRevisionMerkleMap<ManuscriptMerkleVector>;
	readonly entityHashes: PersistentRevisionMerkleMap<ContentHash>;
	readonly relationHashes: PersistentRevisionMerkleMap<ContentHash>;
}

export interface IRevisionMerkleStateParts {
	readonly documentHash: ContentHash;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly metadataAuthorsVector: ManuscriptMerkleVector;
	readonly metadataKeywordsVector: ManuscriptMerkleVector;
	readonly academicReferenceSnapshotsVector: ManuscriptMerkleVector;
	readonly academicEvidenceLinksVector: ManuscriptMerkleVector;
	readonly academicClaimsVector: ManuscriptMerkleVector;
	readonly academicClaimEvidenceRelationsVector: ManuscriptMerkleVector;
}

const revisionMerkleStateConstructionToken = Object.freeze({});

class PersistentRevisionMerkleState implements RevisionMerkleState {
	readonly documentHash: ContentHash;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly metadataAuthorsVector: ManuscriptMerkleVector;
	readonly metadataKeywordsVector: ManuscriptMerkleVector;
	readonly academicReferenceSnapshotsVector: ManuscriptMerkleVector;
	readonly academicEvidenceLinksVector: ManuscriptMerkleVector;
	readonly academicClaimsVector: ManuscriptMerkleVector;
	readonly academicClaimEvidenceRelationsVector: ManuscriptMerkleVector;

	constructor(
		constructionToken: object,
		parts: IRevisionMerkleStateParts,
		stores: IRevisionMerkleStateStores,
		content: DocumentContent,
		index: DocumentIndex,
	) {
		if (constructionToken !== revisionMerkleStateConstructionToken) {
			throw new TypeError(
				'Revision Merkle states can only be constructed by their owner.',
			);
		}
		this.documentHash = parts.documentHash;
		this.metadataHash = parts.metadataHash;
		this.rootNodeHash = parts.rootNodeHash;
		this.academicGraphHash = parts.academicGraphHash;
		this.settingsHash = parts.settingsHash;
		this.titleHash = parts.titleHash;
		this.abstractHash = parts.abstractHash;
		this.metadataAuthorsVector = parts.metadataAuthorsVector;
		this.metadataKeywordsVector = parts.metadataKeywordsVector;
		this.academicReferenceSnapshotsVector =
			parts.academicReferenceSnapshotsVector;
		this.academicEvidenceLinksVector = parts.academicEvidenceLinksVector;
		this.academicClaimsVector = parts.academicClaimsVector;
		this.academicClaimEvidenceRelationsVector =
			parts.academicClaimEvidenceRelationsVector;
		this.nodeCount = stores.nodeHashes.size;
		this.entityCount = stores.entityHashes.size;
		this.relationCount = stores.relationHashes.size;
		revisionMerkleStateStores.set(this, Object.freeze({ ...stores }));
		revisionMerkleStateBindings.set(this, Object.freeze({
			content,
			index,
		}));
		Object.freeze(this);
	}

	getNodeHash(nodeId: NodeId): ContentHash | undefined {
		const stores = requireRevisionMerkleStateStores(this);
		return stores.nodeHashes.get(nodeId);
	}

	getNodeChildrenVector(nodeId: NodeId): ManuscriptMerkleVector | undefined {
		const stores = requireRevisionMerkleStateStores(this);
		return stores.nodeChildVectors.get(nodeId);
	}

	getEntityHash(entityId: EntityId): ContentHash | undefined {
		const stores = requireRevisionMerkleStateStores(this);
		return stores.entityHashes.get(entityId);
	}

	getRelationHash(
		claimId: EntityId,
		evidenceId: EntityId,
	): ContentHash | undefined {
		const stores = requireRevisionMerkleStateStores(this);
		return stores.relationHashes.get(relationStoreKey(claimId, evidenceId));
	}
}

const revisionMerkleStateStores = new WeakMap<
	RevisionMerkleState,
	IRevisionMerkleStateStores
>();
interface IRevisionMerkleStateBinding {
	readonly content: DocumentContent;
	readonly index: DocumentIndex;
}
const revisionMerkleStateBindings = new WeakMap<
	RevisionMerkleState,
	IRevisionMerkleStateBinding
>();

Object.defineProperty(PersistentRevisionMerkleState.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(PersistentRevisionMerkleState.prototype);
Object.freeze(PersistentRevisionMerkleState);

export function createRevisionMerkleState(
	parts: IRevisionMerkleStateParts,
	stores: IRevisionMerkleStateStores,
	content: DocumentContent,
	index: DocumentIndex,
): RevisionMerkleState {
	return new PersistentRevisionMerkleState(
		revisionMerkleStateConstructionToken,
		parts,
		stores,
		content,
		index,
	);
}

export function requireRevisionMerkleStateBinding(
	state: unknown,
	content: DocumentContent,
	index: DocumentIndex,
): void {
	const binding = typeof state === 'object' && state !== null
		? revisionMerkleStateBindings.get(state as RevisionMerkleState)
		: undefined;
	if (
		binding === undefined
		|| binding.content !== content
		|| binding.index !== index
	) {
		throw new TypeError(
			'Revision Merkle state does not belong to the exact content and index.',
		);
	}
}

export function getRevisionMerkleStateStores(
	state: unknown,
): IRevisionMerkleStateStores | undefined {
	return typeof state === 'object' && state !== null
		? revisionMerkleStateStores.get(state as RevisionMerkleState)
		: undefined;
}

export function requireRevisionMerkleStateStores(
	state: unknown,
): IRevisionMerkleStateStores {
	const stores = getRevisionMerkleStateStores(state);
	if (stores === undefined) {
		throw new TypeError('Invalid Revision Merkle state receiver.');
	}
	return stores;
}

export interface IRevisionMerkleStateStorageWitness {
	readonly authenticatedRecordKeyCount: number;
	readonly predecessorReferenceCount: number;
	readonly directStoreRootCount: number;
	readonly stores: readonly {
		readonly kind: RevisionMerkleStoreKind;
		readonly size: number;
		readonly keyNibbleDepth: 32 | 64;
	}[];
}

/**
 * Returns a topology-only test witness for an authenticated state.
 *
 * No trie root, value, hash, predecessor pointer, or construction authority is
 * exposed. The witness exists so long-chain tests can assert the storage
 * invariant directly instead of inferring it from public own properties.
 */
export function getRevisionMerkleStateStorageWitness(
	state: unknown,
): IRevisionMerkleStateStorageWitness {
	const stores = requireRevisionMerkleStateStores(state);
	const expectedStoreKeys = [
		'nodeHashes',
		'nodeChildVectors',
		'entityHashes',
		'relationHashes',
	] as const;
	const recordKeys = Reflect.ownKeys(stores);
	const predecessorReferenceCount = recordKeys.filter(key =>
		typeof key === 'string'
		&& /(?:previous|predecessor)/u.test(key)).length;
	if (
		recordKeys.length !== expectedStoreKeys.length
		|| expectedStoreKeys.some(key => !recordKeys.includes(key))
		|| recordKeys.some(
			key => typeof key !== 'string'
				|| !expectedStoreKeys.includes(
					key as (typeof expectedStoreKeys)[number],
				),
		)
	) {
		throw new TypeError(
			'Invalid authenticated Revision Merkle storage record shape.',
		);
	}
	const directStoreRootCount = recordKeys.filter(key =>
		typeof key === 'string'
		&& expectedStoreKeys.includes(
			key as (typeof expectedStoreKeys)[number],
		)).length;
	return Object.freeze({
		authenticatedRecordKeyCount: recordKeys.length,
		predecessorReferenceCount,
		directStoreRootCount,
		stores: Object.freeze([
			storageWitness(
				'node-hashes',
				stores.nodeHashes.size,
				revisionMerkleIdentifierTrieDepth,
			),
			storageWitness(
				'node-child-vectors',
				stores.nodeChildVectors.size,
				revisionMerkleIdentifierTrieDepth,
			),
			storageWitness(
				'entity-hashes',
				stores.entityHashes.size,
				revisionMerkleIdentifierTrieDepth,
			),
			storageWitness(
				'relation-hashes',
				stores.relationHashes.size,
				revisionMerkleRelationTrieDepth,
			),
		]),
	});
}

function storageWitness(
	kind: RevisionMerkleStoreKind,
	size: number,
	keyNibbleDepth: 32 | 64,
): IRevisionMerkleStateStorageWitness['stores'][number] {
	return Object.freeze({ kind, size, keyNibbleDepth });
}

export function relationStoreKey(
	claimId: EntityId,
	evidenceId: EntityId,
): string {
	return `${claimId}\0${evidenceId}`;
}
