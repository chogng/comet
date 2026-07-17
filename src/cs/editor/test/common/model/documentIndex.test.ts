/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	parseNodeId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import {
	createDocumentIndex,
	defaultDocumentIndexLimits,
	type DocumentIndex,
	type DocumentIndexResult,
} from 'cs/editor/common/model/documentIndex';
import type {
	BibliographyPlaceholderNode,
	BlockNode,
	BlockQuoteNode,
	BodyNode,
	DocumentNode,
	FrontMatterNode,
	ManuscriptNode,
	ParagraphNode,
	TextNode,
} from 'cs/editor/common/model/manuscript';

interface ITestDocument {
	readonly root: ManuscriptNode;
	readonly frontMatter: FrontMatterNode;
	readonly body: BodyNode;
	readonly paragraph: ParagraphNode;
	readonly text: TextNode;
	readonly bibliography: BibliographyPlaceholderNode;
}

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(
		`018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function createTestDocument(): ITestDocument {
	const text: TextNode = {
		id: nodeId(5),
		type: 'text',
		value: 'indexed',
		marks: [],
	};
	const paragraph: ParagraphNode = {
		id: nodeId(4),
		type: 'paragraph',
		attrs: {
			alignment: 'start',
		},
		children: [text],
	};
	const frontMatter: FrontMatterNode = {
		id: nodeId(2),
		type: 'frontMatter',
		attrs: {},
		children: [],
	};
	const body: BodyNode = {
		id: nodeId(3),
		type: 'body',
		attrs: {},
		children: [paragraph],
	};
	const bibliography: BibliographyPlaceholderNode = {
		id: nodeId(6),
		type: 'bibliographyPlaceholder',
		attrs: {
			heading: 'References',
		},
	};
	const root: ManuscriptNode = {
		id: nodeId(1),
		type: 'manuscript',
		attrs: {},
		children: [frontMatter, body, bibliography],
	};
	return {
		root,
		frontMatter,
		body,
		paragraph,
		text,
		bibliography,
	};
}

function requireIndex(result: DocumentIndexResult): DocumentIndex {
	if (result.type === 'error') {
		throw new Error(`Expected a document index, received ${result.error.reason}.`);
	}
	assert.equal(result.type, 'ok');
	return result.value;
}

function rootWithBlocks(
	blocks: readonly [BlockNode, ...BlockNode[]],
	rootSequence: number,
	bodySequence: number,
): ManuscriptNode {
	const body: BodyNode = {
		id: nodeId(bodySequence),
		type: 'body',
		attrs: {},
		children: blocks,
	};
	return {
		id: nodeId(rootSequence),
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
}

suite('Document revision index', () => {
	test('indexes nodes in stable preorder with immutable parent locations', () => {
		const document = createTestDocument();
		const index = requireIndex(createDocumentIndex(document.root));

		assert.equal(index.rootNodeId, document.root.id);
		assert.equal(index.nodeCount, 6);
		assert.deepStrictEqual(index.preorderNodeIds, [
			document.root.id,
			document.frontMatter.id,
			document.body.id,
			document.paragraph.id,
			document.text.id,
			document.bibliography.id,
		]);
		assert.equal(index.hasNode(document.text.id), true);
		assert.equal(index.hasNode(nodeId(900)), false);
		assert.equal(index.getNode(document.text.id), document.text);
		assert.equal(index.getNode(nodeId(900)), undefined);
		assert.equal(index.getParentLocation(document.root.id), undefined);
		assert.deepStrictEqual(index.getParentLocation(document.frontMatter.id), {
			parentNodeId: document.root.id,
			childIndex: 0,
		});
		assert.deepStrictEqual(index.getParentLocation(document.body.id), {
			parentNodeId: document.root.id,
			childIndex: 1,
		});
		assert.deepStrictEqual(index.getParentLocation(document.text.id), {
			parentNodeId: document.paragraph.id,
			childIndex: 0,
		});
		assert.equal(Object.isFrozen(index), true);
		assert.equal(Object.isFrozen(index.preorderNodeIds), true);
		assert.equal(
			Object.isFrozen(index.getParentLocation(document.text.id)),
			true,
		);
	});

	test('hides construction and private topology stores from hostile callers', () => {
		const document = createTestDocument();
		const index = requireIndex(createDocumentIndex(document.root));
		const prototype = Object.getPrototypeOf(index) as object;

		assert.deepStrictEqual(
			Reflect.ownKeys(index).sort(),
			['nodeCount', 'preorderNodeIds', 'rootNodeId'],
		);
		assert.equal(Object.isFrozen(prototype), true);
		assert.deepStrictEqual(
			Object.getOwnPropertyDescriptor(prototype, 'constructor'),
			{
				value: undefined,
				writable: false,
				enumerable: false,
				configurable: false,
			},
		);
		const exposedConstructor =
			(prototype as { readonly constructor?: Function }).constructor;
		assert.throws(
			() => Reflect.construct(
				exposedConstructor as Function,
					[
						Object.freeze({}),
						document.root.id,
						new Map(),
						new Map(),
						[],
					],
				),
			TypeError,
		);
		assert.throws(
			() => (Object.create(prototype) as DocumentIndex)
				.getNode(document.root.id),
			TypeError,
		);
		assert.throws(
			() => new Proxy(index, {}).getNode(document.root.id),
			TypeError,
		);
	});

	test('creates path and ancestor iterators only when requested', () => {
		const document = createTestDocument();
		const index = requireIndex(createDocumentIndex(document.root));
		const firstPath = index.iteratePath(document.text.id);
		const secondPath = index.iteratePath(document.text.id);

		assert.notEqual(firstPath, secondPath);
		assert.deepStrictEqual(firstPath === undefined ? undefined : [...firstPath], [
			document.root.id,
			document.body.id,
			document.paragraph.id,
			document.text.id,
		]);
		assert.deepStrictEqual(secondPath === undefined ? undefined : [...secondPath], [
			document.root.id,
			document.body.id,
			document.paragraph.id,
			document.text.id,
		]);
		const ancestors = index.iterateAncestors(document.text.id);
		assert.deepStrictEqual(ancestors === undefined ? undefined : [...ancestors], [
			document.paragraph.id,
			document.body.id,
			document.root.id,
		]);
		const rootPath = index.iteratePath(document.root.id);
		assert.deepStrictEqual(rootPath === undefined ? undefined : [...rootPath], [
			document.root.id,
		]);
		const rootAncestors = index.iterateAncestors(document.root.id);
		assert.deepStrictEqual(
			rootAncestors === undefined ? undefined : [...rootAncestors],
			[],
		);
		assert.equal(index.iteratePath(nodeId(900)), undefined);
		assert.equal(index.iterateAncestors(nodeId(900)), undefined);
	});

	test('rejects non-canonical Node IDs', () => {
		const document = createTestDocument();
		const invalidText: TextNode = {
			...document.text,
			id: '018F0000-0000-7000-8000-000000000005' as NodeId,
		};
		const paragraph: ParagraphNode = {
			...document.paragraph,
			children: [invalidText],
		};
		const body: BodyNode = {
			...document.body,
			children: [paragraph],
		};
		const root: ManuscriptNode = {
			...document.root,
			children: [document.frontMatter, body, document.bibliography],
		};

		assert.deepStrictEqual(createDocumentIndex(root), {
			type: 'error',
			error: {
				reason: 'invalid-node-id',
				nodeId: '018F0000-0000-7000-8000-000000000005',
				depth: 3,
			},
		});
	});

	test('rejects duplicate Node IDs independently of object identity', () => {
		const document = createTestDocument();
		const duplicateText: TextNode = {
			...document.text,
			value: 'duplicate',
		};
		const paragraph: ParagraphNode = {
			...document.paragraph,
			children: [document.text, duplicateText],
		};
		const body: BodyNode = {
			...document.body,
			children: [paragraph],
		};
		const root: ManuscriptNode = {
			...document.root,
			children: [document.frontMatter, body, document.bibliography],
		};

		assert.deepStrictEqual(createDocumentIndex(root), {
			type: 'error',
			error: {
				reason: 'duplicate-node-id',
				nodeId: document.text.id,
				depth: 3,
			},
		});
	});

	test('rejects active-path cycles without recursive traversal', () => {
		const children: BlockNode[] = [];
		const cyclic = {
			id: nodeId(102),
			type: 'blockQuote',
			attrs: {},
			children,
		} as unknown as BlockQuoteNode;
		children.push(cyclic);
		const root = rootWithBlocks([cyclic], 100, 101);

		assert.deepStrictEqual(createDocumentIndex(root), {
			type: 'error',
			error: {
				reason: 'cyclic-node-reference',
				nodeId: cyclic.id,
				depth: 3,
			},
		});
	});

	test('enforces independent node and depth limits', () => {
		const document = createTestDocument();

		assert.deepStrictEqual(createDocumentIndex(document.root, {
			maximumNodes: 2,
			maximumDepth: 20,
		}), {
			type: 'error',
			error: {
				reason: 'node-budget-exceeded',
				maximumNodes: 2,
				depth: 1,
			},
		});
		assert.deepStrictEqual(createDocumentIndex(document.root, {
			maximumNodes: 20,
			maximumDepth: 2,
		}), {
			type: 'error',
			error: {
				reason: 'node-depth-exceeded',
				maximumDepth: 2,
				depth: 3,
			},
		});
	});

	test('rejects invalid limits before traversing the root', () => {
		const document = createTestDocument();
		for (const limits of [
			{
				maximumNodes: -1,
				maximumDepth: 1,
			},
			{
				maximumNodes: 1.5,
				maximumDepth: 1,
			},
			{
				maximumNodes: 1,
				maximumDepth: Number.POSITIVE_INFINITY,
			},
		]) {
			const result = createDocumentIndex(document.root, limits);
			assert.deepStrictEqual(result, {
				type: 'error',
				error: {
					reason: 'invalid-limits',
				},
			});
			assert.equal(Object.isFrozen(result), true);
			assert.equal(
				result.type === 'error' && Object.isFrozen(result.error),
				true,
			);
		}
	});

	test('indexes and walks a 20k-deep document without using the call stack', () => {
		const maximumDepth = 20_000;
		const deepDocument = createDeepDocument(maximumDepth);
		const index = requireIndex(createDocumentIndex(deepDocument.root, {
			maximumNodes: maximumDepth + 1,
			maximumDepth,
		}));

		assert.equal(index.nodeCount, maximumDepth + 1);
		assert.equal(index.preorderNodeIds[0], deepDocument.root.id);
		assert.equal(index.preorderNodeIds.at(-1), deepDocument.deepestNodeId);

		const path = index.iteratePath(deepDocument.deepestNodeId);
		assert.notEqual(path, undefined);
		let pathLength = 0;
		for (const currentNodeId of path ?? []) {
			if (pathLength === 0) {
				assert.equal(currentNodeId, deepDocument.root.id);
			}
			pathLength += 1;
		}
		assert.equal(pathLength, maximumDepth + 1);

		const ancestors = index.iterateAncestors(deepDocument.deepestNodeId);
		let ancestorCount = 0;
		for (const _ancestor of ancestors ?? []) {
			ancestorCount += 1;
		}
		assert.equal(ancestorCount, maximumDepth);
	});

	test('answers parent locations without rescanning a 20k-wide parent', () => {
		const childCount = 20_000;
		let childIdReads = 0;
		const childIds = Array.from(
			{ length: childCount },
			(_, childIndex) => nodeId(childIndex + 3),
		);
		const children = childIds.map(id =>
			new Proxy<ParagraphNode>({
				id,
				type: 'paragraph',
				attrs: {
					alignment: 'start',
				},
				children: [],
			}, {
				get(target, property, receiver): unknown {
					if (property === 'id') {
						childIdReads += 1;
					}
					return Reflect.get(target, property, receiver);
				},
			})) as [ParagraphNode, ...ParagraphNode[]];
		const body: BodyNode = {
			id: nodeId(2),
			type: 'body',
			attrs: {},
			children,
		};
		const root: ManuscriptNode = {
			id: nodeId(1),
			type: 'manuscript',
			attrs: {},
			children: [body],
		};
		const index = requireIndex(createDocumentIndex(root));
		childIdReads = 0;
		Object.defineProperty(body, 'children', {
			configurable: true,
			get(): never {
				throw new Error('Parent children must not be rescanned after indexing.');
			},
		});

		for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
			const childId = childIds[childIndex];
			assert.notEqual(childId, undefined);
			assert.deepStrictEqual(index.getParentLocation(childId), {
				parentNodeId: body.id,
				childIndex,
			});
		}
		const lastChildId = childIds.at(-1);
		assert.notEqual(lastChildId, undefined);
		assert.deepStrictEqual(
			lastChildId === undefined
				? undefined
				: [...(index.iteratePath(lastChildId) ?? [])],
			lastChildId === undefined
				? undefined
				: [root.id, body.id, lastChildId],
		);
		assert.equal(childIdReads, 0);
	});

	test('isolates topology collections from caller mutation', () => {
		const document = createTestDocument();
		const limits = {
			maximumNodes: defaultDocumentIndexLimits.maximumNodes,
			maximumDepth: defaultDocumentIndexLimits.maximumDepth,
		};
		const index = requireIndex(createDocumentIndex(document.root, limits));
		const expectedPreorder = [...index.preorderNodeIds];
		const textParent = index.getParentLocation(document.text.id);
		assert.notEqual(textParent, undefined);

		(document.root.children as unknown as DocumentNode[]).reverse();
		(document.body.children as unknown as BlockNode[]).length = 0;
		limits.maximumNodes = 0;
		limits.maximumDepth = 0;

		assert.deepStrictEqual(index.preorderNodeIds, expectedPreorder);
		assert.equal(index.nodeCount, expectedPreorder.length);
		assert.deepStrictEqual(index.getParentLocation(document.text.id), {
			parentNodeId: document.paragraph.id,
			childIndex: 0,
		});
		const path = index.iteratePath(document.text.id);
		assert.deepStrictEqual(path === undefined ? undefined : [...path], [
			document.root.id,
			document.body.id,
			document.paragraph.id,
			document.text.id,
		]);
		assert.throws(() => {
			(index.preorderNodeIds as NodeId[]).push(nodeId(901));
		}, TypeError);
		assert.throws(() => {
			(textParent as { childIndex: number }).childIndex = 99;
		}, TypeError);
	});
});

function createDeepDocument(maximumDepth: number): {
	readonly root: ManuscriptNode;
	readonly deepestNodeId: NodeId;
} {
	const deepestNodeId = nodeId(maximumDepth + 1);
	let current: BlockNode = {
		id: deepestNodeId,
		type: 'paragraph',
		attrs: {
			alignment: 'start',
		},
		children: [],
	};

	for (let depth = maximumDepth - 1; depth >= 2; depth -= 1) {
		current = {
			id: nodeId(depth + 1),
			type: 'blockQuote',
			attrs: {},
			children: [current],
		};
	}

	const body: BodyNode = {
		id: nodeId(2),
		type: 'body',
		attrs: {},
		children: [current],
	};
	return {
		root: {
			id: nodeId(1),
			type: 'manuscript',
			attrs: {},
			children: [body],
		},
		deepestNodeId,
	};
}
