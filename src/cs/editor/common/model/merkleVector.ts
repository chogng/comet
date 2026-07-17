/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	parseContentHash,
	type ContentHash,
} from 'cs/editor/common/core/identifiers';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import { hashCanonicalJson } from 'cs/editor/common/core/sha256';

export const manuscriptMerkleVectorAlgorithm = 'nireco-merkle-vector-1';
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

export type ManuscriptMerkleVectorPayload =
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'empty';
		readonly role: ManuscriptMerkleVectorRole;
		readonly count: 0;
	}
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'leaf';
		readonly role: ManuscriptMerkleVectorRole;
		readonly level: 0;
		readonly count: number;
		readonly items: readonly ContentHash[];
	}
	| {
		readonly algorithm: typeof manuscriptMerkleVectorAlgorithm;
		readonly fanout: typeof manuscriptMerkleVectorFanout;
		readonly kind: 'branch';
		readonly role: ManuscriptMerkleVectorRole;
		readonly level: number;
		readonly count: number;
		readonly children: readonly {
			readonly count: number;
			readonly hash: ContentHash;
		}[];
	};

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

const manuscriptMerkleVectorRoleValues = new Set<string>(
	Object.values(manuscriptMerkleVectorRoles),
);

/** An immutable, canonically shaped Merkle vector of content hashes. */
export class ManuscriptMerkleVector {
	readonly role: ManuscriptMerkleVectorRole;
	readonly count: number;
	readonly level: number;
	readonly rootHash: ContentHash;

	private constructor(
		role: ManuscriptMerkleVectorRole,
		private readonly root: MerkleVectorNode,
	) {
		this.role = role;
		this.count = root.count;
		this.level = root.level;
		this.rootHash = root.hash;
		Object.freeze(this);
	}

	/** Builds the canonical vector root and immutable update state. */
	static create(
		role: ManuscriptMerkleVectorRole,
		items: readonly ContentHash[],
		observer?: ManuscriptMerkleVectorHashCallObserver,
	): ManuscriptMerkleVector {
		validateRole(role);
		const validatedItems = validateItems(items);
		const root = buildMerkleVector(role, validatedItems, observer);
		return new ManuscriptMerkleVector(role, root);
	}

	/** Reads one item hash without exposing the vector's update state. */
	getItemHash(index: number): ContentHash {
		validateItemIndex(index, this.count);
		return readItemHash(this.root, index);
	}

	/** Replaces one item without changing vector length or mutating the source vector. */
	replaceItem(
		index: number,
		item: ContentHash,
		observer?: ManuscriptMerkleVectorHashCallObserver,
	): ManuscriptMerkleVector {
		validateItemIndex(index, this.count);
		const validatedItem = validateItem(item, index);
		if (readItemHash(this.root, index) === validatedItem) {
			return this;
		}

		const root = replaceMerkleVectorItem(
			this.role,
			this.root,
			index,
			validatedItem,
			observer,
		);
		return new ManuscriptMerkleVector(this.role, root);
	}
}

function buildMerkleVector(
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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
	role: ManuscriptMerkleVectorRole,
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

function validateRole(role: ManuscriptMerkleVectorRole): void {
	if (
		typeof role !== 'string'
		|| !manuscriptMerkleVectorRoleValues.has(role)
	) {
		throw new TypeError('Unsupported manuscript Merkle vector role.');
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
