/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	type ContentHash,
	type EntityId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import { hashCanonicalJson } from 'cs/editor/common/core/sha256';
import type {
	AcademicEntity,
	ClaimEvidenceRelation,
} from 'cs/editor/common/model/academicGraph';
import type { DocumentNode } from 'cs/editor/common/model/manuscript';

export const manuscriptMerkleVectorAlgorithm = 'nireco-merkle-vector-1';
export const manuscriptStructuralMerkleSequenceAlgorithm =
	'nireco-structural-merkle-sequence-1';
export const manuscriptMerkleVectorFanout = 32;

export const manuscriptMerkleVectorRoles = Object.freeze({
	nodeChildren: 'manuscript-node-children',
	metadataAuthors: 'metadata-authors',
	metadataKeywords: 'metadata-keywords',
	academicReferenceSnapshots: 'academic-reference-snapshots',
	academicEvidenceLinks: 'academic-evidence-links',
	academicClaims: 'academic-claims',
	academicClaimEvidenceRelations: 'academic-claim-evidence-relations',
} as const);

export type ManuscriptMerkleVectorRole =
	(typeof manuscriptMerkleVectorRoles)[keyof typeof manuscriptMerkleVectorRoles];

export type ManuscriptStructuralMerkleRole =
	| typeof manuscriptMerkleVectorRoles.nodeChildren
	| typeof manuscriptMerkleVectorRoles.academicReferenceSnapshots
	| typeof manuscriptMerkleVectorRoles.academicEvidenceLinks
	| typeof manuscriptMerkleVectorRoles.academicClaims
	| typeof manuscriptMerkleVectorRoles.academicClaimEvidenceRelations;

export type ManuscriptPositionalMerkleRole =
	| typeof manuscriptMerkleVectorRoles.metadataAuthors
	| typeof manuscriptMerkleVectorRoles.metadataKeywords;

export type ManuscriptStructuralMerkleKey =
	| Readonly<{
		readonly kind: 'node';
		readonly nodeId: NodeId;
	}>
	| Readonly<{
		readonly kind: 'academic-entity';
		readonly entityId: EntityId;
	}>
	| Readonly<{
		readonly kind: 'academic-relation';
		readonly claimId: EntityId;
		readonly evidenceId: EntityId;
	}>;

export type ManuscriptStructuralMerkleItem =
	| DocumentNode
	| AcademicEntity
	| ClaimEvidenceRelation;

export interface IManuscriptStructuralMerkleSequenceItem {
	readonly item: ManuscriptStructuralMerkleItem;
	readonly hash: ContentHash;
}

export interface IManuscriptStructuralMerkleInstrumentation {
	readonly onHashCall?: ManuscriptMerkleVectorHashCallObserver;
	readonly onTrieNodeVisit?: () => void;
	readonly onTrieNodeCopy?: () => void;
	readonly onItemRead?: () => void;
}

export type ManuscriptStructuralMerkleSequencePayload =
	| {
		readonly algorithm: typeof manuscriptStructuralMerkleSequenceAlgorithm;
		readonly kind: 'entry';
		readonly role: ManuscriptStructuralMerkleRole;
		readonly key: ManuscriptStructuralMerkleKey;
		readonly itemHash: ContentHash;
		readonly nextKey: ManuscriptStructuralMerkleKey | null;
	}
	| {
		readonly algorithm: typeof manuscriptStructuralMerkleSequenceAlgorithm;
		readonly kind: 'patricia-leaf';
		readonly role: ManuscriptStructuralMerkleRole;
		readonly pathSuffix: string;
		readonly key: ManuscriptStructuralMerkleKey;
		readonly entryHash: ContentHash;
	}
	| {
		readonly algorithm: typeof manuscriptStructuralMerkleSequenceAlgorithm;
		readonly kind: 'patricia-branch';
		readonly role: ManuscriptStructuralMerkleRole;
		readonly prefix: string;
		readonly children: readonly {
			readonly edge: number;
			readonly hash: ContentHash;
		}[];
	}
	| {
		readonly algorithm: typeof manuscriptStructuralMerkleSequenceAlgorithm;
		readonly kind: 'root';
		readonly role: ManuscriptStructuralMerkleRole;
		readonly count: number;
		readonly headKey: ManuscriptStructuralMerkleKey | null;
		readonly patriciaRootHash: ContentHash | null;
	};

export type ManuscriptMerkleVectorPayload =
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'empty';
		readonly role: ManuscriptPositionalMerkleRole;
		readonly count: 0;
	}
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'leaf';
		readonly role: ManuscriptPositionalMerkleRole;
		readonly level: 0;
		readonly count: number;
		readonly items: readonly ContentHash[];
	}
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'branch';
		readonly role: ManuscriptPositionalMerkleRole;
		readonly level: number;
		readonly count: number;
		readonly children: readonly {
			readonly count: number;
			readonly hash: ContentHash;
		}[];
	}
	| ManuscriptStructuralMerkleSequencePayload;

export type ManuscriptMerkleVectorHashCall = Readonly<{
	readonly domain: typeof manuscriptHashDomains.documentContent;
	readonly payload: ManuscriptMerkleVectorPayload;
	readonly canonicalJson: string;
	readonly hash: ContentHash;
}>;

export type ManuscriptMerkleVectorHashCallObserver = (
	call: ManuscriptMerkleVectorHashCall,
) => void;

type MerkleVectorEmptyNode = Readonly<{
	readonly kind: 'empty';
	readonly level: 0;
	readonly count: 0;
	readonly hash: ContentHash;
}>;

type MerkleVectorLeafNode = Readonly<{
	readonly kind: 'leaf';
	readonly level: 0;
	readonly count: number;
	readonly hash: ContentHash;
	readonly items: readonly ContentHash[];
}>;

type MerkleVectorBranchNode = Readonly<{
	readonly kind: 'branch';
	readonly level: number;
	readonly count: number;
	readonly hash: ContentHash;
	readonly children: readonly MerkleVectorNode[];
}>;

type MerkleVectorNode =
	| MerkleVectorEmptyNode
	| MerkleVectorLeafNode
	| MerkleVectorBranchNode;

interface IStructuralMerkleEntry {
	readonly key: ManuscriptStructuralMerkleKey;
	readonly path: string;
	readonly itemHash: ContentHash;
	readonly nextKey: ManuscriptStructuralMerkleKey | null;
	readonly hash: ContentHash;
}

interface IStructuralPatriciaLeaf {
	readonly kind: 'patricia-leaf';
	readonly pathSuffix: string;
	readonly entry: IStructuralMerkleEntry;
	readonly size: 1;
	readonly hash: ContentHash;
}

interface IStructuralPatriciaBranchChild {
	readonly edge: number;
	readonly node: StructuralPatriciaNode;
}

interface IStructuralPatriciaBranch {
	readonly kind: 'patricia-branch';
	readonly prefix: string;
	readonly children: readonly IStructuralPatriciaBranchChild[];
	readonly size: number;
	readonly hash: ContentHash;
}

type StructuralPatriciaNode =
	| IStructuralPatriciaLeaf
	| IStructuralPatriciaBranch;

interface IStructuralMerkleSequenceRoot {
	readonly kind: 'structural-root';
	readonly count: number;
	readonly headKey: ManuscriptStructuralMerkleKey | null;
	readonly patriciaRoot: StructuralPatriciaNode | undefined;
	readonly hash: ContentHash;
}

type ManuscriptMerkleVectorRoot =
	| MerkleVectorNode
	| IStructuralMerkleSequenceRoot;

const manuscriptStructuralMerkleRoleValues = new Set<string>([
	manuscriptMerkleVectorRoles.nodeChildren,
	manuscriptMerkleVectorRoles.academicReferenceSnapshots,
	manuscriptMerkleVectorRoles.academicEvidenceLinks,
	manuscriptMerkleVectorRoles.academicClaims,
	manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
]);
const manuscriptMerkleVectorConstructionToken = Object.freeze({});

/** An immutable, canonically shaped Merkle vector of content hashes. */
export class ManuscriptMerkleVector {
	readonly role: ManuscriptMerkleVectorRole;
	readonly count: number;
	readonly level: number;
	readonly rootHash: ContentHash;
	readonly #root: ManuscriptMerkleVectorRoot;

	private constructor(
		constructionToken: object,
		role: ManuscriptMerkleVectorRole,
		root: ManuscriptMerkleVectorRoot,
	) {
		if (constructionToken !== manuscriptMerkleVectorConstructionToken) {
			throw new TypeError(
				'Manuscript Merkle vectors can only be constructed by their owner.',
			);
		}
		this.#root = root;
		this.role = role;
		this.count = root.count;
		this.level = root.kind === 'structural-root' ? 0 : root.level;
		this.rootHash = root.hash;
		Object.freeze(this);
	}

	/** Builds the canonical vector root and immutable update state. */
	static create(
		role: ManuscriptPositionalMerkleRole,
		items: readonly ContentHash[],
		observer?: ManuscriptMerkleVectorHashCallObserver,
	): ManuscriptMerkleVector {
		validatePositionalRole(role);
		const validatedItems = validateItems(items);
		const root = buildMerkleVector(role, validatedItems, observer);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			role,
			root,
		);
	}

	/**
	 * Builds a canonical keyed structural sequence. The Patricia shape depends
	 * only on the formal key set; next-key entries commit the exact item order.
	 */
	static createStructural(
		role: ManuscriptStructuralMerkleRole,
		items: readonly IManuscriptStructuralMerkleSequenceItem[],
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ManuscriptMerkleVector {
		validateStructuralRole(role);
		const entries = createStructuralEntries(
			role,
			items,
			instrumentation,
		);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			role,
			createStructuralRoot(
				role,
				entries[0]?.key ?? null,
				buildStructuralPatricia(
					role,
					entries,
					instrumentation,
				),
				entries.length,
				instrumentation,
			),
		);
	}

	/** Reads one item hash without exposing the vector's update state. */
	getItemHash(index: number): ContentHash {
		if (this.#root.kind === 'structural-root') {
			throw new TypeError(
				'A structural manuscript Merkle sequence requires a domain item key.',
			);
		}
		validateItemIndex(index, this.count);
		return readItemHash(this.#root, index);
	}

	/** Replaces one item without changing vector length or mutating the source vector. */
	replaceItem(
		index: number,
		item: ContentHash,
		observer?: ManuscriptMerkleVectorHashCallObserver,
	): ManuscriptMerkleVector {
		if (this.#root.kind === 'structural-root') {
			throw new TypeError(
				'A structural manuscript Merkle sequence requires replaceStructuralItem.',
			);
		}
		validatePositionalRole(this.role);
		validateItemIndex(index, this.count);
		const validatedItem = validateItem(item, index);
		if (readItemHash(this.#root, index) === validatedItem) {
			return this;
		}

		const root = replaceMerkleVectorItem(
			this.role,
			this.#root,
			index,
			validatedItem,
			observer,
		);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			this.role,
			root,
		);
	}

	getStructuralItemHash(
		item: ManuscriptStructuralMerkleItem,
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ContentHash {
		const root = requireStructuralRoot(this.#root);
		const key = deriveStructuralKey(this.role, item);
		const entry = readStructuralEntry(
			root.patriciaRoot,
			encodeStructuralKey(key),
			instrumentation,
		);
		if (entry === undefined || !sameStructuralKey(entry.key, key)) {
			throw new RangeError(
				'The structural manuscript Merkle item is not in the sequence.',
			);
		}
		instrumentation?.onItemRead?.();
		return entry.itemHash;
	}

	replaceStructuralItem(
		item: ManuscriptStructuralMerkleItem,
		hash: ContentHash,
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ManuscriptMerkleVector {
		const root = requireStructuralRoot(this.#root);
		const key = deriveStructuralKey(this.role, item);
		const path = encodeStructuralKey(key);
		const previous = readStructuralEntry(
			root.patriciaRoot,
			path,
			instrumentation,
		);
		if (previous === undefined || !sameStructuralKey(previous.key, key)) {
			throw new RangeError(
				'The structural manuscript Merkle item is not in the sequence.',
			);
		}
		const itemHash = validateItem(hash, 0);
		if (previous.itemHash === itemHash) {
			return this;
		}
		const entry = createStructuralEntry(
			this.role as ManuscriptStructuralMerkleRole,
			key,
			itemHash,
			previous.nextKey,
			instrumentation,
		);
		const patriciaRoot = setStructuralEntry(
			this.role as ManuscriptStructuralMerkleRole,
			root.patriciaRoot,
			entry,
			instrumentation,
		);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			this.role,
			createStructuralRoot(
				this.role as ManuscriptStructuralMerkleRole,
				root.headKey,
				patriciaRoot,
				root.count,
				instrumentation,
			),
		);
	}

	insertStructuralItem(
		item: ManuscriptStructuralMerkleItem,
		hash: ContentHash,
		previousItem: ManuscriptStructuralMerkleItem | undefined,
		nextItem: ManuscriptStructuralMerkleItem | undefined,
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ManuscriptMerkleVector {
		const root = requireStructuralRoot(this.#root);
		const role = this.role as ManuscriptStructuralMerkleRole;
		const key = deriveStructuralKey(role, item);
		const path = encodeStructuralKey(key);
		if (readStructuralEntry(root.patriciaRoot, path, instrumentation) !== undefined) {
			throw new RangeError(
				'The structural manuscript Merkle item already exists.',
			);
		}
		const previousKey = previousItem === undefined
			? null
			: deriveStructuralKey(role, previousItem);
		const nextKey = nextItem === undefined
			? null
			: deriveStructuralKey(role, nextItem);
		let patriciaRoot = root.patriciaRoot;
		let headKey = root.headKey;
		if (previousKey === null) {
			if (!sameNullableStructuralKey(root.headKey, nextKey)) {
				throw new RangeError(
					'The structural insertion head neighbors do not match.',
				);
			}
			headKey = key;
		} else {
			const previousEntry = requireStructuralEntry(
				patriciaRoot,
				previousKey,
				instrumentation,
			);
			if (!sameNullableStructuralKey(previousEntry.nextKey, nextKey)) {
				throw new RangeError(
					'The structural insertion neighbors do not match.',
				);
			}
			patriciaRoot = setStructuralEntry(
				role,
				patriciaRoot,
				createStructuralEntry(
					role,
					previousKey,
					previousEntry.itemHash,
					key,
					instrumentation,
				),
				instrumentation,
			);
		}
		patriciaRoot = setStructuralEntry(
			role,
			patriciaRoot,
			createStructuralEntry(
				role,
				key,
				validateItem(hash, 0),
				nextKey,
				instrumentation,
			),
			instrumentation,
		);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			role,
			createStructuralRoot(
				role,
				headKey,
				patriciaRoot,
				root.count + 1,
				instrumentation,
			),
		);
	}

	removeStructuralItem(
		item: ManuscriptStructuralMerkleItem,
		previousItem: ManuscriptStructuralMerkleItem | undefined,
		nextItem: ManuscriptStructuralMerkleItem | undefined,
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ManuscriptMerkleVector {
		const root = requireStructuralRoot(this.#root);
		const role = this.role as ManuscriptStructuralMerkleRole;
		const key = deriveStructuralKey(role, item);
		const previousKey = previousItem === undefined
			? null
			: deriveStructuralKey(role, previousItem);
		const nextKey = nextItem === undefined
			? null
			: deriveStructuralKey(role, nextItem);
		const target = requireStructuralEntry(
			root.patriciaRoot,
			key,
			instrumentation,
		);
		if (!sameNullableStructuralKey(target.nextKey, nextKey)) {
			throw new RangeError(
				'The structural removal successor does not match.',
			);
		}
		let patriciaRoot = root.patriciaRoot;
		let headKey = root.headKey;
		if (previousKey === null) {
			if (!sameNullableStructuralKey(root.headKey, key)) {
				throw new RangeError(
					'The structural removal head does not match.',
				);
			}
			headKey = nextKey;
		} else {
			const previousEntry = requireStructuralEntry(
				patriciaRoot,
				previousKey,
				instrumentation,
			);
			if (!sameNullableStructuralKey(previousEntry.nextKey, key)) {
				throw new RangeError(
					'The structural removal predecessor does not match.',
				);
			}
			patriciaRoot = setStructuralEntry(
				role,
				patriciaRoot,
				createStructuralEntry(
					role,
					previousKey,
					previousEntry.itemHash,
					nextKey,
					instrumentation,
				),
				instrumentation,
			);
		}
		patriciaRoot = unsetStructuralEntry(
			role,
			patriciaRoot,
			encodeStructuralKey(key),
			instrumentation,
		);
		return new ManuscriptMerkleVector(
			manuscriptMerkleVectorConstructionToken,
			role,
			createStructuralRoot(
				role,
				headKey,
				patriciaRoot,
				root.count - 1,
				instrumentation,
			),
		);
	}

	moveStructuralItem(
		item: ManuscriptStructuralMerkleItem,
		previousItemBefore: ManuscriptStructuralMerkleItem | undefined,
		nextItemBefore: ManuscriptStructuralMerkleItem | undefined,
		previousItemAfter: ManuscriptStructuralMerkleItem | undefined,
		nextItemAfter: ManuscriptStructuralMerkleItem | undefined,
		instrumentation?: IManuscriptStructuralMerkleInstrumentation,
	): ManuscriptMerkleVector {
		const root = requireStructuralRoot(this.#root);
		const role = this.role as ManuscriptStructuralMerkleRole;
		const key = deriveStructuralKey(role, item);
		const target = requireStructuralEntry(
			root.patriciaRoot,
			key,
			instrumentation,
		);
		if (
			sameOptionalStructuralItemKey(
				role,
				previousItemBefore,
				previousItemAfter,
			)
			&& sameOptionalStructuralItemKey(
				role,
				nextItemBefore,
				nextItemAfter,
			)
		) {
			const previousKey = previousItemBefore === undefined
				? null
				: deriveStructuralKey(role, previousItemBefore);
			const nextKey = nextItemBefore === undefined
				? null
				: deriveStructuralKey(role, nextItemBefore);
			if (!sameNullableStructuralKey(target.nextKey, nextKey)) {
				throw new RangeError(
					'The structural move successor does not match.',
				);
			}
			if (previousKey === null) {
				if (!sameNullableStructuralKey(root.headKey, key)) {
					throw new RangeError(
						'The structural move head does not match.',
					);
				}
			} else {
				const previousEntry = requireStructuralEntry(
					root.patriciaRoot,
					previousKey,
					instrumentation,
				);
				if (!sameNullableStructuralKey(previousEntry.nextKey, key)) {
					throw new RangeError(
						'The structural move predecessor does not match.',
					);
				}
			}
			return this;
		}
		const removed = this.removeStructuralItem(
			item,
			previousItemBefore,
			nextItemBefore,
			instrumentation,
		);
		return removed.insertStructuralItem(
			item,
			target.itemHash,
			previousItemAfter,
			nextItemAfter,
			instrumentation,
		);
	}
}

Object.freeze(ManuscriptMerkleVector.prototype);
Object.freeze(ManuscriptMerkleVector);

function createStructuralEntries(
	role: ManuscriptStructuralMerkleRole,
	items: readonly IManuscriptStructuralMerkleSequenceItem[],
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): readonly IStructuralMerkleEntry[] {
	const captured = items.map((source, index) => {
		instrumentation?.onItemRead?.();
		if (source === null || typeof source !== 'object') {
			throw new TypeError(
				`Invalid structural manuscript Merkle item at index ${index}.`,
			);
		}
		const key = deriveStructuralKey(role, source.item);
		return Object.freeze({
			key,
			path: encodeStructuralKey(key),
			itemHash: validateItem(source.hash, index),
		});
	});
	const seen = new Set<string>();
	for (const entry of captured) {
		if (seen.has(entry.path)) {
			throw new TypeError(
				'Duplicate structural manuscript Merkle sequence key.',
			);
		}
		seen.add(entry.path);
	}
	const entries = Object.freeze(captured.map((entry, index) =>
		createStructuralEntry(
			role,
			entry.key,
			entry.itemHash,
			captured[index + 1]?.key ?? null,
			instrumentation,
		)));
	validateStructuralEntryChain(entries);
	return entries;
}

function validateStructuralEntryChain(
	entries: readonly IStructuralMerkleEntry[],
): void {
	const byPath = new Map(entries.map(entry => [entry.path, entry]));
	const seen = new Set<string>();
	let current: IStructuralMerkleEntry | undefined = entries[0];
	while (current !== undefined) {
		if (seen.has(current.path)) {
			throw new TypeError(
				'Structural manuscript Merkle sequence contains a cycle.',
			);
		}
		seen.add(current.path);
		current = current.nextKey === null
			? undefined
			: byPath.get(encodeStructuralKey(current.nextKey));
		if (
			current === undefined
			&& seen.size < entries.length
		) {
			throw new TypeError(
				'Structural manuscript Merkle sequence is disconnected.',
			);
		}
	}
	if (seen.size !== entries.length) {
		throw new TypeError(
			'Structural manuscript Merkle sequence count does not match its chain.',
		);
	}
}

function deriveStructuralKey(
	role: ManuscriptMerkleVectorRole,
	item: ManuscriptStructuralMerkleItem,
): ManuscriptStructuralMerkleKey {
	validateStructuralRole(role);
	if (item === null || typeof item !== 'object') {
		throw new TypeError('Invalid structural manuscript Merkle item.');
	}
	if (role === manuscriptMerkleVectorRoles.nodeChildren) {
		if (
			item.type === 'reference-snapshot'
			|| item.type === 'evidence-link'
			|| item.type === 'claim'
			|| item.type === 'claim-evidence-relation'
		) {
			throw new TypeError('A node child vector requires Document Nodes.');
		}
		const parsed = parseNodeId(item.id);
		if (parsed.type === 'invalid') {
			throw new TypeError('A node child vector requires a canonical Node ID.');
		}
		return Object.freeze({
			kind: 'node',
			nodeId: parsed.value,
		});
	}
	if (role === manuscriptMerkleVectorRoles.academicClaimEvidenceRelations) {
		if (item.type !== 'claim-evidence-relation') {
			throw new TypeError(
				'The relation vector requires Claim-Evidence relations.',
			);
		}
		const claimId = parseEntityId(item.claimId);
		const evidenceId = parseEntityId(item.evidenceId);
		if (claimId.type === 'invalid' || evidenceId.type === 'invalid') {
			throw new TypeError(
				'A relation vector requires canonical Entity IDs.',
			);
		}
		return Object.freeze({
			kind: 'academic-relation',
			claimId: claimId.value,
			evidenceId: evidenceId.value,
		});
	}
	const expectedType =
		role === manuscriptMerkleVectorRoles.academicReferenceSnapshots
			? 'reference-snapshot'
			: role === manuscriptMerkleVectorRoles.academicEvidenceLinks
				? 'evidence-link'
				: 'claim';
	if (item.type !== expectedType) {
		throw new TypeError(
			`The ${role} vector requires ${expectedType} entities.`,
		);
	}
	const parsed = parseEntityId(item.id);
	if (parsed.type === 'invalid') {
		throw new TypeError(
			'An Academic Entity vector requires a canonical Entity ID.',
		);
	}
	return Object.freeze({
		kind: 'academic-entity',
		entityId: parsed.value,
	});
}

function encodeStructuralKey(
	key: ManuscriptStructuralMerkleKey,
): string {
	switch (key.kind) {
		case 'node':
			return uuidNibblePath(key.nodeId);
		case 'academic-entity':
			return uuidNibblePath(key.entityId);
		case 'academic-relation':
			return (
				uuidNibblePath(key.claimId)
				+ uuidNibblePath(key.evidenceId)
			);
	}
}

function uuidNibblePath(value: NodeId | EntityId): string {
	const path = value.replaceAll('-', '');
	if (!/^[0-9a-f]{32}$/.test(path)) {
		throw new TypeError(
			'A structural manuscript Merkle key must be canonical lowercase UUID hex.',
		);
	}
	return path;
}

function createStructuralEntry(
	role: ManuscriptStructuralMerkleRole,
	key: ManuscriptStructuralMerkleKey,
	itemHash: ContentHash,
	nextKey: ManuscriptStructuralMerkleKey | null,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): IStructuralMerkleEntry {
	validateStructuralKeyForRole(role, key);
	if (nextKey !== null) {
		validateStructuralKeyForRole(role, nextKey);
	}
	const payload: ManuscriptStructuralMerkleSequencePayload = Object.freeze({
		algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
		kind: 'entry',
		role,
		key,
		itemHash,
		nextKey,
	});
	return Object.freeze({
		key,
		path: encodeStructuralKey(key),
		itemHash,
		nextKey,
		hash: hashStructuralPayload(payload, instrumentation),
	});
}

function buildStructuralPatricia(
	role: ManuscriptStructuralMerkleRole,
	entries: readonly IStructuralMerkleEntry[],
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
	offset = 0,
): StructuralPatriciaNode | undefined {
	if (entries.length === 0) {
		return undefined;
	}
	if (entries.length === 1) {
		const entry = entries[0] as IStructuralMerkleEntry;
		return createStructuralLeaf(
			role,
			entry.path.slice(offset),
			entry,
			instrumentation,
		);
	}
	const first = entries[0] as IStructuralMerkleEntry;
	let prefixLength = first.path.length - offset;
	for (let index = 1; index < entries.length && prefixLength > 0; index += 1) {
		const entry = entries[index] as IStructuralMerkleEntry;
		let sharedLength = 0;
		while (
			sharedLength < prefixLength
			&& first.path[offset + sharedLength]
				=== entry.path[offset + sharedLength]
		) {
			sharedLength += 1;
		}
		prefixLength = sharedLength;
	}
	const branchOffset = offset + prefixLength;
	if (branchOffset >= first.path.length) {
		throw new TypeError(
			'Duplicate structural manuscript Merkle sequence key.',
		);
	}
	const groups: IStructuralMerkleEntry[][] = Array.from(
		{ length: 16 },
		() => [],
	);
	for (const entry of entries) {
		const edge = nibbleAt(entry.path, branchOffset);
		groups[edge]?.push(entry);
	}
	const children: IStructuralPatriciaBranchChild[] = [];
	for (let edge = 0; edge < groups.length; edge += 1) {
		const group = groups[edge] as IStructuralMerkleEntry[];
		if (group.length === 0) {
			continue;
		}
		children.push(Object.freeze({
			edge,
			node: buildStructuralPatricia(
				role,
				group,
				instrumentation,
				branchOffset + 1,
			) as StructuralPatriciaNode,
		}));
	}
	return createStructuralBranch(
		role,
		first.path.slice(offset, branchOffset),
		children,
		instrumentation,
	);
}

function createStructuralLeaf(
	role: ManuscriptStructuralMerkleRole,
	pathSuffix: string,
	entry: IStructuralMerkleEntry,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): IStructuralPatriciaLeaf {
	validateNibbleString(pathSuffix);
	const payload: ManuscriptStructuralMerkleSequencePayload = Object.freeze({
		algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
		kind: 'patricia-leaf',
		role,
		pathSuffix,
		key: entry.key,
		entryHash: entry.hash,
	});
	instrumentation?.onTrieNodeCopy?.();
	return Object.freeze({
		kind: 'patricia-leaf',
		pathSuffix,
		entry,
		size: 1,
		hash: hashStructuralPayload(payload, instrumentation),
	});
}

function createStructuralBranch(
	role: ManuscriptStructuralMerkleRole,
	prefix: string,
	children: readonly IStructuralPatriciaBranchChild[],
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): IStructuralPatriciaBranch {
	validateNibbleString(prefix);
	if (children.length < 2 || children.length > 16) {
		throw new RangeError(
			'A structural Patricia branch requires between 2 and 16 children.',
		);
	}
	const sorted = [...children].sort((left, right) => left.edge - right.edge);
	for (let index = 0; index < sorted.length; index += 1) {
		const child = sorted[index] as IStructuralPatriciaBranchChild;
		if (
			!Number.isSafeInteger(child.edge)
			|| child.edge < 0
			|| child.edge > 15
			|| (
				index > 0
				&& sorted[index - 1]?.edge === child.edge
			)
		) {
			throw new TypeError(
				'Structural Patricia branch edges must be unique sorted nibbles.',
			);
		}
	}
	const frozenChildren = Object.freeze(sorted.map(child =>
		Object.freeze({
			edge: child.edge,
			node: child.node,
		})));
	const payload: ManuscriptStructuralMerkleSequencePayload = Object.freeze({
		algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
		kind: 'patricia-branch',
		role,
		prefix,
		children: Object.freeze(frozenChildren.map(child =>
			Object.freeze({
				edge: child.edge,
				hash: child.node.hash,
			}))),
	});
	instrumentation?.onTrieNodeCopy?.();
	return Object.freeze({
		kind: 'patricia-branch',
		prefix,
		children: frozenChildren,
		size: frozenChildren.reduce(
			(total, child) => total + child.node.size,
			0,
		),
		hash: hashStructuralPayload(payload, instrumentation),
	});
}

function createStructuralRoot(
	role: ManuscriptStructuralMerkleRole,
	headKey: ManuscriptStructuralMerkleKey | null,
	patriciaRoot: StructuralPatriciaNode | undefined,
	count: number,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): IStructuralMerkleSequenceRoot {
	if (
		!Number.isSafeInteger(count)
		|| count < 0
		|| (
			count === 0
				? headKey !== null || patriciaRoot !== undefined
				: (
					headKey === null
					|| patriciaRoot === undefined
					|| patriciaRoot.size !== count
				)
		)
	) {
		throw new TypeError(
			'Invalid structural manuscript Merkle sequence root state.',
		);
	}
	if (headKey !== null) {
		validateStructuralKeyForRole(role, headKey);
	}
	const payload: ManuscriptStructuralMerkleSequencePayload = Object.freeze({
		algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
		kind: 'root',
		role,
		count,
		headKey,
		patriciaRootHash: patriciaRoot?.hash ?? null,
	});
	return Object.freeze({
		kind: 'structural-root',
		count,
		headKey,
		patriciaRoot,
		hash: hashStructuralPayload(payload, instrumentation),
	});
}

function readStructuralEntry(
	node: StructuralPatriciaNode | undefined,
	path: string,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
	offset = 0,
): IStructuralMerkleEntry | undefined {
	if (node === undefined) {
		return undefined;
	}
	instrumentation?.onTrieNodeVisit?.();
	if (node.kind === 'patricia-leaf') {
		return path.slice(offset) === node.pathSuffix
			&& node.entry.path === path
			? node.entry
			: undefined;
	}
	if (!path.startsWith(node.prefix, offset)) {
		return undefined;
	}
	const edgeOffset = offset + node.prefix.length;
	if (edgeOffset >= path.length) {
		return undefined;
	}
	const edge = nibbleAt(path, edgeOffset);
	const child = node.children.find(candidate => candidate.edge === edge);
	return child === undefined
		? undefined
		: readStructuralEntry(
			child.node,
			path,
			instrumentation,
			edgeOffset + 1,
		);
}

function requireStructuralEntry(
	node: StructuralPatriciaNode | undefined,
	key: ManuscriptStructuralMerkleKey,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): IStructuralMerkleEntry {
	const entry = readStructuralEntry(
		node,
		encodeStructuralKey(key),
		instrumentation,
	);
	if (entry === undefined || !sameStructuralKey(entry.key, key)) {
		throw new RangeError(
			'The structural manuscript Merkle sequence neighbor is missing.',
		);
	}
	instrumentation?.onItemRead?.();
	return entry;
}

function setStructuralEntry(
	role: ManuscriptStructuralMerkleRole,
	node: StructuralPatriciaNode | undefined,
	entry: IStructuralMerkleEntry,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
	offset = 0,
): StructuralPatriciaNode {
	if (node === undefined) {
		return createStructuralLeaf(
			role,
			entry.path.slice(offset),
			entry,
			instrumentation,
		);
	}
	instrumentation?.onTrieNodeVisit?.();
	if (node.kind === 'patricia-leaf') {
		if (node.entry.path === entry.path) {
			return createStructuralLeaf(
				role,
				node.pathSuffix,
				entry,
				instrumentation,
			);
		}
		return buildStructuralPatricia(
			role,
			[node.entry, entry],
			instrumentation,
			offset,
		) as StructuralPatriciaNode;
	}
	const sharedLength = commonStringPrefixLength(
		node.prefix,
		entry.path.slice(offset),
	);
	if (sharedLength < node.prefix.length) {
		const oldEdge = nibbleFromCharacter(node.prefix[sharedLength] as string);
		const oldNode = createStructuralBranch(
			role,
			node.prefix.slice(sharedLength + 1),
			node.children,
			instrumentation,
		);
		const newEdge = nibbleAt(entry.path, offset + sharedLength);
		const newNode = createStructuralLeaf(
			role,
			entry.path.slice(offset + sharedLength + 1),
			entry,
			instrumentation,
		);
		return createStructuralBranch(
			role,
			node.prefix.slice(0, sharedLength),
			[
				{ edge: oldEdge, node: oldNode },
				{ edge: newEdge, node: newNode },
			],
			instrumentation,
		);
	}
	const edgeOffset = offset + node.prefix.length;
	const edge = nibbleAt(entry.path, edgeOffset);
	const childIndex = node.children.findIndex(child => child.edge === edge);
	const children = [...node.children];
	if (childIndex < 0) {
		children.push({
			edge,
			node: createStructuralLeaf(
				role,
				entry.path.slice(edgeOffset + 1),
				entry,
				instrumentation,
			),
		});
	} else {
		const child = children[childIndex] as IStructuralPatriciaBranchChild;
		children[childIndex] = {
			edge,
			node: setStructuralEntry(
				role,
				child.node,
				entry,
				instrumentation,
				edgeOffset + 1,
			),
		};
	}
	return createStructuralBranch(
		role,
		node.prefix,
		children,
		instrumentation,
	);
}

function unsetStructuralEntry(
	role: ManuscriptStructuralMerkleRole,
	node: StructuralPatriciaNode | undefined,
	path: string,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
	offset = 0,
): StructuralPatriciaNode | undefined {
	if (node === undefined) {
		throw new RangeError(
			'The structural manuscript Merkle sequence item is missing.',
		);
	}
	instrumentation?.onTrieNodeVisit?.();
	if (node.kind === 'patricia-leaf') {
		if (
			node.entry.path !== path
			|| path.slice(offset) !== node.pathSuffix
		) {
			throw new RangeError(
				'The structural manuscript Merkle sequence item is missing.',
			);
		}
		return undefined;
	}
	if (!path.startsWith(node.prefix, offset)) {
		throw new RangeError(
			'The structural manuscript Merkle sequence item is missing.',
		);
	}
	const edgeOffset = offset + node.prefix.length;
	const edge = nibbleAt(path, edgeOffset);
	const childIndex = node.children.findIndex(child => child.edge === edge);
	if (childIndex < 0) {
		throw new RangeError(
			'The structural manuscript Merkle sequence item is missing.',
		);
	}
	const child = node.children[childIndex] as IStructuralPatriciaBranchChild;
	const nextChild = unsetStructuralEntry(
		role,
		child.node,
		path,
		instrumentation,
		edgeOffset + 1,
	);
	const children = nextChild === undefined
		? node.children.filter((_, index) => index !== childIndex)
		: node.children.map((candidate, index) =>
			index === childIndex
				? { edge, node: nextChild }
				: candidate);
	if (children.length === 0) {
		return undefined;
	}
	if (children.length === 1) {
		const only = children[0] as IStructuralPatriciaBranchChild;
		const joinedPrefix = `${node.prefix}${only.edge.toString(16)}`;
		return only.node.kind === 'patricia-leaf'
			? createStructuralLeaf(
				role,
				`${joinedPrefix}${only.node.pathSuffix}`,
				only.node.entry,
				instrumentation,
			)
			: createStructuralBranch(
				role,
				`${joinedPrefix}${only.node.prefix}`,
				only.node.children,
				instrumentation,
			);
	}
	return createStructuralBranch(
		role,
		node.prefix,
		children,
		instrumentation,
	);
}

function requireStructuralRoot(
	root: ManuscriptMerkleVectorRoot,
): IStructuralMerkleSequenceRoot {
	if (root.kind !== 'structural-root') {
		throw new TypeError(
			'This manuscript Merkle vector is positional, not structural.',
		);
	}
	return root;
}

function validateStructuralRole(
	role: ManuscriptMerkleVectorRole,
): asserts role is ManuscriptStructuralMerkleRole {
	if (!manuscriptStructuralMerkleRoleValues.has(role)) {
		throw new TypeError(
			'Unsupported structural manuscript Merkle sequence role.',
		);
	}
}

function validateStructuralKeyForRole(
	role: ManuscriptStructuralMerkleRole,
	key: ManuscriptStructuralMerkleKey,
): void {
	const valid =
		role === manuscriptMerkleVectorRoles.nodeChildren
			? key.kind === 'node'
			: role === manuscriptMerkleVectorRoles.academicClaimEvidenceRelations
				? key.kind === 'academic-relation'
				: key.kind === 'academic-entity';
	if (!valid) {
		throw new TypeError(
			'Structural manuscript Merkle key kind does not match its role.',
		);
	}
	encodeStructuralKey(key);
}

function sameStructuralKey(
	left: ManuscriptStructuralMerkleKey,
	right: ManuscriptStructuralMerkleKey,
): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case 'node':
			return right.kind === 'node' && left.nodeId === right.nodeId;
		case 'academic-entity':
			return (
				right.kind === 'academic-entity'
				&& left.entityId === right.entityId
			);
		case 'academic-relation':
			return (
				right.kind === 'academic-relation'
				&& left.claimId === right.claimId
				&& left.evidenceId === right.evidenceId
			);
	}
}

function sameNullableStructuralKey(
	left: ManuscriptStructuralMerkleKey | null,
	right: ManuscriptStructuralMerkleKey | null,
): boolean {
	return left === null || right === null
		? left === right
		: sameStructuralKey(left, right);
}

function sameOptionalStructuralItemKey(
	role: ManuscriptStructuralMerkleRole,
	left: ManuscriptStructuralMerkleItem | undefined,
	right: ManuscriptStructuralMerkleItem | undefined,
): boolean {
	return left === undefined || right === undefined
		? left === right
		: sameStructuralKey(
			deriveStructuralKey(role, left),
			deriveStructuralKey(role, right),
		);
}

function hashStructuralPayload(
	payload: ManuscriptStructuralMerkleSequencePayload,
	instrumentation: IManuscriptStructuralMerkleInstrumentation | undefined,
): ContentHash {
	if (payload.algorithm !== manuscriptStructuralMerkleSequenceAlgorithm) {
		throw new TypeError(
			'Unsupported structural manuscript Merkle sequence algorithm.',
		);
	}
	if (
		payload.kind !== 'entry'
		&& payload.kind !== 'patricia-leaf'
		&& payload.kind !== 'patricia-branch'
		&& payload.kind !== 'root'
	) {
		throw new TypeError(
			'Unsupported structural manuscript Merkle sequence payload kind.',
		);
	}
	return hashPayload(payload, instrumentation?.onHashCall);
}

function commonStringPrefixLength(left: string, right: string): number {
	let length = 0;
	while (
		length < left.length
		&& length < right.length
		&& left[length] === right[length]
	) {
		length += 1;
	}
	return length;
}

function nibbleAt(path: string, index: number): number {
	const character = path[index];
	if (character === undefined) {
		throw new RangeError(
			'Structural Patricia path ended before a branch edge.',
		);
	}
	return nibbleFromCharacter(character);
}

function nibbleFromCharacter(character: string): number {
	if (!/^[0-9a-f]$/.test(character)) {
		throw new TypeError('Structural Patricia paths use lowercase hex nibbles.');
	}
	return Number.parseInt(character, 16);
}

function validateNibbleString(value: string): void {
	if (!/^[0-9a-f]*$/.test(value)) {
		throw new TypeError('Structural Patricia paths use lowercase hex nibbles.');
	}
}

function buildMerkleVector(
	role: ManuscriptPositionalMerkleRole,
	items: readonly ContentHash[],
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): MerkleVectorNode {
	if (items.length === 0) {
		return createEmptyNode(role, observer);
	}

	let currentLevel: readonly MerkleVectorNode[] = createLeafLevel(
		role,
		items,
		observer,
	);
	while (currentLevel.length > 1) {
		currentLevel = createBranchLevel(role, currentLevel, observer);
	}

	const root = currentLevel[0];
	if (root === undefined) {
		throw new Error('The manuscript Merkle vector root was not created.');
	}
	return root;
}

function createLeafLevel(
	role: ManuscriptPositionalMerkleRole,
	items: readonly ContentHash[],
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): readonly MerkleVectorLeafNode[] {
	const leaves: MerkleVectorLeafNode[] = [];
	for (let start = 0; start < items.length; start += manuscriptMerkleVectorFanout) {
		leaves.push(
			createLeafNode(
				role,
				items.slice(start, start + manuscriptMerkleVectorFanout),
				observer,
			),
		);
	}
	return Object.freeze(leaves);
}

function createBranchLevel(
	role: ManuscriptPositionalMerkleRole,
	nodes: readonly MerkleVectorNode[],
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): readonly MerkleVectorBranchNode[] {
	const branches: MerkleVectorBranchNode[] = [];
	for (let start = 0; start < nodes.length; start += manuscriptMerkleVectorFanout) {
		branches.push(
			createBranchNode(
				role,
				nodes.slice(start, start + manuscriptMerkleVectorFanout),
				observer,
			),
		);
	}
	return Object.freeze(branches);
}

function createEmptyNode(
	role: ManuscriptPositionalMerkleRole,
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): MerkleVectorEmptyNode {
	const payload: ManuscriptMerkleVectorPayload = Object.freeze({
		algorithm: manuscriptMerkleVectorAlgorithm,
		fanout: manuscriptMerkleVectorFanout,
		kind: 'empty',
		role,
		count: 0,
	});
	return Object.freeze({
		kind: 'empty',
		level: 0,
		count: 0,
		hash: hashPayload(payload, observer),
	});
}

function createLeafNode(
	role: ManuscriptPositionalMerkleRole,
	items: readonly ContentHash[],
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): MerkleVectorLeafNode {
	const frozenItems = Object.freeze([...items]);
	const payload: ManuscriptMerkleVectorPayload = Object.freeze({
		algorithm: manuscriptMerkleVectorAlgorithm,
		fanout: manuscriptMerkleVectorFanout,
		kind: 'leaf',
		role,
		level: 0,
		count: frozenItems.length,
		items: frozenItems,
	});
	return Object.freeze({
		kind: 'leaf',
		level: 0,
		count: frozenItems.length,
		hash: hashPayload(payload, observer),
		items: frozenItems,
	});
}

function createBranchNode(
	role: ManuscriptPositionalMerkleRole,
	children: readonly MerkleVectorNode[],
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): MerkleVectorBranchNode {
	const first = children[0];
	if (first === undefined || children.length > manuscriptMerkleVectorFanout) {
		throw new RangeError('A manuscript Merkle branch requires between 1 and 32 children.');
	}

	let count = 0;
	const frozenChildren = Object.freeze([...children]);
	const childPayloads = Object.freeze(
		frozenChildren.map(child => {
			if (child.level !== first.level) {
				throw new Error('A manuscript Merkle branch cannot mix child levels.');
			}
			count += child.count;
			return Object.freeze({
				count: child.count,
				hash: child.hash,
			});
		}),
	);
	const level = first.level + 1;
	const payload: ManuscriptMerkleVectorPayload = Object.freeze({
		algorithm: manuscriptMerkleVectorAlgorithm,
		fanout: manuscriptMerkleVectorFanout,
		kind: 'branch',
		role,
		level,
		count,
		children: childPayloads,
	});
	return Object.freeze({
		kind: 'branch',
		level,
		count,
		hash: hashPayload(payload, observer),
		children: frozenChildren,
	});
}

function replaceMerkleVectorItem(
	role: ManuscriptPositionalMerkleRole,
	node: MerkleVectorNode,
	index: number,
	item: ContentHash,
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): MerkleVectorNode {
	if (node.kind === 'leaf') {
		const items = [...node.items];
		items[index] = item;
		return createLeafNode(role, items, observer);
	}
	if (node.kind === 'empty') {
		throw new RangeError('An empty manuscript Merkle vector has no replaceable item.');
	}

	const location = findChildLocation(node.children, index);
	const child = node.children[location.childIndex];
	if (child === undefined) {
		throw new Error('The manuscript Merkle vector child path is incomplete.');
	}
	const nextChild = replaceMerkleVectorItem(
		role,
		child,
		location.relativeIndex,
		item,
		observer,
	);
	const children = [...node.children];
	children[location.childIndex] = nextChild;
	return createBranchNode(role, children, observer);
}

function readItemHash(node: MerkleVectorNode, index: number): ContentHash {
	if (node.kind === 'leaf') {
		const item = node.items[index];
		if (item === undefined) {
			throw new Error('The manuscript Merkle vector leaf is incomplete.');
		}
		return item;
	}
	if (node.kind === 'empty') {
		throw new RangeError('An empty manuscript Merkle vector has no item.');
	}

	const location = findChildLocation(node.children, index);
	const child = node.children[location.childIndex];
	if (child === undefined) {
		throw new Error('The manuscript Merkle vector child path is incomplete.');
	}
	return readItemHash(child, location.relativeIndex);
}

function findChildLocation(
	children: readonly MerkleVectorNode[],
	index: number,
): {
	readonly childIndex: number;
	readonly relativeIndex: number;
} {
	let offset = index;
	for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
		const child = children[childIndex];
		if (child === undefined) {
			break;
		}
		if (offset < child.count) {
			return {
				childIndex,
				relativeIndex: offset,
			};
		}
		offset -= child.count;
	}
	throw new Error('The manuscript Merkle vector index did not resolve to a child.');
}

function hashPayload(
	payload: ManuscriptMerkleVectorPayload,
	observer: ManuscriptMerkleVectorHashCallObserver | undefined,
): ContentHash {
	const result = hashCanonicalJson(manuscriptHashDomains.documentContent, payload);
	if (result.type === 'error') {
		throw new Error(`The manuscript Merkle payload is not canonical JSON at ${result.path}.`);
	}

	observer?.(Object.freeze({
		domain: manuscriptHashDomains.documentContent,
		payload,
		canonicalJson: result.canonicalJson,
		hash: result.hash,
	}));
	return result.hash;
}

function validatePositionalRole(
	role: ManuscriptMerkleVectorRole,
): asserts role is ManuscriptPositionalMerkleRole {
	if (
		typeof role !== 'string'
		|| !(
			role === manuscriptMerkleVectorRoles.metadataAuthors
			|| role === manuscriptMerkleVectorRoles.metadataKeywords
		)
	) {
		throw new TypeError(
			'Unsupported positional manuscript Merkle vector role.',
		);
	}
}

function validateItems(items: readonly ContentHash[]): readonly ContentHash[] {
	const validated: ContentHash[] = [];
	for (let index = 0; index < items.length; index += 1) {
		validated.push(validateItem(items[index], index));
	}
	return Object.freeze(validated);
}

function validateItem(item: ContentHash | undefined, index: number): ContentHash {
	if (typeof item !== 'string') {
		throw new TypeError(`Invalid manuscript Merkle vector item at index ${index}.`);
	}
	const parsed = parseContentHash(item);
	if (parsed.type === 'invalid') {
		throw new TypeError(`Invalid manuscript Merkle vector item at index ${index}.`);
	}
	return parsed.value;
}

function validateItemIndex(index: number, count: number): void {
	if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
		throw new RangeError('Manuscript Merkle vector index is out of range.');
	}
}
