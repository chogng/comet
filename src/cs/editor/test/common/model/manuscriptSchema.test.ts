/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';
import {
	decodeDocumentSemanticSettingsV1,
	decodeInsertableNodeV1,
	decodeManuscriptMetadataV1,
	decodeManuscriptRootV1,
	decodeMarksV1,
	decodeNodeAttributesV1,
	encodeDocumentSemanticSettingsV1,
	encodeInsertableNodeV1,
	encodeManuscriptMetadataV1,
	encodeManuscriptRootV1,
	encodeMarksV1,
	encodeNodeAttributesV1,
	maximumManuscriptTextUtf16Length,
	type IManuscriptTreeCodecLimits,
	type ManuscriptSchemaFailure,
	type ManuscriptSchemaResult,
} from 'cs/editor/common/model/manuscriptSchema';

const generousTreeLimits: IManuscriptTreeCodecLimits = Object.freeze({
	maximumNodes: 10_000,
	maximumDepth: 256,
	maximumCollectionItems: 10_000,
});

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function hash(sequence: number): string {
	return `sha256:${sequence.toString(16).padStart(64, '0')}`;
}

function json(value: unknown): CanonicalJsonValue {
	return value as CanonicalJsonValue;
}

function createRoot(): CanonicalJsonValue {
	return json({
		id: uuid(1),
		type: 'manuscript',
		attrs: {},
		children: [{
			id: uuid(2),
			type: 'body',
			attrs: {},
			children: [{
				id: uuid(3),
				type: 'paragraph',
				attrs: {
					alignment: 'start',
				},
				children: [{
					id: uuid(4),
					type: 'text',
					value: 'Linked text',
					marks: [
						{ type: 'bold' },
						{
							type: 'link',
							href: 'https://example.test/r%C3%A9sum%C3%A9%20notes/%CE%B1?q%3D%E9%9B%AA',
							title: 'Source',
						},
					],
				}],
			}],
		}],
	});
}

function requireOk<T>(result: ManuscriptSchemaResult<T>): T {
	if (result.type === 'error') {
		throw new Error(`Expected schema success, received ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function assertFailure(
	result: ManuscriptSchemaResult<unknown>,
	reason: ManuscriptSchemaFailure,
	path?: string,
): void {
	assert.equal(result.type, 'error');
	if (result.type === 'error') {
		assert.equal(result.reason, reason);
		if (path !== undefined) {
			assert.equal(result.path, path);
		}
	}
}

suite('Manuscript persisted schema V1', () => {
	test('round trips the exact tree DTO and freezes owned data without freezing URI values', () => {
		const decoded = requireOk(
			decodeManuscriptRootV1(createRoot(), generousTreeLimits),
		);
		const body = decoded.root.children.find(child => child.type === 'body');
		if (body?.type !== 'body') {
			throw new Error('Expected a Body node.');
		}
		const paragraph = body.children[0];
		if (paragraph?.type !== 'paragraph') {
			throw new Error('Expected a Paragraph node.');
		}
		const text = paragraph.children[0];
		assert.equal(text.type, 'text');
		const link = text.marks[1];
		assert.equal(link?.type, 'link');
		if (link?.type !== 'link') {
			throw new Error('Expected a Link Mark.');
		}

		assert.equal(
			link.href.toString(),
			'https://example.test/r%C3%A9sum%C3%A9%20notes/%CE%B1?q%3D%E9%9B%AA',
		);
		assert.equal(Object.isFrozen(decoded.root), true);
		assert.equal(Object.isFrozen(decoded.root.children), true);
		assert.equal(Object.isFrozen(paragraph.attrs), true);
		assert.equal(Object.isFrozen(text.marks), true);
		assert.equal(Object.isFrozen(link), true);
		assert.equal(Object.isFrozen(link.href), false);
		assert.deepStrictEqual(
			requireOk(encodeManuscriptRootV1(decoded.root, generousTreeLimits)),
			createRoot(),
		);
		assert.equal(decoded.nodeCount, 4);
		assert.equal(decoded.getNodeType(text.id), 'text');
	});

	test('rejects missing values, open attributes, and non-canonical Marks', () => {
		const missingTextValue = json({
			id: uuid(10),
			type: 'text',
			marks: [],
		});
		assertFailure(
			decodeInsertableNodeV1(missingTextValue, generousTreeLimits),
			'invalid-node',
			'$.node',
		);

		const openParagraph = json({
			id: uuid(11),
			type: 'paragraph',
			attrs: {
				alignment: 'start',
				extension: true,
			},
			children: [],
		});
		assertFailure(
			decodeInsertableNodeV1(openParagraph, generousTreeLimits),
			'invalid-node-attributes',
			'$.node.attrs',
		);

		for (const [marks, reason] of [
			[
				[{ type: 'link', href: 'https://example.test/' }, { type: 'bold' }],
				'invalid-marks',
			],
			[
				[{ type: 'italic' }, { type: 'italic' }],
				'invalid-marks',
			],
			[
				[{ type: 'subscript' }, { type: 'superscript' }],
				'invalid-marks',
			],
			[
				[{ type: 'link', href: 'https://example.test/a path' }],
				'invalid-uri',
			],
		] as const) {
			assertFailure(
				decodeInsertableNodeV1(json({
					id: uuid(12),
					type: 'text',
					value: '',
					marks,
				}), generousTreeLimits),
				reason,
			);
		}
	});

	test('uses one exported UTF-16 length bound for decoded and encoded Text', () => {
		const bounded = json({
			id: uuid(13),
			type: 'text',
			value: 'x'.repeat(maximumManuscriptTextUtf16Length),
			marks: [],
		});
		const decoded = requireOk(
			decodeInsertableNodeV1(bounded, generousTreeLimits),
		);
		assert.equal(decoded.root.type, 'text');
		assert.equal(
			decoded.root.type === 'text' ? decoded.root.value.length : undefined,
			maximumManuscriptTextUtf16Length,
		);
		requireOk(encodeInsertableNodeV1(decoded.root, generousTreeLimits));

		const oversized = json({
			id: uuid(14),
			type: 'text',
			value: 'x'.repeat(maximumManuscriptTextUtf16Length + 1),
			marks: [],
		});
		assertFailure(
			decodeInsertableNodeV1(oversized, generousTreeLimits),
			'invalid-node',
			'$.node.value',
		);
		assertFailure(
			encodeInsertableNodeV1(oversized, generousTreeLimits),
			'invalid-node',
			'$.node.value',
		);
	});

	test('encoders inspect unknown runtime values without invoking accessors', () => {
		let getterCalls = 0;
		const accessorNode = {
			type: 'text',
			value: '',
			marks: [],
			get id() {
				getterCalls += 1;
				return uuid(90);
			},
		};
		assertFailure(
			encodeInsertableNodeV1(accessorNode, generousTreeLimits),
			'inspection-failed',
			'$.node.id',
		);
		assert.equal(getterCalls, 0);

		assertFailure(
			encodeManuscriptRootV1(new Proxy({}, {
				ownKeys() {
					throw new Error('hostile proxy');
				},
			}), generousTreeLimits),
			'inspection-failed',
			'$.root',
		);

		const metadata = {
			title: 'Title',
			authors: [],
			abstract: 'Abstract',
			get keywords() {
				getterCalls += 1;
				return [];
			},
		};
		assertFailure(
			encodeManuscriptMetadataV1(metadata, 10),
			'inspection-failed',
			'$.metadata.keywords',
		);
		assert.equal(getterCalls, 0);
	});

	test('standalone attribute and Mark codecs reuse the same closed unions', () => {
		const attributes = requireOk(decodeNodeAttributesV1(json({
			uri: 'https://example.test/figure%20one.png',
			contentHash: hash(4),
			altText: 'Figure',
		})));
		const encodedAttributes = requireOk(
			encodeNodeAttributesV1(attributes),
		);
		assert.deepStrictEqual(encodedAttributes, {
			uri: 'https://example.test/figure%20one.png',
			contentHash: hash(4),
			altText: 'Figure',
		});

		const marks = requireOk(decodeMarksV1(json([
			{ type: 'bold' },
			{ type: 'link', href: 'https://example.test/source%20one' },
		]), 10));
		assert.deepStrictEqual(requireOk(encodeMarksV1(marks, 10)), [
			{ type: 'bold' },
			{ type: 'link', href: 'https://example.test/source%20one' },
		]);

		const openAttributes = Object.create(null) as Record<string, unknown>;
		openAttributes['alignment'] = 'start';
		Object.defineProperty(openAttributes, '__proto__', {
			value: { bypass: true },
			enumerable: true,
			configurable: true,
			writable: true,
		});
		assertFailure(
			encodeNodeAttributesV1(openAttributes),
			'invalid-node-attributes',
		);

		const openMark = Object.create(null) as Record<string, unknown>;
		openMark['type'] = 'bold';
		Object.defineProperty(openMark, '__proto__', {
			value: { bypass: true },
			enumerable: true,
			configurable: true,
			writable: true,
		});
		assertFailure(encodeMarksV1([openMark], 10), 'invalid-marks');
		assert.equal(({} as { readonly bypass?: unknown }).bypass, undefined);
	});

	test('collects declared IDs and unresolved references without resolving them locally', () => {
		const citationId = uuid(101);
		const referenceId = uuid(102);
		const targetEntityId = uuid(103);
		const footnoteId = uuid(20);
		const root = json({
			id: uuid(1),
			type: 'manuscript',
			attrs: {},
			children: [{
				id: uuid(2),
				type: 'body',
				attrs: {},
				children: [
					{
						id: uuid(3),
						type: 'paragraph',
						attrs: { alignment: 'start' },
						children: [
							{
								id: uuid(4),
								type: 'citation',
								attrs: {
									citationId,
									referenceId,
								},
							},
							{
								id: uuid(5),
								type: 'crossReference',
								attrs: {
									targetEntityId,
								},
							},
							{
								id: uuid(6),
								type: 'footnoteReference',
								attrs: {
									footnoteNodeId: footnoteId,
								},
							},
						],
					},
					{
						id: footnoteId,
						type: 'footnote',
						attrs: {},
						children: [{
							id: uuid(21),
							type: 'paragraph',
							attrs: { alignment: 'start' },
							children: [],
						}],
					},
				],
			}],
		});

		const decoded = requireOk(
			decodeManuscriptRootV1(root, generousTreeLimits),
		);
		assert.deepStrictEqual(decoded.declaredEntityIds, [citationId]);
		assert.deepStrictEqual(decoded.citationReferences, [{
			entityId: referenceId,
			path: '$.root.children[0].children[0].children[0].attrs.referenceId',
		}]);
		assert.deepStrictEqual(decoded.crossReferences, [{
			entityId: targetEntityId,
			path: '$.root.children[0].children[0].children[1].attrs.targetEntityId',
		}]);
		assert.deepStrictEqual(decoded.footnoteReferences, [{
			nodeId: footnoteId,
			path: '$.root.children[0].children[0].children[2].attrs.footnoteNodeId',
		}]);
		assert.equal(decoded.getNodeType(footnoteId as never), 'footnote');
	});

	test('enforces node, depth, and collection budgets and unique Node IDs', () => {
		assertFailure(
			decodeManuscriptRootV1(createRoot(), {
				...generousTreeLimits,
				maximumNodes: 3,
			}),
			'node-budget-exceeded',
			'$.root.children[0].children[0].children[0]',
		);
		assertFailure(
			decodeManuscriptRootV1(createRoot(), {
				...generousTreeLimits,
				maximumDepth: 2,
			}),
			'node-depth-exceeded',
			'$.root.children[0].children[0].children[0]',
		);
		assertFailure(
			decodeManuscriptRootV1(createRoot(), {
				...generousTreeLimits,
				maximumCollectionItems: 1,
			}),
			'collection-budget-exceeded',
			'$.root.children[0].children[0].children[0].marks',
		);

		const duplicate = createRoot() as Record<string, unknown>;
		const body = (duplicate['children'] as Record<string, unknown>[])[0]!;
		const paragraph = (body['children'] as Record<string, unknown>[])[0]!;
		const text = (paragraph['children'] as Record<string, unknown>[])[0]!;
		text['id'] = paragraph['id'];
		assertFailure(
			decodeManuscriptRootV1(json(duplicate), generousTreeLimits),
			'duplicate-node-id',
			'$.root.children[0].children[0].children[0].id',
		);
	});

	test('enforces section levels and figure, table, and list grammar', () => {
		assertFailure(
			decodeInsertableNodeV1(json({
				id: uuid(30),
				type: 'section',
				attrs: { level: 2 },
				children: [{
					id: uuid(31),
					type: 'heading',
					attrs: { level: 3 },
					children: [],
				}],
			}), generousTreeLimits),
			'section-heading-level-mismatch',
			'$.node.children[0].attrs.level',
		);

		for (const node of [
			{
				id: uuid(40),
				type: 'figure',
				attrs: {},
				children: [{
					id: uuid(41),
					type: 'figureCaption',
					attrs: {},
					children: [],
				}],
			},
			{
				id: uuid(42),
				type: 'table',
				attrs: {},
				children: [{
					id: uuid(43),
					type: 'tableCaption',
					attrs: {},
					children: [],
				}],
			},
			{
				id: uuid(44),
				type: 'list',
				attrs: { ordered: false },
				children: [{
					id: uuid(45),
					type: 'listItem',
					attrs: {},
					children: [{
						id: uuid(46),
						type: 'codeBlock',
						attrs: {},
						children: [],
					}],
				}],
			},
		]) {
			assertFailure(
				decodeInsertableNodeV1(json(node), generousTreeLimits),
				'invalid-node-children',
			);
		}
	});

	test('round trips a valid nested figure, table, and list subtree', () => {
		const table = json({
			id: uuid(50),
			type: 'table',
			attrs: {
				entityId: uuid(150),
				label: 'Table 1',
			},
			children: [
				{
					id: uuid(51),
					type: 'tableCaption',
					attrs: {},
					children: [],
				},
				{
					id: uuid(52),
					type: 'tableRow',
					attrs: {},
					children: [{
						id: uuid(53),
						type: 'tableCell',
						attrs: {},
						children: [{
							id: uuid(54),
							type: 'paragraph',
							attrs: { alignment: 'center' },
							children: [],
						}],
					}],
				},
			],
		});
		const decodedTable = requireOk(
			decodeInsertableNodeV1(table, generousTreeLimits),
		);
		assert.deepStrictEqual(
			requireOk(encodeInsertableNodeV1(
				decodedTable.root,
				generousTreeLimits,
			)),
			table,
		);

		const figure = json({
			id: uuid(60),
			type: 'figure',
			attrs: {},
			children: [
				{
					id: uuid(61),
					type: 'figureAsset',
					attrs: {
						uri: 'https://example.test/image%20one.png',
						contentHash: hash(1),
						altText: 'Figure',
					},
				},
				{
					id: uuid(62),
					type: 'figureCaption',
					attrs: {},
					children: [],
				},
			],
		});
		const decodedFigure = requireOk(
			decodeInsertableNodeV1(figure, generousTreeLimits),
		);
		assert.deepStrictEqual(
			requireOk(encodeInsertableNodeV1(
				decodedFigure.root,
				generousTreeLimits,
			)),
			figure,
		);
	});

	test('decodes canonical metadata sets, preserves author order, and applies collection limits', () => {
		const metadata = json({
			title: 'Title',
			authors: [
				{
					id: uuid(201),
					name: 'First',
					orcid: '0000-0000-0000-0001',
					affiliations: ['Alpha', 'Ωmega'],
				},
				{
					id: uuid(202),
					name: 'Second',
				},
			],
			abstract: 'Abstract',
			keywords: ['alpha', 'βeta'],
		});
		const decoded = requireOk(
			decodeManuscriptMetadataV1(metadata, 10),
		);
		assert.deepStrictEqual(
			decoded.authorEntityIds,
			[uuid(201), uuid(202)],
		);
		assert.equal(decoded.metadata.authors[0]?.name, 'First');
		assert.equal(decoded.metadata.authors[1]?.name, 'Second');
		assert.equal(Object.isFrozen(decoded.metadata), true);
		assert.equal(Object.isFrozen(decoded.metadata.authors), true);
		assert.equal(Object.isFrozen(decoded.metadata.authors[0]), true);
		assert.deepStrictEqual(
			requireOk(encodeManuscriptMetadataV1(decoded.metadata, 10)),
			metadata,
		);

		assertFailure(
			decodeManuscriptMetadataV1(json({
				...(metadata as Record<string, CanonicalJsonValue>),
				keywords: ['βeta', 'alpha'],
			}), 10),
			'invalid-metadata',
			'$.metadata.keywords[1]',
		);
		assertFailure(
			decodeManuscriptMetadataV1(json({
				...(metadata as Record<string, CanonicalJsonValue>),
				authors: [
					{ id: uuid(201), name: 'First' },
					{ id: uuid(201), name: 'Duplicate' },
				],
			}), 10),
			'duplicate-entity-id',
			'$.metadata.authors[1].id',
		);
		assertFailure(
			decodeManuscriptMetadataV1(metadata, 1),
			'collection-budget-exceeded',
			'$.metadata',
		);
	});

	test('round trips exact semantic settings and rejects unsupported fields', () => {
		const settings = json({
			language: 'zh-Hans',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		});
		const decoded = requireOk(
			decodeDocumentSemanticSettingsV1(settings),
		);
		assert.equal(Object.isFrozen(decoded), true);
		assert.deepStrictEqual(
			requireOk(encodeDocumentSemanticSettingsV1(decoded)),
			settings,
		);
		assertFailure(
			decodeDocumentSemanticSettingsV1(json({
				...(settings as Record<string, CanonicalJsonValue>),
				fallbackStyle: 'none',
			})),
			'invalid-settings',
			'$.settings',
		);
		assertFailure(
			decodeDocumentSemanticSettingsV1(json({
				...(settings as Record<string, CanonicalJsonValue>),
				language: 'not_a_language',
			})),
			'invalid-settings',
			'$.settings',
		);
	});
});
