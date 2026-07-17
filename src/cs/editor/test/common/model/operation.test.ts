/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseRevisionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type OperationId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import type {
	ClaimEntity,
	ClaimEvidenceRelation,
	EvidenceLink,
	ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';
import type { ActorRef } from 'cs/editor/common/model/actor';
import type {
	InsertableNode,
	Mark,
} from 'cs/editor/common/model/manuscript';
import {
	decodePersistedOperationV1,
	encodePersistedOperationV1,
	operationKinds,
	persistedOperationFormat,
	persistedOperationFormatVersion,
	persistedOperationJsonLimits,
	type IPersistedOperationV1,
	type Operation,
	type ReplaceAcademicEntityOperation,
	type ReplaceTextOperation,
	type SetClaimEvidenceRelationOperation,
	type SetTextMarksOperation,
	type SplitTextOperation,
} from 'cs/editor/common/model/operation';

const hashA = contentHash(
	'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
const hashB = contentHash(
	'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
);
const resource = createManuscriptDraftResource(uuid(900));
const otherResource = createManuscriptDraftResource(uuid(902));
const revision = revisionId(uuid(901));
const richSourceUri = URI.from({
	scheme: 'https',
	authority: 'example.test',
	path: '/résumé notes/α',
	query: 'q=雪',
});
const human: ActorRef = {
	type: 'human',
	id: 'reviewer-1',
};
const referenceId = entityId(uuid(301));
const evidenceId = entityId(uuid(302));
const claimId = entityId(uuid(303));
const textNodeId = nodeId(uuid(201));
const rightTextNodeId = nodeId(uuid(202));

const reference: ReferenceSnapshot = {
	id: referenceId,
	type: 'reference-snapshot',
	externalUri: richSourceUri,
	cslJson: {
		title: 'Reference title',
		issued: {
			'date-parts': [[2026]],
		},
	},
	capturedAt: '2026-07-16T12:00:00.000Z',
	sourceProvider: 'test-provider',
};

const evidence: EvidenceLink = {
	id: evidenceId,
	type: 'evidence-link',
	sourceUri: richSourceUri,
	sourceContentHash: hashA,
	locator: {
		kind: 'text-quote',
		exact: 'Evidence',
		prefix: 'Before ',
		suffix: ' after',
	},
	excerpt: 'Evidence excerpt',
	verificationStatus: 'verified',
	verifiedBy: human,
	verifiedAt: '2026-07-16T12:01:00.000Z',
};

const claim: ClaimEntity = {
	id: claimId,
	type: 'claim',
	anchor: {
		document: {
			resource,
			revisionId: revision,
		},
		primary: {
			kind: 'text',
			textNodeId,
			utf16Offset: offset(2),
			affinity: 'after',
		},
		targetNodeId: textNodeId,
		textQuote: {
			exact: 'Claim',
		},
		pathHint: [textNodeId],
	},
	textSnapshot: 'Claim',
};

const relation: ClaimEvidenceRelation = {
	type: 'claim-evidence-relation',
	claimId,
	evidenceId,
	relation: 'supports',
	assessedBy: human,
	confidence: 0.9,
};

const replaceTextOperation: ReplaceTextOperation = {
	id: operationId(uuid(4)),
	type: 'replace-text',
	textNodeId,
	expectedNodeHash: hashA,
	startUtf16Offset: offset(1),
	endUtf16Offset: offset(3),
	replacement: 'replacement',
};

const splitTextOperation: SplitTextOperation = {
	id: operationId(uuid(5)),
	type: 'split-text',
	textNodeId,
	expectedNodeHash: hashA,
	splitUtf16Offset: offset(2),
	rightTextNodeId,
};

const setTextMarksOperation: SetTextMarksOperation = {
	id: operationId(uuid(8)),
	type: 'set-text-marks',
	textNodeId,
	expectedNodeHash: hashA,
	marks: [
		{ type: 'bold' },
		{
			type: 'link',
			href: richSourceUri,
			title: 'Source',
		},
		{ type: 'subscript' },
	],
};

const replaceAcademicEntityOperation: ReplaceAcademicEntityOperation = {
	id: operationId(uuid(10)),
	type: 'replace-academic-entity',
	entityId: evidenceId,
	expectedEntityHash: hashB,
	replacement: evidence,
};

const setRelationOperation: SetClaimEvidenceRelationOperation = {
	id: operationId(uuid(12)),
	type: 'set-claim-evidence-relation',
	claimId,
	evidenceId,
	expectedRelationHash: null,
	replacement: relation,
};

const operations: readonly Operation[] = Object.freeze([
	{
		id: operationId(uuid(1)),
		type: 'insert-node',
		parentNodeId: nodeId(uuid(210)),
		expectedParentHash: hashA,
		childIndex: 0,
		node: {
			id: nodeId(uuid(211)),
			type: 'figureAsset',
			attrs: {
				uri: richSourceUri,
				contentHash: hashB,
				altText: 'Figure asset',
			},
		},
	},
	{
		id: operationId(uuid(2)),
		type: 'delete-node',
		targetNodeId: nodeId(uuid(212)),
		expectedNodeHash: hashA,
	},
	{
		id: operationId(uuid(3)),
		type: 'move-node',
		targetNodeId: nodeId(uuid(213)),
		expectedNodeHash: hashA,
		newParentNodeId: nodeId(uuid(214)),
		expectedParentHash: hashB,
		childIndex: 1,
	},
	replaceTextOperation,
	splitTextOperation,
	{
		id: operationId(uuid(6)),
		type: 'join-text',
		leftTextNodeId: textNodeId,
		expectedLeftNodeHash: hashA,
		rightTextNodeId,
		expectedRightNodeHash: hashB,
	},
	{
		id: operationId(uuid(7)),
		type: 'set-node-attributes',
		nodeId: nodeId(uuid(215)),
		expectedNodeHash: hashA,
		attributes: {
			alignment: 'center',
		},
	},
	setTextMarksOperation,
	{
		id: operationId(uuid(9)),
		type: 'create-academic-entity',
		entity: claim,
	},
	replaceAcademicEntityOperation,
	{
		id: operationId(uuid(11)),
		type: 'delete-academic-entity',
		entityId: referenceId,
		expectedEntityHash: hashA,
	},
	setRelationOperation,
	{
		id: operationId(uuid(13)),
		type: 'set-metadata',
		expectedMetadataHash: hashA,
		metadata: {
			title: 'Manuscript title',
			authors: [{
				id: entityId(uuid(310)),
				name: 'Ada Lovelace',
				given: 'Ada',
				family: 'Lovelace',
				orcid: '0000-0000-0000-0001',
				affiliations: ['Analytical Society', 'Royal Society'],
			}],
			abstract: 'Abstract',
			keywords: ['analysis', 'computation'],
		},
	},
	{
		id: operationId(uuid(14)),
		type: 'set-settings',
		expectedSettingsHash: hashB,
		settings: {
			language: 'en-US',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		},
	},
]);

suite('Operation codec', () => {
	test('round-trips the frozen fourteen-kind union through the versioned closed DTO', () => {
		assert.deepStrictEqual(
			operations.map(operation => operation.type),
			operationKinds,
		);
		for (const operation of operations) {
			const encoded = encode(operation);
			assert.equal(encoded.format, persistedOperationFormat);
			assert.equal(encoded.formatVersion, persistedOperationFormatVersion);
			assertNoRuntimeUri(encoded);

			const decoded = decodePersistedOperationV1(encoded, resource);
			if (decoded.type === 'invalid') {
				assert.fail(`Failed to decode ${operation.type}: ${decoded.reason}.`);
			}
			assert.equal(decoded.value.type, operation.type);
			assert.deepStrictEqual(encode(decoded.value), encoded);
		}
	});

	test('uses encoded URI externalization for generic URIs and manuscript-owned Anchor serialization', () => {
		const marks = encode(setTextMarksOperation).operation['marks'];
		assert.ok(Array.isArray(marks));
		const link = marks[1];
		assert.equal(
			typeof link === 'object' && link !== null && !Array.isArray(link)
				? link['href']
				: undefined,
			'https://example.test/r%C3%A9sum%C3%A9%20notes/%CE%B1?q%3D%E9%9B%AA',
		);

		const claimEnvelope = encode(operations[8]!);
		const entity = canonicalRecord(claimEnvelope.operation['entity']);
		const anchor = canonicalRecord(entity['anchor']);
		const document = canonicalRecord(anchor['document']);
		assert.equal(document['resource'], resource.toString(true));

		const decoded = decodePersistedOperationV1(claimEnvelope, resource);
		assert.equal(decoded.type, 'valid');
		if (decoded.type === 'valid' && decoded.value.type === 'create-academic-entity') {
			assert.equal(decoded.value.entity.type, 'claim');
			if (decoded.value.entity.type === 'claim') {
				assert.equal(
					decoded.value.entity.anchor.document.resource.toString(true),
					resource.toString(true),
				);
			}
		}
	});

	test('requires the owning manuscript resource for every codec call and Claim Anchor', () => {
		assert.equal(
			decodePersistedOperationV1(encode(operations[8]!), otherResource).type,
			'invalid',
		);
		assert.equal(encodePersistedOperationV1({
			...operations[8],
			entity: {
				...claim,
				anchor: {
					...claim.anchor,
					document: {
						...claim.anchor.document,
						resource: otherResource,
					},
				},
			},
		}, resource).type, 'invalid');
		assert.deepStrictEqual(
			encodePersistedOperationV1(operations[0], richSourceUri),
			{
				type: 'invalid',
				reason: 'invalid-context',
				path: '$context.resource',
			},
		);
	});

	test('round-trips every exact academic entity discriminator', () => {
		for (const [index, entity] of [reference, evidence, claim].entries()) {
			const operation: Operation = {
				id: operationId(uuid(100 + index)),
				type: 'create-academic-entity',
				entity,
			};
			const decoded = decodePersistedOperationV1(encode(operation), resource);
			assert.equal(decoded.type, 'valid');
			if (decoded.type === 'valid' && decoded.value.type === 'create-academic-entity') {
				assert.equal(decoded.value.entity.type, entity.type);
			}
		}
	});

	test('preserves an own __proto__ CSL key through Operation decode and replay', () => {
		const operation: Operation = {
			id: operationId(uuid(110)),
			type: 'create-academic-entity',
			entity: {
				...reference,
				cslJson: createPrototypeKeyCslJson(),
			},
		};
		const persisted = encode(operation);
		const persistedEntity = canonicalRecord(persisted.operation['entity']);
		assertSafePrototypeKeyRecord(canonicalRecord(persistedEntity['cslJson']));

		const decoded = decodePersistedOperationV1(persisted, resource);
		if (
			decoded.type === 'invalid'
			|| decoded.value.type !== 'create-academic-entity'
			|| decoded.value.entity.type !== 'reference-snapshot'
		) {
			assert.fail('Expected a decoded create Reference Snapshot Operation.');
		}
		assertSafePrototypeKeyRecord(decoded.value.entity.cslJson);
		const replay = encodePersistedOperationV1(decoded.value, resource);
		assert.equal(replay.type, 'valid');
		if (replay.type === 'valid') {
			assert.deepStrictEqual(replay.value, persisted);
		}
	});

	test('does not let an own __proto__ key bypass closed node attributes', () => {
		const attributes = Object.create(null) as Record<string, unknown>;
		attributes['alignment'] = 'start';
		Object.defineProperty(attributes, '__proto__', {
			value: { bypass: true },
			enumerable: true,
			configurable: true,
			writable: true,
		});
		const result = encodePersistedOperationV1({
			id: operationId(uuid(111)),
			type: 'set-node-attributes',
			nodeId: textNodeId,
			expectedNodeHash: hashA,
			attributes,
		}, resource);
		assert.equal(result.type, 'invalid');
		assert.equal(({} as { readonly bypass?: unknown }).bypass, undefined);
	});

	test('round-trips representative nested members of the full InsertableNode union', () => {
		const nodes: readonly InsertableNode[] = [
			{
				id: nodeId(uuid(401)),
				type: 'section',
				attrs: { level: 2 },
				children: [{
					id: nodeId(uuid(402)),
					type: 'heading',
					attrs: { level: 2 },
					children: [{
						id: nodeId(uuid(403)),
						type: 'text',
						value: 'Section',
						marks: [{ type: 'bold' }],
					}],
				}],
			},
			{
				id: nodeId(uuid(410)),
				type: 'figure',
				attrs: { label: 'Figure 1' },
				children: [
					{
						id: nodeId(uuid(411)),
						type: 'figureAsset',
						attrs: {
							uri: richSourceUri,
							contentHash: hashA,
							altText: 'Figure',
						},
					},
					{
						id: nodeId(uuid(412)),
						type: 'figureCaption',
						attrs: {},
						children: [],
					},
				],
			},
			{
				id: nodeId(uuid(420)),
				type: 'table',
				attrs: {
					entityId: entityId(uuid(421)),
					label: 'Table 1',
				},
				children: [{
					id: nodeId(uuid(422)),
					type: 'tableRow',
					attrs: {},
					children: [{
						id: nodeId(uuid(423)),
						type: 'tableCell',
						attrs: {},
						children: [{
							id: nodeId(uuid(424)),
							type: 'paragraph',
							attrs: { alignment: 'center' },
							children: [],
						}],
					}],
				}],
			},
			{
				id: nodeId(uuid(430)),
				type: 'list',
				attrs: { ordered: false },
				children: [{
					id: nodeId(uuid(431)),
					type: 'listItem',
					attrs: {},
					children: [{
						id: nodeId(uuid(432)),
						type: 'paragraph',
						attrs: { alignment: 'start' },
						children: [],
					}],
				}],
			},
			{
				id: nodeId(uuid(440)),
				type: 'footnote',
				attrs: { label: '1' },
				children: [{
					id: nodeId(uuid(441)),
					type: 'paragraph',
					attrs: { alignment: 'start' },
					children: [],
				}],
			},
			{
				id: nodeId(uuid(450)),
				type: 'citation',
				attrs: {
					citationId: entityId(uuid(451)),
					referenceId,
					locator: {
						label: 'page',
						value: '7',
					},
					prefix: 'see ',
				},
			},
		];
		for (let index = 0; index < nodes.length; index += 1) {
			const operation: Operation = {
				id: operationId(uuid(200 + index)),
				type: 'insert-node',
				parentNodeId: nodeId(uuid(460 + index)),
				expectedParentHash: hashA,
				childIndex: index,
				node: nodes[index]!,
			};
			const encoded = encode(operation);
			const decoded = decodePersistedOperationV1(encoded, resource);
			assert.equal(decoded.type, 'valid');
			if (decoded.type === 'valid') {
				assert.equal(decoded.value.type, 'insert-node');
				assert.deepStrictEqual(encode(decoded.value), encoded);
			}
		}
	});

	test('rejects extra properties and non-UUIDv7 Operation IDs for every kind', () => {
		for (const operation of operations) {
			const envelope = encode(operation);
			assertInvalid(withOperationField(envelope, 'extra', true));
			assertInvalid(withOperationField(envelope, 'id', 'not-an-operation-id'));
		}
	});

	test('rejects invalid step-local hashes, offsets, and preallocated IDs', () => {
		const hashFields: readonly [number, string][] = [
			[0, 'expectedParentHash'],
			[1, 'expectedNodeHash'],
			[2, 'expectedNodeHash'],
			[2, 'expectedParentHash'],
			[3, 'expectedNodeHash'],
			[4, 'expectedNodeHash'],
			[5, 'expectedLeftNodeHash'],
			[5, 'expectedRightNodeHash'],
			[6, 'expectedNodeHash'],
			[7, 'expectedNodeHash'],
			[9, 'expectedEntityHash'],
			[10, 'expectedEntityHash'],
			[12, 'expectedMetadataHash'],
			[13, 'expectedSettingsHash'],
		];
		for (const [index, field] of hashFields) {
			assertInvalid(withOperationField(encode(operations[index]!), field, 'sha256:nope'));
		}
		assertInvalid(withOperationField(
			encode(replaceTextOperation),
			'startUtf16Offset',
			4,
		));
		assertInvalid(withOperationField(
			encode(replaceTextOperation),
			'endUtf16Offset',
			Number.MAX_SAFE_INTEGER + 1,
		));
		assertInvalid(withOperationField(
			encode(splitTextOperation),
			'rightTextNodeId',
			textNodeId,
		));
		assertInvalid(withOperationField(
			encode(operations[5]!),
			'rightTextNodeId',
			textNodeId,
		));
		assertInvalid(withOperationField(
			encode(replaceAcademicEntityOperation),
			'entityId',
			referenceId,
		));
		assertInvalid(withOperationField(
			encode(setRelationOperation),
			'expectedRelationHash',
			'sha256:nope',
		));
	});

	test('rejects flat Anchors and relations without the exact discriminator', () => {
		const claimEnvelope = encode(operations[8]!);
		const entity = canonicalRecord(claimEnvelope.operation['entity']);
		const anchor = canonicalRecord(entity['anchor']);
		const document = canonicalRecord(anchor['document']);
		assertInvalid(withOperationField(claimEnvelope, 'entity', {
			...entity,
			anchor: {
				resource: document['resource']!,
				revisionId: document['revisionId']!,
				primary: anchor['primary']!,
			},
		}));

		const relationEnvelope = encode(setRelationOperation);
		assertInvalid(withOperationField(relationEnvelope, 'replacement', {
			claimId,
			evidenceId,
			relation: 'supports',
			assessedBy: {
				type: 'human',
				id: 'reviewer-1',
			},
		}));
		assert.equal(encodePersistedOperationV1({
			...setRelationOperation,
			replacement: {
				claimId,
				evidenceId,
				relation: 'supports',
				assessedBy: human,
			},
		}, resource).type, 'invalid');
	});

	test('rejects non-canonical timestamps, metadata sets, marks, and URI strings', () => {
		const referenceEnvelope = encode({
			id: operationId(uuid(120)),
			type: 'create-academic-entity',
			entity: reference,
		});
		const referenceDto = canonicalRecord(referenceEnvelope.operation['entity']);
		assertInvalid(withOperationField(referenceEnvelope, 'entity', {
			...referenceDto,
			capturedAt: '2026-02-30T12:00:00.000Z',
		}));

		const metadataEnvelope = encode(operations[12]!);
		const metadata = canonicalRecord(metadataEnvelope.operation['metadata']);
		assertInvalid(withOperationField(metadataEnvelope, 'metadata', {
			...metadata,
			keywords: ['duplicate', 'duplicate'],
		}));
		assertInvalid(withOperationField(metadataEnvelope, 'metadata', {
			...metadata,
			keywords: ['zeta', 'alpha'],
		}));

		assert.equal(encodePersistedOperationV1({
			...setTextMarksOperation,
			marks: [
				{ type: 'superscript' },
				{ type: 'subscript' },
			],
		}, resource).type, 'invalid');
		const marksEnvelope = encode(setTextMarksOperation);
		const marks = marksEnvelope.operation['marks'];
		assert.ok(Array.isArray(marks));
		const link = canonicalRecord(marks[1]);
		const changedMarks = [...marks];
		changedMarks[1] = {
			...link,
			href: 'https://example.test/résumé notes/α?q=雪',
		};
		assertInvalid(withOperationField(marksEnvelope, 'marks', changedMarks));
	});

	test('rejects structurally invalid inserted subtrees', () => {
		assert.equal(encodePersistedOperationV1({
			id: operationId(uuid(130)),
			type: 'insert-node',
			parentNodeId: nodeId(uuid(230)),
			expectedParentHash: hashA,
			childIndex: 0,
			node: {
				id: nodeId(uuid(231)),
				type: 'body',
				attrs: {},
				children: [],
			},
		}, resource).type, 'invalid');
		assert.equal(encodePersistedOperationV1({
			id: operationId(uuid(131)),
			type: 'insert-node',
			parentNodeId: nodeId(uuid(232)),
			expectedParentHash: hashA,
			childIndex: 0,
			node: {
				id: nodeId(uuid(233)),
				type: 'figure',
				attrs: {},
				children: [{
					id: nodeId(uuid(234)),
					type: 'paragraph',
					attrs: {
						alignment: 'start',
					},
					children: [],
				}],
			},
		}, resource).type, 'invalid');
	});

	test('rejects getters, inspection-failing Proxies, and sparse arrays', () => {
		const getterOperation: Record<string, unknown> = {
			...operations[1],
		};
		Object.defineProperty(getterOperation, 'targetNodeId', {
			enumerable: true,
			get() {
				throw new Error('must not run');
			},
		});
		assert.equal(encodePersistedOperationV1(getterOperation, resource).type, 'invalid');

		const proxy = new Proxy(operations[1] as object, {
			getOwnPropertyDescriptor() {
				throw new Error('descriptor failure');
			},
		});
		const proxyResult = encodePersistedOperationV1(proxy, resource);
		assert.deepStrictEqual(proxyResult, {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});

		const sparseMarks = new Array<Mark>(1);
		assert.equal(encodePersistedOperationV1({
			...setTextMarksOperation,
			marks: sparseMarks,
		}, resource).type, 'invalid');

		const marksEnvelope = encode(setTextMarksOperation);
		const sparsePersistedMarks = new Array<CanonicalJsonValue>(2);
		sparsePersistedMarks[1] = { type: 'bold' };
		const sparseResult = decodePersistedOperationV1(
			withOperationField(marksEnvelope, 'marks', sparsePersistedMarks),
			resource,
		);
		assert.equal(sparseResult.type, 'invalid');
	});

	test('rejects persisted operation resource excess before schema traversal', () => {
		const marksEnvelope = encode(setTextMarksOperation);
		const oversizedMarks = new Array<CanonicalJsonValue>(
			persistedOperationJsonLimits.maximumArrayLength + 1,
		).fill(null);
		assert.deepStrictEqual(
			decodePersistedOperationV1(
				withOperationField(marksEnvelope, 'marks', oversizedMarks),
				resource,
			),
			{
				type: 'invalid',
				reason: 'resource-limit-exceeded',
				path: '$.operation.marks',
				limit: 'array-length',
			},
		);
		assert.deepStrictEqual(
			decodePersistedOperationV1(withOperationField(
				encode(replaceTextOperation),
				'replacement',
				'x'.repeat(persistedOperationJsonLimits.maximumCanonicalUtf8Bytes + 1),
			), resource),
			{
				type: 'invalid',
				reason: 'resource-limit-exceeded',
				path: '$.operation.replacement',
				limit: 'canonical-utf8-bytes',
			},
		);
	});

	test('returns deeply frozen owned DTOs and runtime operations without freezing URI values', () => {
		const encoded = encode(setTextMarksOperation);
		assertDeeplyFrozen(encoded, false);
		assert.throws(() => {
			(encoded.operation as Record<string, CanonicalJsonValue>)['type'] = 'changed';
		}, TypeError);

		const decoded = decodePersistedOperationV1(encoded, resource);
		assert.equal(decoded.type, 'valid');
		if (decoded.type === 'valid') {
			assertDeeplyFrozen(decoded.value, true);
		}
	});

	test('rejects unknown envelopes, versions, and operation kinds', () => {
		const envelope = encode(operations[0]!);
		assertInvalid({
			...envelope,
			format: 'other-format',
		});
		assert.deepStrictEqual(decodePersistedOperationV1({
			...envelope,
			formatVersion: 2,
		}, resource), {
			type: 'invalid',
			reason: 'unsupported-version',
			path: '$.formatVersion',
		});
		assertInvalid(withOperationField(envelope, 'type', 'future-operation'));
	});
});

function encode(operation: unknown): IPersistedOperationV1 {
	const result = encodePersistedOperationV1(operation, resource);
	if (result.type === 'invalid') {
		assert.fail(`Expected valid operation: ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function assertInvalid(value: unknown): void {
	const result = decodePersistedOperationV1(value, resource);
	assert.equal(result.type, 'invalid');
}

function withOperationField(
	envelope: IPersistedOperationV1,
	key: string,
	value: CanonicalJsonValue,
): IPersistedOperationV1 {
	return {
		...envelope,
		operation: {
			...envelope.operation,
			[key]: value,
		},
	};
}

function canonicalRecord(value: unknown): Readonly<Record<string, CanonicalJsonValue>> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, CanonicalJsonValue>>;
}

function createPrototypeKeyCslJson(): Readonly<Record<string, CanonicalJsonValue>> {
	const nested = Object.create(null) as Record<string, CanonicalJsonValue>;
	nested['polluted'] = 'contained';
	const cslJson = Object.create(null) as Record<string, CanonicalJsonValue>;
	Object.defineProperty(cslJson, '__proto__', {
		value: nested,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	cslJson['title'] = 'Prototype-safe reference';
	return cslJson;
}

function assertSafePrototypeKeyRecord(
	value: Readonly<Record<string, CanonicalJsonValue>>,
): void {
	assert.equal(Object.getPrototypeOf(value), Object.prototype);
	assert.equal(Object.hasOwn(value, '__proto__'), true);
	const nested = canonicalRecord(value['__proto__']);
	assert.equal(Object.getPrototypeOf(nested), Object.prototype);
	assert.equal(nested['polluted'], 'contained');
	assert.equal(({} as { readonly polluted?: unknown }).polluted, undefined);
}

function assertNoRuntimeUri(value: unknown): void {
	assert.equal(value instanceof URI, false);
	if (Array.isArray(value)) {
		for (const item of value) {
			assertNoRuntimeUri(item);
		}
		return;
	}
	if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) {
			assertNoRuntimeUri(item);
		}
	}
}

function assertDeeplyFrozen(value: unknown, allowRuntimeUri: boolean): void {
	if (value === null || typeof value !== 'object') {
		return;
	}
	if (value instanceof URI) {
		assert.equal(allowRuntimeUri, true);
		assert.equal(Object.isFrozen(value), false);
		return;
	}
	assert.equal(Object.isFrozen(value), true);
	for (const item of Object.values(value)) {
		assertDeeplyFrozen(item, allowRuntimeUri);
	}
}

function uuid(suffix: number): string {
	return `018f0000-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function operationId(value: string): OperationId {
	const parsed = parseOperationId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Operation ID.');
	}
	return parsed.value;
}

function nodeId(value: string): NodeId {
	const parsed = parseNodeId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Node ID.');
	}
	return parsed.value;
}

function entityId(value: string): EntityId {
	const parsed = parseEntityId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Entity ID.');
	}
	return parsed.value;
}

function revisionId(value: string): RevisionId {
	const parsed = parseRevisionId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Revision ID.');
	}
	return parsed.value;
}

function contentHash(value: string): ContentHash {
	const parsed = parseContentHash(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid content hash.');
	}
	return parsed.value;
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid UTF-16 offset.');
	}
	return parsed.value;
}
