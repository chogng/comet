/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';
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
import {
	manuscriptHashDomains,
	manuscriptHashPreimagePrefix,
} from 'cs/editor/common/core/hashPreimage';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import { parseUtf16Offset } from 'cs/editor/common/core/semanticPosition';
import type {
	AcademicGraphSnapshot,
	ClaimEntity,
	ClaimEvidenceRelation,
	EvidenceLink,
	EvidenceLocator,
	ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';
import type { ActorRef } from 'cs/editor/common/model/actor';
import {
	manuscriptStructuralMerkleSequenceAlgorithm,
} from 'cs/editor/common/model/merkleVector';
import type {
	BodyNode,
	DocumentNode,
	ManuscriptNode,
	ManuscriptAuthor,
	Mark,
	ParagraphNode,
	TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	academicEntityHashAlgorithm,
	academicGraphHashAlgorithm,
	createAcademicClaimHashPayload,
	createAcademicEvidenceHashPayload,
	createAcademicGraphHashPayload,
	createAcademicReferenceHashPayload,
	createAcademicRelationHashPayload,
	createCanonicalManuscriptMark,
	createDocumentMerkleHashPayload,
	createDocumentNodeHashPayload,
	createDocumentNodeLocalComparisonPayload,
	createMerkleVectorDescriptor,
	createMetadataAuthorHashPayload,
	createMetadataKeywordHashPayload,
	createMetadataRootHashPayload,
	createMetadataTextHashPayload,
	createSettingsHashPayload,
	documentMerkleHashAlgorithm,
	manuscriptMetadataHashAlgorithm,
	manuscriptNodeHashAlgorithm,
	manuscriptSettingsHashAlgorithm,
	type IRevisionMerkleHashCall,
	type RevisionMerkleHashCallObserver,
} from 'cs/editor/common/model/revisionHashPayload';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	rebuildRevisionMerkleState,
	type DocumentContent,
	type DocumentSnapshot,
	type RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

interface ITestFixture {
	readonly content: DocumentContent;
	readonly root: ManuscriptNode;
	readonly body: BodyNode;
	readonly paragraph: ParagraphNode;
	readonly text: TextNode;
	readonly authorId: EntityId;
	readonly referenceId: EntityId;
	readonly evidenceId: EntityId;
	readonly claimId: EntityId;
	readonly revisionId: RevisionId;
	readonly anchorRevisionId: RevisionId;
	readonly nextRevisionId: RevisionId;
	readonly resource: URI;
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

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test content hash.');
	}
	return parsed.value;
}

function utf16Offset(value: number) {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test UTF-16 offset.');
	}
	return parsed.value;
}

function createFixture(): ITestFixture {
	const rootId = nodeId(1);
	const bodyId = nodeId(2);
	const paragraphId = nodeId(3);
	const textId = nodeId(4);
	const authorId = entityId(101);
	const referenceId = entityId(102);
	const evidenceId = entityId(103);
	const claimId = entityId(104);
	const revision = revisionId(201);
	const anchorRevision = revisionId(200);
	const nextRevision = revisionId(202);
	const resource = createManuscriptDraftResource(uuid(301));

	const text: TextNode = {
		id: textId,
		type: 'text',
		value: 'Evidence-backed text.',
		marks: [
			{
				type: 'bold',
			},
			{
				type: 'link',
				href: URI.from({
					scheme: 'https',
					authority: 'example.test',
					path: '/linked path',
				}),
				title: 'Source',
			},
		],
	};
	const paragraph: ParagraphNode = {
		id: paragraphId,
		type: 'paragraph',
		attrs: {
			alignment: 'start',
		},
		children: [text],
	};
	const body: BodyNode = {
		id: bodyId,
		type: 'body',
		attrs: {},
		children: [paragraph],
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
				path: '/paper one',
			}),
			cslJson: {
				title: 'Reference title',
				author: ['Ada'],
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
			sourceContentHash: contentHash(9),
			locator: {
				kind: 'page',
				page: 7,
				pageLabel: 'vii',
			},
			excerpt: 'Evidence excerpt.',
			verificationStatus: 'verified',
			verifiedBy: {
				type: 'human',
				id: 'user-1',
			},
			verifiedAt: '2026-07-16T01:00:00.000Z',
		}],
		claims: [{
			id: claimId,
			type: 'claim',
			anchor: {
				document: {
					resource,
					revisionId: anchorRevision,
				},
				primary: {
					kind: 'text',
					textNodeId: textId,
					utf16Offset: utf16Offset(8),
					affinity: 'after',
				},
				targetNodeId: paragraphId,
				textQuote: {
					exact: 'backed',
					prefix: 'Evidence-',
					suffix: ' text.',
				},
				pathHint: [rootId, bodyId, paragraphId, textId],
			},
			textSnapshot: 'Evidence-backed text.',
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
			confidence: 0.875,
		}],
	};
	return {
		content: {
			format: documentFormat,
			formatVersion: documentFormatVersion,
			schemaId: manuscriptSchemaId,
			schemaVersion: manuscriptSchemaVersion,
			metadata: {
				title: 'Merkle fixture',
				authors: [{
					id: authorId,
					name: 'Ada Lovelace',
					given: 'Ada',
					family: 'Lovelace',
					orcid: '0000-0000-0000-0001',
					affiliations: ['Analytical Society', 'Royal Society'],
				}],
				abstract: 'A deterministic Snapshot fixture.',
				keywords: ['merkle'],
			},
			root,
			academicGraph,
			settings: {
				language: 'en-US',
				citationStyle: 'apa',
				headingNumbering: true,
				bibliographyEnabled: true,
			},
		},
		root,
		body,
		paragraph,
		text,
		authorId,
		referenceId,
		evidenceId,
		claimId,
		revisionId: revision,
		anchorRevisionId: anchorRevision,
		nextRevisionId: nextRevision,
		resource,
	};
}

function recordHashCalls(
	calls: IRevisionMerkleHashCall[],
): RevisionMerkleHashCallObserver {
	return call => calls.push(call);
}

function payloadRecord(
	call: IRevisionMerkleHashCall,
): Readonly<Record<string, unknown>> {
	return call.payload as unknown as Readonly<Record<string, unknown>>;
}

function findCall(
	calls: readonly IRevisionMerkleHashCall[],
	predicate: (payload: Readonly<Record<string, unknown>>) => boolean,
): IRevisionMerkleHashCall {
	const matches = calls.filter(call => predicate(payloadRecord(call)));
	assert.equal(matches.length, 1);
	const match = matches[0];
	if (match === undefined) {
		throw new Error('Expected one matching hash call.');
	}
	return match;
}

function oracleHash(call: IRevisionMerkleHashCall): string {
	const preimage =
		`${manuscriptHashPreimagePrefix}${call.domain}\0${call.canonicalJson}`;
	return `sha256:${createHash('sha256').update(preimage).digest('hex')}`;
}

function assertDeepFrozen(value: unknown): void {
	if (value === null || typeof value !== 'object') {
		return;
	}
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) {
		assertDeepFrozen(child);
	}
}

function stateSummary(
	state: RevisionMerkleState,
	fixture: ITestFixture,
): Readonly<Record<string, unknown>> {
	return {
		documentHash: state.documentHash,
		metadataHash: state.metadataHash,
		rootNodeHash: state.rootNodeHash,
		academicGraphHash: state.academicGraphHash,
		settingsHash: state.settingsHash,
		titleHash: state.titleHash,
		abstractHash: state.abstractHash,
		textHash: state.getNodeHash(fixture.text.id),
		referenceHash: state.getEntityHash(fixture.referenceId),
		evidenceHash: state.getEntityHash(fixture.evidenceId),
		claimHash: state.getEntityHash(fixture.claimId),
		relationHash: state.getRelationHash(fixture.claimId, fixture.evidenceId),
	};
}

suite('Document Snapshot Merkle state', () => {
	test('freezes final format, schema, and hash algorithms', () => {
		assert.equal(documentFormat, 'nireco-document');
		assert.equal(documentFormatVersion, '1');
		assert.equal(manuscriptSchemaId, 'nireco.manuscript');
		assert.equal(manuscriptSchemaVersion, '1');
		assert.equal(manuscriptNodeHashAlgorithm, 'nireco-manuscript-node-1');
		assert.equal(academicEntityHashAlgorithm, 'nireco-academic-entity-1');
		assert.equal(academicGraphHashAlgorithm, 'nireco-academic-graph-1');
		assert.equal(
			manuscriptMetadataHashAlgorithm,
			'nireco-manuscript-metadata-1',
		);
		assert.equal(
			manuscriptSettingsHashAlgorithm,
			'nireco-manuscript-settings-1',
		);
		assert.equal(documentMerkleHashAlgorithm, 'nireco-document-merkle-1');
	});

	test('owns every node, Mark, metadata, and settings payload shape', () => {
		const fixture = createFixture();
		const linkWithoutTitle: Mark = {
			type: 'link',
			href: URI.from({
				scheme: 'https',
				authority: 'example.test',
				path: '/without title',
			}),
		};
		const linkWithTitle: Mark = {
			type: 'link',
			href: URI.from({
				scheme: 'https',
				authority: 'example.test',
				path: '/with title',
			}),
			title: 'Named source',
		};
		const plainMarks: readonly Mark[] = [
			{ type: 'bold' },
			{ type: 'italic' },
			{ type: 'underline' },
			{ type: 'strike' },
			{ type: 'code' },
			{ type: 'subscript' },
			{ type: 'superscript' },
		];
		assert.deepStrictEqual(
			[
				...plainMarks.map(createCanonicalManuscriptMark),
				createCanonicalManuscriptMark(linkWithoutTitle),
				createCanonicalManuscriptMark(linkWithTitle),
			],
			[
				{ type: 'bold' },
				{ type: 'italic' },
				{ type: 'underline' },
				{ type: 'strike' },
				{ type: 'code' },
				{ type: 'subscript' },
				{ type: 'superscript' },
				{
					type: 'link',
					href: 'https://example.test/without%20title',
				},
				{
					type: 'link',
					href: 'https://example.test/with%20title',
					title: 'Named source',
				},
			],
		);

		const text: TextNode = {
			...fixture.text,
			marks: [...plainMarks, linkWithoutTitle, linkWithTitle],
		};
		const textLocalPayload = createDocumentNodeLocalComparisonPayload(text);
		assert.deepStrictEqual(textLocalPayload, {
			id: text.id,
			type: 'text',
			value: text.value,
			marks: [
				{ type: 'bold' },
				{ type: 'italic' },
				{ type: 'underline' },
				{ type: 'strike' },
				{ type: 'code' },
				{ type: 'subscript' },
				{ type: 'superscript' },
				{
					type: 'link',
					href: 'https://example.test/without%20title',
				},
				{
					type: 'link',
					href: 'https://example.test/with%20title',
					title: 'Named source',
				},
			],
		});

		const paragraphLocalPayload =
			createDocumentNodeLocalComparisonPayload(fixture.paragraph);
		assert.equal(Object.hasOwn(paragraphLocalPayload, 'children'), false);
		const children = createMerkleVectorDescriptor({
			count: 1,
			rootHash: contentHash(401),
		});
		const paragraphPayload = createDocumentNodeHashPayload(
			fixture.paragraph,
			children,
		);
		assert.deepStrictEqual(paragraphPayload, {
			algorithm: manuscriptNodeHashAlgorithm,
			id: fixture.paragraph.id,
			type: 'paragraph',
			attrs: {
				alignment: 'start',
			},
			children: {
				count: 1,
				hash: contentHash(401),
			},
		});

		const hardBreak = {
			id: nodeId(406),
			type: 'hardBreak',
			attrs: {},
		} as const;
		assert.throws(
			() => (createDocumentNodeHashPayload as (
				node: DocumentNode,
				children?: ReturnType<typeof createMerkleVectorDescriptor>,
			) => unknown)(fixture.paragraph),
			/require a child descriptor/u,
		);
		assert.throws(
			() => (createDocumentNodeHashPayload as (
				node: DocumentNode,
				children?: ReturnType<typeof createMerkleVectorDescriptor>,
			) => unknown)(hardBreak, children),
			/cannot contain a child descriptor/u,
		);
		assert.throws(
			() => (createDocumentNodeHashPayload as (
				node: DocumentNode,
				children?: ReturnType<typeof createMerkleVectorDescriptor>,
			) => unknown)(text, children),
			/cannot contain a child descriptor/u,
		);
		if (false) {
			// @ts-expect-error Container nodes require an exact child descriptor.
			createDocumentNodeHashPayload(fixture.paragraph);
			// @ts-expect-error Leaf nodes reject child descriptors.
			createDocumentNodeHashPayload(hardBreak, children);
			// @ts-expect-error Text nodes reject child descriptors.
			createDocumentNodeHashPayload(text, children);
		}

		const minimalAuthor: ManuscriptAuthor = {
			name: 'Minimal Author',
		};
		const completeAuthor = fixture.content.metadata.authors[0];
		assert.ok(completeAuthor !== undefined);
		assert.deepStrictEqual(
			createMetadataAuthorHashPayload(minimalAuthor),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				kind: 'author',
				name: 'Minimal Author',
			},
		);
		assert.deepStrictEqual(
			createMetadataAuthorHashPayload(completeAuthor),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				kind: 'author',
				id: fixture.authorId,
				name: 'Ada Lovelace',
				given: 'Ada',
				family: 'Lovelace',
				orcid: '0000-0000-0000-0001',
				affiliations: ['Analytical Society', 'Royal Society'],
			},
		);
		assert.deepStrictEqual(
			createMetadataTextHashPayload('title', 'Title'),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				kind: 'text-field',
				field: 'title',
				value: 'Title',
			},
		);
		assert.deepStrictEqual(
			createMetadataTextHashPayload('abstract', 'Abstract'),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				kind: 'text-field',
				field: 'abstract',
				value: 'Abstract',
			},
		);
		assert.deepStrictEqual(
			createMetadataKeywordHashPayload('determinism'),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				kind: 'keyword',
				value: 'determinism',
			},
		);
		assert.deepStrictEqual(
			createMetadataRootHashPayload(
				contentHash(402),
				createMerkleVectorDescriptor({
					count: 2,
					rootHash: contentHash(403),
				}),
				contentHash(404),
				createMerkleVectorDescriptor({
					count: 3,
					rootHash: contentHash(405),
				}),
			),
			{
				algorithm: manuscriptMetadataHashAlgorithm,
				titleHash: contentHash(402),
				authors: {
					count: 2,
					hash: contentHash(403),
				},
				abstractHash: contentHash(404),
				keywords: {
					count: 3,
					hash: contentHash(405),
				},
			},
		);
		assert.deepStrictEqual(
			createSettingsHashPayload(fixture.content.settings),
			{
				algorithm: manuscriptSettingsHashAlgorithm,
				language: 'en-US',
				citationStyle: 'apa',
				headingNumbering: true,
				bibliographyEnabled: true,
			},
		);
		assertDeepFrozen(textLocalPayload);
		assertDeepFrozen(paragraphPayload);
	});

	test('owns every Academic URI, Actor, anchor, locator, and optional payload shape', () => {
		const fixture = createFixture();
		const reference = fixture.content.academicGraph.referenceSnapshots[0];
		const evidence = fixture.content.academicGraph.evidenceLinks[0];
		const claim = fixture.content.academicGraph.claims[0];
		const relation =
			fixture.content.academicGraph.claimEvidenceRelations[0];
		assert.ok(reference !== undefined);
		assert.ok(evidence !== undefined);
		assert.ok(claim !== undefined);
		assert.ok(relation !== undefined);

		const minimalReference: ReferenceSnapshot = {
			id: reference.id,
			type: 'reference-snapshot',
			cslJson: {},
			capturedAt: reference.capturedAt,
		};
		assert.deepStrictEqual(
			createAcademicReferenceHashPayload(minimalReference),
			{
				algorithm: academicEntityHashAlgorithm,
				id: reference.id,
				type: 'reference-snapshot',
				cslJson: {},
				capturedAt: reference.capturedAt,
			},
		);
		assert.deepStrictEqual(
			createAcademicReferenceHashPayload(reference),
			{
				algorithm: academicEntityHashAlgorithm,
				id: reference.id,
				type: 'reference-snapshot',
				externalUri: 'https://example.test/paper%20one',
				cslJson: {
					title: 'Reference title',
					author: ['Ada'],
				},
				capturedAt: reference.capturedAt,
				sourceProvider: 'fixture',
			},
		);

		const locatorVectors: readonly EvidenceLocator[] = [
			{ kind: 'page', page: 7 },
			{ kind: 'page', page: 7, pageLabel: 'vii' },
			{ kind: 'section', section: 'Methods' },
			{ kind: 'text-quote', exact: 'minimal quote' },
			{
				kind: 'text-quote',
				exact: 'bounded quote',
				prefix: 'before',
				suffix: 'after',
			},
			{ kind: 'time', startSeconds: 1.5 },
			{ kind: 'time', startSeconds: 1.5, endSeconds: 4.5 },
			{ kind: 'record', recordKey: 'row-42' },
		];
		for (const locator of locatorVectors) {
			const vectorEvidence: EvidenceLink = {
				id: evidence.id,
				type: 'evidence-link',
				sourceUri: evidence.sourceUri,
				sourceContentHash: evidence.sourceContentHash,
				locator,
				verificationStatus: evidence.verificationStatus,
			};
			const payload = createAcademicEvidenceHashPayload(vectorEvidence);
			assert.deepStrictEqual(payload.locator, locator);
			assert.equal(Object.hasOwn(payload, 'excerpt'), false);
			assert.equal(Object.hasOwn(payload, 'verifiedBy'), false);
			assert.equal(Object.hasOwn(payload, 'verifiedAt'), false);
			assertDeepFrozen(payload);
		}

		const actorVectors: readonly ActorRef[] = [
			{ type: 'human', id: 'human-1' },
			{ type: 'agent', id: 'agent-1' },
			{
				type: 'system',
				id: 'system-1',
				role: 'recovery',
			},
		];
		for (const actor of actorVectors) {
			const completeEvidence: EvidenceLink = {
				...evidence,
				locator: {
					kind: 'text-quote',
					exact: 'bounded quote',
					prefix: 'before',
					suffix: 'after',
				},
				verifiedBy: actor,
			};
			const payload = createAcademicEvidenceHashPayload(completeEvidence);
			assert.equal(
				payload.sourceUri,
				'https://example.test/evidence%20one',
			);
			assert.deepStrictEqual(payload.verifiedBy, actor);
			assert.equal(payload.excerpt, 'Evidence excerpt.');
			assert.equal(payload.verifiedAt, '2026-07-16T01:00:00.000Z');
			assertDeepFrozen(payload);
		}

		const fullClaimPayload = createAcademicClaimHashPayload(claim);
		assert.deepStrictEqual(fullClaimPayload.anchor, {
			document: {
				resource: fixture.resource.toString(),
				revisionId: fixture.anchorRevisionId,
			},
			primary: {
				kind: 'text',
				textNodeId: fixture.text.id,
				utf16Offset: 8,
				affinity: 'after',
			},
			targetNodeId: fixture.paragraph.id,
			textQuote: {
				exact: 'backed',
				prefix: 'Evidence-',
				suffix: ' text.',
			},
			pathHint: [
				fixture.root.id,
				fixture.body.id,
				fixture.paragraph.id,
				fixture.text.id,
			],
		});
		const minimalClaim: ClaimEntity = {
			id: claim.id,
			type: 'claim',
			anchor: {
				document: {
					resource: fixture.resource,
					revisionId: fixture.anchorRevisionId,
				},
				primary: {
					kind: 'node-boundary',
					parentNodeId: fixture.body.id,
					childIndex: 0,
					affinity: 'before',
				},
			},
			textSnapshot: '',
		};
		const minimalClaimPayload =
			createAcademicClaimHashPayload(minimalClaim);
		assert.deepStrictEqual(minimalClaimPayload.anchor.primary, {
			kind: 'node-boundary',
			parentNodeId: fixture.body.id,
			childIndex: 0,
			affinity: 'before',
		});
		assert.equal(
			Object.hasOwn(minimalClaimPayload.anchor, 'targetNodeId'),
			false,
		);
		assert.equal(
			Object.hasOwn(minimalClaimPayload.anchor, 'textQuote'),
			false,
		);
		assert.equal(
			Object.hasOwn(minimalClaimPayload.anchor, 'pathHint'),
			false,
		);

		for (const [index, actor] of actorVectors.entries()) {
			const actorRelation: ClaimEvidenceRelation = {
				...relation,
				assessedBy: actor,
				...(index === 0 ? { confidence: 0.5 } : { confidence: undefined }),
			};
			const payload = createAcademicRelationHashPayload(actorRelation);
			assert.deepStrictEqual(payload.assessedBy, actor);
			assert.equal(
				Object.hasOwn(payload, 'confidence'),
				index === 0,
			);
			assertDeepFrozen(payload);
		}

		const descriptors = [
			createMerkleVectorDescriptor({
				count: 1,
				rootHash: contentHash(406),
			}),
			createMerkleVectorDescriptor({
				count: 2,
				rootHash: contentHash(407),
			}),
			createMerkleVectorDescriptor({
				count: 3,
				rootHash: contentHash(408),
			}),
			createMerkleVectorDescriptor({
				count: 4,
				rootHash: contentHash(409),
			}),
		] as const;
		assert.deepStrictEqual(
			createAcademicGraphHashPayload(...descriptors),
			{
				algorithm: academicGraphHashAlgorithm,
				referenceSnapshots: descriptors[0],
				evidenceLinks: descriptors[1],
				claims: descriptors[2],
				claimEvidenceRelations: descriptors[3],
			},
		);
		assert.deepStrictEqual(
			createDocumentMerkleHashPayload({
				schemaId: manuscriptSchemaId,
				schemaVersion: manuscriptSchemaVersion,
				metadataHash: contentHash(410),
				rootNodeHash: contentHash(411),
				academicGraphHash: contentHash(412),
				settingsHash: contentHash(413),
			}),
			{
				algorithm: documentMerkleHashAlgorithm,
				schemaId: manuscriptSchemaId,
				schemaVersion: manuscriptSchemaVersion,
				metadataHash: contentHash(410),
				rootNodeHash: contentHash(411),
				academicGraphHash: contentHash(412),
				settingsHash: contentHash(413),
			},
		);
		assertDeepFrozen(fullClaimPayload);
		assertDeepFrozen(minimalClaimPayload);
	});

	test('hashes every exact payload and runtime URI canonically', () => {
		const fixture = createFixture();
		const calls: IRevisionMerkleHashCall[] = [];
		const state = rebuildRevisionMerkleState(
			fixture.content,
			recordHashCalls(calls),
		);

		assert.equal(calls.length, 39);
		assert.equal(
			calls.filter(call =>
				canonicalRecord(call.payload)['algorithm']
				=== manuscriptStructuralMerkleSequenceAlgorithm,
			).length,
			21,
		);
		assert.equal(state.nodeCount, 4);
		assert.equal(state.entityCount, 3);
		assert.equal(state.relationCount, 1);
		assert.equal(state.getEntityHash(fixture.authorId), undefined);
		assert.equal(Object.isFrozen(state), true);
		for (const call of calls) {
			assert.equal(call.hash, oracleHash(call));
			assertDeepFrozen(call);
		}

		const textCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === manuscriptNodeHashAlgorithm
				&& payload['type'] === 'text',
		);
		assert.deepStrictEqual(textCall.payload, {
			algorithm: manuscriptNodeHashAlgorithm,
			id: fixture.text.id,
			type: 'text',
			value: 'Evidence-backed text.',
			marks: [
				{
					type: 'bold',
				},
				{
					type: 'link',
					href: 'https://example.test/linked%20path',
					title: 'Source',
				},
			],
		});

		const paragraphCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === manuscriptNodeHashAlgorithm
				&& payload['type'] === 'paragraph',
		);
		assert.deepStrictEqual(paragraphCall.payload, {
			algorithm: manuscriptNodeHashAlgorithm,
			id: fixture.paragraph.id,
			type: 'paragraph',
			attrs: {
				alignment: 'start',
			},
			children: {
				count: 1,
				hash: state.getNodeChildrenVector(fixture.paragraph.id)?.rootHash,
			},
		});

		const titleCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === manuscriptMetadataHashAlgorithm
				&& payload['field'] === 'title',
		);
		assert.deepStrictEqual(titleCall.payload, {
			algorithm: manuscriptMetadataHashAlgorithm,
			kind: 'text-field',
			field: 'title',
			value: 'Merkle fixture',
		});

		const abstractCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === manuscriptMetadataHashAlgorithm
				&& payload['field'] === 'abstract',
		);
		assert.deepStrictEqual(abstractCall.payload, {
			algorithm: manuscriptMetadataHashAlgorithm,
			kind: 'text-field',
			field: 'abstract',
			value: 'A deterministic Snapshot fixture.',
		});

		const authorCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === manuscriptMetadataHashAlgorithm
				&& payload['kind'] === 'author',
		);
		assert.deepStrictEqual(authorCall.payload, {
			algorithm: manuscriptMetadataHashAlgorithm,
			kind: 'author',
			id: fixture.authorId,
			name: 'Ada Lovelace',
			given: 'Ada',
			family: 'Lovelace',
			orcid: '0000-0000-0000-0001',
			affiliations: ['Analytical Society', 'Royal Society'],
		});

		const referenceCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'reference-snapshot',
		);
		assert.deepStrictEqual(referenceCall.payload, {
			id: fixture.referenceId,
			type: 'reference-snapshot',
			externalUri: 'https://example.test/paper%20one',
			cslJson: {
				title: 'Reference title',
				author: ['Ada'],
			},
			capturedAt: '2026-07-16T00:00:00.000Z',
			sourceProvider: 'fixture',
			algorithm: academicEntityHashAlgorithm,
		});

		const evidenceCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'evidence-link',
		);
		assert.deepStrictEqual(evidenceCall.payload, {
			algorithm: academicEntityHashAlgorithm,
			id: fixture.evidenceId,
			type: 'evidence-link',
			sourceUri: 'https://example.test/evidence%20one',
			sourceContentHash: contentHash(9),
			locator: {
				kind: 'page',
				page: 7,
				pageLabel: 'vii',
			},
			excerpt: 'Evidence excerpt.',
			verificationStatus: 'verified',
			verifiedBy: {
				type: 'human',
				id: 'user-1',
			},
			verifiedAt: '2026-07-16T01:00:00.000Z',
		});

		const claimCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'claim',
		);
		assert.deepStrictEqual(claimCall.payload, {
			id: fixture.claimId,
			type: 'claim',
			anchor: {
				document: {
					resource: fixture.resource.toString(),
					revisionId: fixture.anchorRevisionId,
				},
				primary: {
					kind: 'text',
					textNodeId: fixture.text.id,
					utf16Offset: 8,
					affinity: 'after',
				},
				targetNodeId: fixture.paragraph.id,
				textQuote: {
					exact: 'backed',
					prefix: 'Evidence-',
					suffix: ' text.',
				},
				pathHint: [
					fixture.root.id,
					fixture.body.id,
					fixture.paragraph.id,
					fixture.text.id,
				],
			},
			textSnapshot: 'Evidence-backed text.',
			algorithm: academicEntityHashAlgorithm,
		});

		const relationCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'claim-evidence-relation',
		);
		assert.deepStrictEqual(relationCall.payload, {
			algorithm: academicEntityHashAlgorithm,
			type: 'claim-evidence-relation',
			claimId: fixture.claimId,
			evidenceId: fixture.evidenceId,
			relation: 'supports',
			assessedBy: {
				type: 'system',
				id: 'validator-1',
				role: 'validator',
			},
			confidence: 0.875,
		});
		assert.equal(
			state.getRelationHash(fixture.claimId, fixture.evidenceId),
			relationCall.hash,
		);

		const settingsCall = findCall(
			calls,
			payload => payload['algorithm'] === manuscriptSettingsHashAlgorithm,
		);
		assert.deepStrictEqual(settingsCall.payload, {
			algorithm: manuscriptSettingsHashAlgorithm,
			language: 'en-US',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		});

		const academicRootCall = findCall(
			calls,
			payload => payload['algorithm'] === academicGraphHashAlgorithm,
		);
		assert.deepStrictEqual(academicRootCall.payload, {
			algorithm: academicGraphHashAlgorithm,
			referenceSnapshots: {
				count: 1,
				hash: state.academicReferenceSnapshotsVector.rootHash,
			},
			evidenceLinks: {
				count: 1,
				hash: state.academicEvidenceLinksVector.rootHash,
			},
			claims: {
				count: 1,
				hash: state.academicClaimsVector.rootHash,
			},
			claimEvidenceRelations: {
				count: 1,
				hash: state.academicClaimEvidenceRelationsVector.rootHash,
			},
		});

		const documentCall = findCall(
			calls,
			payload => payload['algorithm'] === documentMerkleHashAlgorithm,
		);
		assert.deepStrictEqual(documentCall.payload, {
			algorithm: documentMerkleHashAlgorithm,
			schemaId: manuscriptSchemaId,
			schemaVersion: manuscriptSchemaVersion,
			metadataHash: state.metadataHash,
			rootNodeHash: state.rootNodeHash,
			academicGraphHash: state.academicGraphHash,
			settingsHash: state.settingsHash,
		});
		assert.equal(Object.hasOwn(documentCall.payload, 'format'), false);
		assert.equal(Object.hasOwn(documentCall.payload, 'formatVersion'), false);
		assert.equal(Object.hasOwn(documentCall.payload, 'revisionId'), false);
		assert.equal(Object.hasOwn(documentCall.payload, 'documentHash'), false);
		assert.equal(
			documentCall.canonicalJson,
			`{"academicGraphHash":"${state.academicGraphHash}","algorithm":"nireco-document-merkle-1","metadataHash":"${state.metadataHash}","rootNodeHash":"${state.rootNodeHash}","schemaId":"nireco.manuscript","schemaVersion":"1","settingsHash":"${state.settingsHash}"}`,
		);

		assert.deepStrictEqual({
			...stateSummary(state, fixture),
			authorHash: authorCall.hash,
		}, {
			documentHash:
				'sha256:ef893b52f8b75fe8b507444e4af081091ef6a7aadc5a750c6475a02b54c66579',
			metadataHash:
				'sha256:48d0153f2df2bc35fd432613a6564015f849af977abb8bc62dde7cee49cc2d82',
			rootNodeHash:
				'sha256:f2c9366bb437da5bd8fb4db9f32bf6314768120f5a8a562c94d9371bba00331a',
			academicGraphHash:
				'sha256:6140bc1b76f514013d3bc2e3ff34ecec91e62cc612999d80361302461df58bbd',
			settingsHash:
				'sha256:d934763791cd16287524d6b4ef6ffd569217cf618dc95285930ec6b0490981ba',
			titleHash:
				'sha256:ba2377c9978727d143e0b78685ef15772ee816cd110bbbaf291dc8af22888ba8',
			abstractHash:
				'sha256:ea3c0eee7d458d3796258ad0d106bee5dfb4781e39327e77468ae9a1533d8fdd',
			textHash:
				'sha256:ba331947ab150397085d51562b542f7dd77441bcbb36cc8f417cbad41d18ba75',
			authorHash:
				'sha256:4ffa1addd2d802d2ce0b5917ebc26624619f7f35651893ea99d1d9d61e2dcb3d',
			referenceHash:
				'sha256:6d20bfd5c33e6c164130f3bbc2e4774d7166a7dbbec7070711bd30e5f3a35aa6',
			evidenceHash:
				'sha256:dafe603e13addd2a3292106151b343c6a7b390e8d30d600d44d4855378110fcc',
			claimHash:
				'sha256:832960b0bd4b6ca85adf9fafa5a58f80cb207d2f46aa656f3be4674465501f3c',
			relationHash:
				'sha256:509562d3312f38b78fb4093cf9ae98ab857e377fa70a81f37295a126ab1927db',
		});
	});

	test('hashes an own __proto__ CSL key as data without mutating prototypes', () => {
		const fixture = createFixture();
		const reference = fixture.content.academicGraph.referenceSnapshots[0];
		if (reference === undefined) {
			throw new Error('Expected a fixture Reference Snapshot.');
		}
		const baseline = rebuildRevisionMerkleState(fixture.content);
		const calls: IRevisionMerkleHashCall[] = [];
		const state = rebuildRevisionMerkleState({
			...fixture.content,
			academicGraph: {
				...fixture.content.academicGraph,
				referenceSnapshots: [{
					...reference,
					cslJson: createPrototypeKeyCslJson(),
				}],
			},
		}, recordHashCalls(calls));
		const referenceCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'reference-snapshot',
		);
		const cslJson = canonicalRecord(payloadRecord(referenceCall)['cslJson']);
		assert.equal(Object.getPrototypeOf(cslJson), Object.prototype);
		assert.equal(Object.hasOwn(cslJson, '__proto__'), true);
		const nested = canonicalRecord(cslJson['__proto__']);
		assert.equal(Object.getPrototypeOf(nested), Object.prototype);
		assert.equal(nested['polluted'], 'contained');
		assert.equal(
			referenceCall.canonicalJson.includes(
				'"__proto__":{"polluted":"contained"}',
			),
			true,
		);
		assert.equal(referenceCall.hash, oracleHash(referenceCall));
		assert.equal(
			state.getEntityHash(fixture.referenceId),
			referenceCall.hash,
		);
		assert.notEqual(
			referenceCall.hash,
			baseline.getEntityHash(fixture.referenceId),
		);
		assert.equal(({} as { readonly polluted?: unknown }).polluted, undefined);
	});

	test('excludes revision, declared hash, format, and format version from document identity', () => {
		const fixture = createFixture();
		const firstCalls: IRevisionMerkleHashCall[] = [];
		const snapshot: DocumentSnapshot = {
			...fixture.content,
			revisionId: fixture.revisionId,
			documentHash: contentHash(501),
		};
		const first = rebuildRevisionMerkleState(
			snapshot,
			recordHashCalls(firstCalls),
		);
		const secondCalls: IRevisionMerkleHashCall[] = [];
		const changedEnvelope = {
			...snapshot,
			format: 'ignored-envelope-format',
			formatVersion: '999',
			revisionId: fixture.nextRevisionId,
			documentHash: contentHash(502),
		} as unknown as DocumentContent;
		const second = rebuildRevisionMerkleState(
			changedEnvelope,
			recordHashCalls(secondCalls),
		);

		assert.equal(second.documentHash, first.documentHash);
		assert.deepStrictEqual(
			secondCalls.map(call => [call.domain, call.canonicalJson, call.hash]),
			firstCalls.map(call => [call.domain, call.canonicalJson, call.hash]),
		);

		const changedSchema = rebuildRevisionMerkleState({
			...fixture.content,
			schemaVersion: '2',
		} as unknown as DocumentContent);
		assert.notEqual(changedSchema.documentHash, first.documentHash);
		assert.equal(changedSchema.rootNodeHash, first.rootNodeHash);
		assert.equal(changedSchema.metadataHash, first.metadataHash);
		assert.equal(changedSchema.academicGraphHash, first.academicGraphHash);
		assert.equal(changedSchema.settingsHash, first.settingsHash);
	});

	test('includes an older Claim anchor revision in Claim and document identity', () => {
		const fixture = createFixture();
		const original = rebuildRevisionMerkleState(fixture.content);
		const originalClaim = fixture.content.academicGraph.claims[0];
		if (originalClaim === undefined) {
			throw new Error('Expected a fixture Claim.');
		}
		const changedClaim: ClaimEntity = {
			...originalClaim,
			anchor: {
				...originalClaim.anchor,
				document: {
					...originalClaim.anchor.document,
					revisionId: fixture.nextRevisionId,
				},
			},
		};
		const changed = rebuildRevisionMerkleState({
			...fixture.content,
			academicGraph: {
				...fixture.content.academicGraph,
				claims: [changedClaim],
			},
		});

		assert.notEqual(
			changed.getEntityHash(fixture.claimId),
			original.getEntityHash(fixture.claimId),
		);
		assert.notEqual(changed.academicGraphHash, original.academicGraphHash);
		assert.notEqual(changed.documentHash, original.documentHash);
		assert.equal(changed.rootNodeHash, original.rootNodeHash);
		assert.equal(changed.metadataHash, original.metadataHash);
		assert.equal(changed.settingsHash, original.settingsHash);
	});

	test('keeps metadata authors outside Academic Entity and relation hash indexes', () => {
		const fixture = createFixture();
		const reference = fixture.content.academicGraph.referenceSnapshots[0];
		if (reference === undefined) {
			throw new Error('Expected a fixture Reference Snapshot.');
		}
		const calls: IRevisionMerkleHashCall[] = [];
		const state = rebuildRevisionMerkleState({
			...fixture.content,
			academicGraph: {
				...fixture.content.academicGraph,
				referenceSnapshots: [{
					...reference,
					id: fixture.authorId,
				}],
			},
		}, recordHashCalls(calls));
		const referenceCall = findCall(
			calls,
			payload =>
				payload['algorithm'] === academicEntityHashAlgorithm
				&& payload['type'] === 'reference-snapshot',
		);

		assert.equal(state.entityCount, 3);
		assert.equal(state.getEntityHash(fixture.authorId), referenceCall.hash);
		assert.equal(state.getEntityHash(fixture.referenceId), undefined);
		assert.equal(state.relationCount, 1);
		assert.equal(
			state.getRelationHash(fixture.claimId, fixture.evidenceId),
			findCall(
				calls,
				payload =>
					payload['algorithm'] === academicEntityHashAlgorithm
						&& payload['type'] === 'claim-evidence-relation',
			).hash,
		);
		assert.equal(
			state.getRelationHash(fixture.claimId, fixture.referenceId),
			undefined,
		);
	});

	test('fully rebuilds deterministic state without external hash authority', () => {
		const firstFixture = createFixture();
		const secondFixture = createFixture();
		const firstCalls: IRevisionMerkleHashCall[] = [];
		const secondCalls: IRevisionMerkleHashCall[] = [];
		const first = rebuildRevisionMerkleState(
			firstFixture.content,
			recordHashCalls(firstCalls),
		);
		const second = rebuildRevisionMerkleState(
			secondFixture.content,
			recordHashCalls(secondCalls),
		);

		assert.deepStrictEqual(
			stateSummary(second, secondFixture),
			stateSummary(first, firstFixture),
		);
		assert.deepStrictEqual(
			secondCalls.map(call => ({
				domain: call.domain,
				canonicalJson: call.canonicalJson,
				hash: call.hash,
			})),
			firstCalls.map(call => ({
				domain: call.domain,
				canonicalJson: call.canonicalJson,
				hash: call.hash,
			})),
		);
		assert.equal(
			first.getNodeHash(firstFixture.root.id),
			first.rootNodeHash,
		);
		assert.equal(
			first.getNodeChildrenVector(firstFixture.text.id),
			undefined,
		);
		assert.equal(
			first.getNodeChildrenVector(firstFixture.paragraph.id)?.count,
			1,
		);
		assert.equal(Object.hasOwn(first, 'canonicalJson'), false);
		assert.equal(Object.hasOwn(first, 'snapshot'), false);
		assert.equal(Object.hasOwn(first, 'cache'), false);
		assert.equal(
			Reflect.ownKeys(first).some(key =>
				typeof key === 'string'
				&& (
					key.includes('Map')
					|| key.includes('HashesById')
					|| key.startsWith('#')
				)),
			false,
		);
		const prototype = Object.getPrototypeOf(first) as object;
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
		assert.throws(
			() => Reflect.construct(
				(prototype as { readonly constructor?: Function })
					.constructor as Function,
				[Object.freeze({})],
			),
			TypeError,
		);
		assert.throws(
			() => new Proxy(first, {}).getNodeHash(firstFixture.root.id),
			TypeError,
		);
		assert.throws(
			() => (
				Object.create(prototype) as RevisionMerkleState
			).getNodeHash(firstFixture.root.id),
			TypeError,
		);
		assert.equal(
			firstCalls.filter(call => call.domain === manuscriptHashDomains.node).length,
			4,
		);
		assert.equal(
			firstCalls.filter(
				call => call.domain === manuscriptHashDomains.academicEntity,
			).length,
			4,
		);
		assert.equal(
			firstCalls.filter(
				call => call.domain === manuscriptHashDomains.documentContent,
			).length,
			31,
		);
	});
});

function canonicalRecord(
	value: unknown,
): Readonly<Record<string, CanonicalJsonValue>> {
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
