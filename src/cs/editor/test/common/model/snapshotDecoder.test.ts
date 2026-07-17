/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseRevisionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import type { AcademicGraphSnapshot } from 'cs/editor/common/model/academicGraph';
import type {
	BodyNode,
	CitationNode,
	FootnoteNode,
	FootnoteReferenceNode,
	ManuscriptNode,
	ParagraphNode,
	TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	rebuildRevisionMerkleState,
	type DocumentContent,
	type DocumentSnapshot,
} from 'cs/editor/common/model/snapshot';
import {
	decodeDocumentSnapshot,
	encodeDocumentSnapshotV1,
	type DocumentSnapshotCodecError,
	type IDocumentSnapshotCodecLimits,
	type PersistedDocumentSnapshotV1,
} from 'cs/editor/common/model/snapshotDecoder';

interface IFixture {
	readonly snapshot: DocumentSnapshot;
	readonly resource: URI;
	readonly otherResource: URI;
	readonly referenceId: EntityId;
	readonly evidenceId: EntityId;
	readonly claimId: EntityId;
	readonly authorId: EntityId;
	readonly citationId: EntityId;
	readonly paragraphId: NodeId;
	readonly footnoteId: NodeId;
	readonly missingHistoricalNodeId: NodeId;
}

const generousLimits: IDocumentSnapshotCodecLimits = Object.freeze({
	maximumDepth: 256,
	maximumValues: 100_000,
	maximumArrayLength: 10_000,
	maximumObjectProperties: 128,
	maximumCanonicalUtf8Bytes: 16 * 1024 * 1024,
	maximumNodes: 10_000,
	maximumNodeDepth: 256,
	maximumEntities: 10_000,
	maximumRelations: 10_000,
	maximumCollectionItems: 10_000,
});

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function entityId(sequence: number): EntityId {
	const parsed = parseEntityId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Entity ID.');
	}
	return parsed.value;
}

function revisionId(sequence: number): RevisionId {
	const parsed = parseRevisionId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Revision ID.');
	}
	return parsed.value;
}

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Content Hash.');
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

function createFixture(): IFixture {
	const rootId = nodeId(1);
	const bodyId = nodeId(2);
	const paragraphId = nodeId(3);
	const textId = nodeId(4);
	const citationNodeId = nodeId(5);
	const footnoteReferenceId = nodeId(6);
	const footnoteId = nodeId(7);
	const footnoteParagraphId = nodeId(8);
	const missingHistoricalNodeId = nodeId(999);
	const authorId = entityId(101);
	const citationId = entityId(102);
	const referenceId = entityId(103);
	const evidenceId = entityId(104);
	const claimId = entityId(105);
	const resource = createManuscriptDraftResource(uuid(301));
	const otherResource = createManuscriptDraftResource(uuid(302));
	const historicalRevision = revisionId(200);
	const currentRevision = revisionId(201);

	const text: TextNode = {
		id: textId,
		type: 'text',
		value: 'Evidence-backed text.',
		marks: [{
			type: 'link',
			href: URI.from({
				scheme: 'https',
				authority: 'example.test',
				path: '/linked source',
				query: 'q=雪',
			}),
			title: 'Source',
		}],
	};
	const citation: CitationNode = {
		id: citationNodeId,
		type: 'citation',
		attrs: {
			citationId,
			referenceId,
			locator: {
				label: 'page',
				value: '7',
			},
		},
	};
	const footnoteReference: FootnoteReferenceNode = {
		id: footnoteReferenceId,
		type: 'footnoteReference',
		attrs: {
			footnoteNodeId: footnoteId,
		},
	};
	const paragraph: ParagraphNode = {
		id: paragraphId,
		type: 'paragraph',
		attrs: {
			alignment: 'start',
		},
		children: [text, citation, {
			id: nodeId(9),
			type: 'crossReference',
			attrs: {
				targetEntityId: evidenceId,
			},
		}, footnoteReference],
	};
	const footnote: FootnoteNode = {
		id: footnoteId,
		type: 'footnote',
		attrs: {},
		children: [{
			id: footnoteParagraphId,
			type: 'paragraph',
			attrs: {
				alignment: 'start',
			},
			children: [],
		}],
	};
	const body: BodyNode = {
		id: bodyId,
		type: 'body',
		attrs: {},
		children: [paragraph, footnote],
	};
	const root: ManuscriptNode = {
		id: rootId,
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
	const academicGraph: AcademicGraphSnapshot = {
		referenceSnapshots: [{
			id: referenceId,
			type: 'reference-snapshot',
			externalUri: URI.from({
				scheme: 'https',
				authority: 'example.test',
				path: '/reference one',
			}),
			cslJson: {
				title: 'Reference title',
				issued: {
					'date-parts': [[2026]],
				},
			},
			capturedAt: '2026-07-16T00:00:00.000Z',
			sourceProvider: 'fixture',
		}],
		evidenceLinks: [{
			id: evidenceId,
			type: 'evidence-link',
			sourceUri: URI.from({
				scheme: 'https',
				authority: 'example.test',
				path: '/evidence one',
			}),
			sourceContentHash: contentHash(1),
			locator: {
				kind: 'page',
				page: 7,
			},
			excerpt: 'Evidence excerpt.',
			verificationStatus: 'verified',
			verifiedBy: {
				type: 'human',
				id: 'reviewer-1',
			},
			verifiedAt: '2026-07-16T01:00:00.000Z',
		}],
		claims: [{
			id: claimId,
			type: 'claim',
			anchor: {
				document: {
					resource,
					revisionId: historicalRevision,
				},
				primary: {
					kind: 'text',
					textNodeId: missingHistoricalNodeId,
					utf16Offset: offset(123),
					affinity: 'after',
				},
				targetNodeId: missingHistoricalNodeId,
				pathHint: [missingHistoricalNodeId],
				textQuote: {
					exact: 'Historical text',
				},
			},
			textSnapshot: 'Historical text',
		}],
		claimEvidenceRelations: [{
			type: 'claim-evidence-relation',
			claimId,
			evidenceId,
			relation: 'supports',
			assessedBy: {
				type: 'system',
				id: 'validator-1',
				role: 'validator',
			},
			confidence: 0.9,
		}],
	};
	const content: DocumentContent = {
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: {
			title: 'Strict Snapshot fixture',
			authors: [{
				id: authorId,
				name: 'Ada Lovelace',
				affiliations: ['Analytical Society', 'Royal Society'],
			}],
			abstract: 'A strict codec fixture.',
			keywords: ['codec', 'snapshot'],
		},
		root,
		academicGraph,
		settings: {
			language: 'en',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		},
	};
	const documentHash = rebuildRevisionMerkleState(content).documentHash;
	return {
		snapshot: {
			...content,
			revisionId: currentRevision,
			documentHash,
		},
		resource,
		otherResource,
		referenceId,
		evidenceId,
		claimId,
		authorId,
		citationId,
		paragraphId,
		footnoteId,
		missingHistoricalNodeId,
	};
}

function requireEncoded(fixture: IFixture): PersistedDocumentSnapshotV1 {
	const result = encodeDocumentSnapshotV1(
		fixture.snapshot,
		fixture.resource,
		generousLimits,
	);
	if (result.type === 'invalid') {
		throw new Error(`Expected encode success, received ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function assertInvalid(
	result:
		| ReturnType<typeof decodeDocumentSnapshot>
		| ReturnType<typeof encodeDocumentSnapshotV1>,
	reason: DocumentSnapshotCodecError['reason'],
	path?: string,
): void {
	assert.equal(result.type, 'invalid');
	if (result.type === 'invalid') {
		assert.equal(result.reason, reason);
		if (path !== undefined) {
			assert.equal(result.path, path);
		}
	}
}

function assertResourceLimit(
	result: ReturnType<typeof decodeDocumentSnapshot>,
	limit:
		| 'depth'
		| 'values'
		| 'array-length'
		| 'object-properties'
		| 'canonical-utf8-bytes',
): void {
	assertInvalid(result, 'resource-limit-exceeded');
	if (result.type === 'invalid' && result.reason === 'resource-limit-exceeded') {
		assert.equal(result.limit, limit);
	}
}

function mutableDto(value: PersistedDocumentSnapshotV1): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
	assert.ok(Array.isArray(value));
	return value;
}

function paragraphDto(document: Record<string, unknown>): Record<string, unknown> {
	const root = record(document['root']);
	const body = record(array(root['children'])[0]);
	return record(array(body['children'])[0]);
}

suite('Document Snapshot strict codec', () => {
	test('round trips exact persisted DTOs and independently installs index and Merkle state', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		assert.equal(JSON.stringify(encoded).includes('"_formatted"'), false);
		const paragraph = paragraphDto(encoded as unknown as Record<string, unknown>);
		const text = record(array(paragraph['children'])[0]);
		const link = record(array(text['marks'])[0]);
		assert.equal(
			link['href'],
			'https://example.test/linked%20source?q%3D%E9%9B%AA',
		);

		const mutableInput = mutableDto(encoded);
		const decoded = decodeDocumentSnapshot(
			mutableInput,
			fixture.resource,
			generousLimits,
		);
		assert.equal(decoded.type, 'valid');
		assert.equal(
			decoded.value.snapshot.documentHash,
			fixture.snapshot.documentHash,
		);
		assert.equal(
			decoded.value.merkleState.documentHash,
			fixture.snapshot.documentHash,
		);
		assert.equal(decoded.value.index.nodeCount, 9);
		assert.equal(
			decoded.value.index.getNode(fixture.paragraphId)?.type,
			'paragraph',
		);
		const claim = decoded.value.snapshot.academicGraph.claims[0];
		assert.equal(
			claim?.anchor.primary.kind === 'text'
				? claim.anchor.primary.textNodeId
				: undefined,
			fixture.missingHistoricalNodeId,
		);
		assert.equal(
			decoded.value.index.hasNode(fixture.missingHistoricalNodeId),
			false,
		);
		assert.equal(Object.isFrozen(decoded.value.snapshot), true);
		assert.equal(Object.isFrozen(decoded.value.snapshot.root), true);
		assert.equal(Object.isFrozen(decoded.value.snapshot.academicGraph), true);
		assert.equal(
			Object.isFrozen(claim?.anchor.document.resource),
			false,
		);
		record(mutableInput['metadata'])['title'] = 'Mutated after decode';
		assert.equal(
			decoded.value.snapshot.metadata.title,
			'Strict Snapshot fixture',
		);
		assert.deepStrictEqual(
			requireEncoded({
				...fixture,
				snapshot: decoded.value.snapshot,
			}),
			encoded,
		);
	});

	test('rejects open envelopes, unsupported versions, invalid IDs, and hash mismatch', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);

		assertInvalid(decodeDocumentSnapshot({
			...encoded,
			cache: {},
		}, fixture.resource, generousLimits), 'invalid-envelope', '$');
		assertInvalid(decodeDocumentSnapshot({
			...encoded,
			formatVersion: '2',
		}, fixture.resource, generousLimits), 'unsupported-format-version', '$.formatVersion');
		assertInvalid(decodeDocumentSnapshot({
			...encoded,
			schemaVersion: '2',
		}, fixture.resource, generousLimits), 'unsupported-schema-version', '$.schemaVersion');
		assertInvalid(decodeDocumentSnapshot({
			...encoded,
			revisionId: uuid(201).toUpperCase(),
		}, fixture.resource, generousLimits), 'invalid-revision-id', '$.revisionId');
		assertInvalid(decodeDocumentSnapshot({
			...encoded,
			documentHash: contentHash(999),
		}, fixture.resource, generousLimits), 'document-hash-mismatch', '$.documentHash');
	});

	test('rejects non-canonical and cross-resource URI values', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		const noncanonical = mutableDto(encoded);
		const paragraph = paragraphDto(noncanonical);
		const text = record(array(paragraph['children'])[0]);
		const link = record(array(text['marks'])[0]);
		link['href'] = 'https://example.test/linked source?q=雪';
		assertInvalid(
			decodeDocumentSnapshot(noncanonical, fixture.resource, generousLimits),
			'invalid-uri',
			'$.root.children[0].children[0].children[0].marks[0].href',
		);

		const crossResource = mutableDto(encoded);
		const graph = record(crossResource['academicGraph']);
		const claim = record(array(graph['claims'])[0]);
		const anchor = record(claim['anchor']);
		const document = record(anchor['document']);
		document['resource'] = fixture.otherResource.toString(true);
		assertInvalid(
			decodeDocumentSnapshot(crossResource, fixture.resource, generousLimits),
			'invalid-academic-graph',
			'$.academicGraph.claims[0]',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, URI.parse('file:///tmp/not-a-draft'), generousLimits),
			'invalid-context',
			'$context.resource',
		);
	});

	test('enforces global IDs and current-tree citation, cross-reference, and footnote targets', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);

		const duplicate = mutableDto(encoded);
		const metadata = record(duplicate['metadata']);
		const author = record(array(metadata['authors'])[0]);
		author['id'] = fixture.referenceId;
		assertInvalid(
			decodeDocumentSnapshot(duplicate, fixture.resource, generousLimits),
			'duplicate-entity-id',
			'$.academicGraph.referenceSnapshots[0].id',
		);

		const danglingCitation = mutableDto(encoded);
		const citation = record(array(paragraphDto(danglingCitation)['children'])[1]);
		record(citation['attrs'])['referenceId'] = fixture.evidenceId;
		assertInvalid(
			decodeDocumentSnapshot(danglingCitation, fixture.resource, generousLimits),
			'dangling-citation-reference',
		);

		const danglingCrossReference = mutableDto(encoded);
		const crossReference = record(
			array(paragraphDto(danglingCrossReference)['children'])[2],
		);
		record(crossReference['attrs'])['targetEntityId'] = entityId(900);
		assertInvalid(
			decodeDocumentSnapshot(
				danglingCrossReference,
				fixture.resource,
				generousLimits,
			),
			'dangling-cross-reference',
		);

		const wrongFootnoteTarget = mutableDto(encoded);
		const footnoteReference = record(
			array(paragraphDto(wrongFootnoteTarget)['children'])[3],
		);
		record(footnoteReference['attrs'])['footnoteNodeId'] = fixture.paragraphId;
		assertInvalid(
			decodeDocumentSnapshot(
				wrongFootnoteTarget,
				fixture.resource,
				generousLimits,
			),
			'dangling-footnote-reference',
		);
	});

	test('enforces absolute and domain node, entity, relation, and collection budgets', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		assertResourceLimit(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumCanonicalUtf8Bytes: 32,
			}),
			'canonical-utf8-bytes',
		);
		assertResourceLimit(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumDepth: 4,
			}),
			'depth',
		);
		assertResourceLimit(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumValues: 10,
			}),
			'values',
		);
		assertResourceLimit(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumArrayLength: 1,
			}),
			'array-length',
		);
		assertResourceLimit(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumObjectProperties: 4,
			}),
			'object-properties',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumNodes: 8,
			}),
			'node-budget-exceeded',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumNodeDepth: 2,
			}),
			'node-depth-exceeded',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumEntities: 4,
			}),
			'entity-budget-exceeded',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumRelations: 0,
			}),
			'relation-budget-exceeded',
			'$.academicGraph.claimEvidenceRelations',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				maximumCollectionItems: 1,
			}),
			'collection-budget-exceeded',
		);
	});

	test('first-pass capture rejects accessors, Proxy failure, cycles, sparse arrays, and invalid scalars', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		let getterCalls = 0;
		const accessor = {
			...encoded,
			get root() {
				getterCalls += 1;
				return encoded.root;
			},
		};
		assertInvalid(
			decodeDocumentSnapshot(accessor, fixture.resource, generousLimits),
			'inspection-failed',
			'$.root',
		);
		assert.equal(getterCalls, 0);

		assertInvalid(
			decodeDocumentSnapshot(new Proxy({}, {
				ownKeys() {
					throw new Error('hostile proxy');
				},
			}), fixture.resource, generousLimits),
			'inspection-failed',
		);

		const cyclic = mutableDto(encoded);
		cyclic['cycle'] = cyclic;
		assertInvalid(
			decodeDocumentSnapshot(cyclic, fixture.resource, generousLimits),
			'inspection-failed',
		);

		const sparse = mutableDto(encoded);
		record(sparse['metadata'])['keywords'] = new Array(2);
		assertInvalid(
			decodeDocumentSnapshot(sparse, fixture.resource, generousLimits),
			'inspection-failed',
			'$.metadata.keywords',
		);

		const nonfinite = mutableDto(encoded);
		record(nonfinite['settings'])['headingNumbering'] = Number.NaN;
		assertInvalid(
			decodeDocumentSnapshot(nonfinite, fixture.resource, generousLimits),
			'inspection-failed',
			'$.settings.headingNumbering',
		);

		const invalidUnicode = mutableDto(encoded);
		record(invalidUnicode['metadata'])['title'] = '\ud800';
		assertInvalid(
			decodeDocumentSnapshot(invalidUnicode, fixture.resource, generousLimits),
			'inspection-failed',
			'$.metadata.title',
		);
	});

	test('encoder is descriptor-safe and validates its own persisted result', () => {
		const fixture = createFixture();
		let getterCalls = 0;
		const hostile = {
			...fixture.snapshot,
			get root() {
				getterCalls += 1;
				return fixture.snapshot.root;
			},
		};
		assertInvalid(
			encodeDocumentSnapshotV1(hostile, fixture.resource, generousLimits),
			'inspection-failed',
		);
		assert.equal(getterCalls, 0);
		assertInvalid(
			encodeDocumentSnapshotV1(
				fixture.snapshot,
				fixture.otherResource,
				generousLimits,
			),
			'invalid-academic-graph',
		);
		assertInvalid(
			encodeDocumentSnapshotV1({
				...fixture.snapshot,
				documentHash: contentHash(999),
			}, fixture.resource, generousLimits),
			'document-hash-mismatch',
			'$.documentHash',
		);
	});

	test('treats codec limits as an exact descriptor-safe public boundary', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		let getterCalls = 0;
		const accessorLimits = {
			...generousLimits,
			get maximumValues() {
				getterCalls += 1;
				return generousLimits.maximumValues;
			},
		} as IDocumentSnapshotCodecLimits;
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, accessorLimits),
			'invalid-limits',
			'$limits',
		);
		assert.equal(getterCalls, 0);

		const proxyLimits = new Proxy(generousLimits, {
			ownKeys() {
				throw new Error('hostile limits');
			},
		});
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, proxyLimits),
			'invalid-limits',
			'$limits',
		);
		assertInvalid(
			decodeDocumentSnapshot(encoded, fixture.resource, {
				...generousLimits,
				unexpected: 1,
			} as IDocumentSnapshotCodecLimits),
			'invalid-limits',
			'$limits',
		);
	});

	test('rejects unsorted Academic Graph collections and dangling relations', () => {
		const fixture = createFixture();
		const encoded = requireEncoded(fixture);
		const unsorted = mutableDto(encoded);
		const graph = record(unsorted['academicGraph']);
		const references = array(graph['referenceSnapshots']);
		const first = record(references[0]);
		references.push({
			...first,
			id: entityId(104),
		});
		references.reverse();
		assertInvalid(
			decodeDocumentSnapshot(unsorted, fixture.resource, generousLimits),
			'invalid-academic-graph',
		);

		const dangling = mutableDto(encoded);
		const danglingGraph = record(dangling['academicGraph']);
		const relation = record(array(danglingGraph['claimEvidenceRelations'])[0]);
		relation['evidenceId'] = entityId(999);
		assertInvalid(
			decodeDocumentSnapshot(dangling, fixture.resource, generousLimits),
			'invalid-academic-graph',
		);

		const duplicate = mutableDto(encoded);
		const duplicateGraph = record(duplicate['academicGraph']);
		const duplicateEvidence = record(array(duplicateGraph['evidenceLinks'])[0]);
		duplicateEvidence['id'] = fixture.referenceId;
		assertInvalid(
			decodeDocumentSnapshot(duplicate, fixture.resource, generousLimits),
			'invalid-academic-graph',
		);
	});
});
