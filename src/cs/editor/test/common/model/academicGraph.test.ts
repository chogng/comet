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
import type { ActorRef } from 'cs/editor/common/model/actor';
import {
	createTrustedAcademicGraphSnapshot,
	decodeAcademicEntityV1,
	decodeClaimEvidenceRelationV1,
	encodeAcademicEntityV1,
	encodeClaimEvidenceRelationV1,
	validateAcademicGraphSnapshot,
	type AcademicGraphSnapshot,
	type ClaimEntity,
	type EvidenceLink,
	type IAcademicGraphBinding,
	type ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';

const resource = createManuscriptDraftResource(
	'018f0000-0000-7000-8000-000000000001',
);
const otherResource = createManuscriptDraftResource(
	'018f0000-0000-7000-8000-000000000002',
);
const revision = revisionId('018f0000-0000-7000-8000-000000000101');
const otherRevision = revisionId('018f0000-0000-7000-8000-000000000102');
const referenceId = entityId('018f0000-0000-7000-8000-000000000201');
const otherReferenceId = entityId('018f0000-0000-7000-8000-000000000202');
const evidenceId = entityId('018f0000-0000-7000-8000-000000000301');
const otherEvidenceId = entityId('018f0000-0000-7000-8000-000000000302');
const claimId = entityId('018f0000-0000-7000-8000-000000000401');
const otherClaimId = entityId('018f0000-0000-7000-8000-000000000402');
const textNodeId = nodeId('018f0000-0000-7000-8000-000000000501');
const sourceHash = contentHash(
	'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
const sourceUri = URI.parse('https://example.test/articles/source');
const reviewer: ActorRef = {
	type: 'human',
	id: 'reviewer-1',
};
const binding: IAcademicGraphBinding = {
	resource,
};

function createReference(
	id = referenceId,
	cslJson: Readonly<Record<string, CanonicalJsonValue>> = {
		title: 'Reference title',
	},
): ReferenceSnapshot {
	return {
		id,
		type: 'reference-snapshot',
		externalUri: sourceUri,
		cslJson,
		capturedAt: '2026-07-16T12:00:00.000Z',
		sourceProvider: 'test-provider',
	};
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

function createEvidence(id = evidenceId): EvidenceLink {
	return {
		id,
		type: 'evidence-link',
		sourceUri,
		sourceContentHash: sourceHash,
		locator: {
			kind: 'page',
			page: 7,
			pageLabel: '7',
		},
		excerpt: 'Evidence excerpt',
		verificationStatus: 'verified',
		verifiedBy: reviewer,
		verifiedAt: '2026-07-16T12:01:00.000Z',
	};
}

function createClaim(
	id = claimId,
	options: {
		readonly anchorResource?: URI;
		readonly anchorRevision?: RevisionId;
	} = {},
): ClaimEntity {
	return {
		id,
		type: 'claim',
		anchor: {
			document: {
				resource: options.anchorResource ?? resource,
				revisionId: options.anchorRevision ?? revision,
			},
			primary: {
				kind: 'text',
				textNodeId,
				utf16Offset: offset(3),
				affinity: 'after',
			},
			targetNodeId: textNodeId,
			textQuote: {
				exact: 'Claim text',
				prefix: 'Before ',
				suffix: ' after',
			},
			pathHint: [textNodeId],
		},
		textSnapshot: 'Claim text',
	};
}

function createGraph(): AcademicGraphSnapshot {
	return {
		referenceSnapshots: [createReference()],
		evidenceLinks: [createEvidence()],
		claims: [createClaim()],
		claimEvidenceRelations: [
			{
				type: 'claim-evidence-relation',
				claimId,
				evidenceId,
				relation: 'supports',
				assessedBy: reviewer,
				confidence: 0.9,
			},
		],
	};
}

function assertInvalid(
	value: unknown,
	reason: Exclude<
		ReturnType<typeof validateAcademicGraphSnapshot>,
		{ readonly type: 'valid' }
	>['reason'],
	path?: string,
): void {
	const result = validateAcademicGraphSnapshot(value, binding);
	assert.equal(result.type, 'invalid');
	if (result.type === 'invalid') {
		assert.equal(result.reason, reason);
		if (path !== undefined) {
			assert.equal(result.path, path);
		}
	}
}

function entityId(value: string): EntityId {
	const parsed = parseEntityId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Entity ID.');
	}
	return parsed.value;
}

function nodeId(value: string): NodeId {
	const parsed = parseNodeId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function revisionId(value: string): RevisionId {
	const parsed = parseRevisionId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Revision ID.');
	}
	return parsed.value;
}

function contentHash(value: string): ContentHash {
	const parsed = parseContentHash(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test content hash.');
	}
	return parsed.value;
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test UTF-16 offset.');
	}
	return parsed.value;
}

suite('AcademicGraph', () => {
	test('accepts a closed graph with runtime URIs and bound Claim anchors', () => {
		assert.deepStrictEqual(
			validateAcademicGraphSnapshot(createGraph(), binding),
			{ type: 'valid' },
		);
	});

	test('captures the binding resource without invoking accessors or rereading URI state', () => {
		let getterCalls = 0;
		const accessorBinding = {};
		Object.defineProperty(accessorBinding, 'resource', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return resource;
			},
		});
		assert.deepStrictEqual(validateAcademicGraphSnapshot(
			createGraph(),
			accessorBinding as IAcademicGraphBinding,
		), {
			type: 'invalid',
			reason: 'invalid-binding',
			path: '$binding',
		});
		assert.equal(getterCalls, 0);

		const proxyBinding = new Proxy(binding, {
			getOwnPropertyDescriptor() {
				throw new Error('binding inspection failure');
			},
		});
		assert.deepStrictEqual(validateAcademicGraphSnapshot(
			createGraph(),
			proxyBinding,
		), {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$binding',
		});

		const proxiedResource = new Proxy(resource, {
			getOwnPropertyDescriptor(_target, property) {
				if (property === 'path') {
					throw new Error('resource inspection failure');
				}
				return Reflect.getOwnPropertyDescriptor(resource, property);
			},
		});
		assert.deepStrictEqual(validateAcademicGraphSnapshot(createGraph(), {
			resource: proxiedResource,
		}), {
			type: 'invalid',
			reason: 'invalid-binding',
			path: '$binding',
		});
	});

	test('round-trips the shared persisted academic entity and relation wire codec', () => {
		for (const entity of [createReference(), createEvidence(), createClaim()]) {
			const encoded = encodeAcademicEntityV1(entity, resource);
			assert.notEqual(encoded, undefined);
			assert.equal(Object.isFrozen(encoded), true);
			assert.equal(containsRuntimeUri(encoded), false);
			const decoded = decodeAcademicEntityV1(encoded, resource);
			assert.equal(decoded?.type, entity.type);
		}
		assert.equal(
			encodeAcademicEntityV1(createClaim(), otherResource),
			undefined,
		);
		const encodedClaim = encodeAcademicEntityV1(createClaim(), resource);
		assert.equal(
			decodeAcademicEntityV1(encodedClaim, otherResource),
			undefined,
		);

		const relation = createGraph().claimEvidenceRelations[0]!;
		const encodedRelation = encodeClaimEvidenceRelationV1(relation);
		assert.deepStrictEqual(
			decodeClaimEvidenceRelationV1(encodedRelation),
			relation,
		);
	});

	test('retains an own __proto__ CSL key without prototype mutation across trust and wire replay', () => {
		const cslJson = createPrototypeKeyCslJson();
		assert.equal(Object.getPrototypeOf(cslJson), null);

		const trusted = createTrustedAcademicGraphSnapshot({
			...createGraph(),
			referenceSnapshots: [createReference(referenceId, cslJson)],
		}, binding);
		if (trusted.type === 'invalid') {
			assert.fail(`Expected a trusted graph, received ${trusted.reason} at ${trusted.path}.`);
		}
		assertSafePrototypeKeyRecord(
			trusted.value.referenceSnapshots[0]!.cslJson,
		);

		const encoded = encodeAcademicEntityV1(
			createReference(referenceId, cslJson),
			resource,
		);
		if (encoded === undefined) {
			assert.fail('Expected a persisted Reference Snapshot.');
		}
		assertSafePrototypeKeyRecord(
			encoded['cslJson'] as Readonly<Record<string, CanonicalJsonValue>>,
		);

		const decoded = decodeAcademicEntityV1(encoded, resource);
		if (decoded?.type !== 'reference-snapshot') {
			assert.fail('Expected a decoded Reference Snapshot.');
		}
		assertSafePrototypeKeyRecord(decoded.cslJson);
		assert.deepStrictEqual(
			encodeAcademicEntityV1(decoded, resource),
			encoded,
		);
	});

	test('constructs a detached deeply frozen trusted graph', () => {
		const cslJson = {
			title: 'Original title',
			authors: ['A', 'B'],
		};
		const graph: AcademicGraphSnapshot = {
			...createGraph(),
			referenceSnapshots: [createReference(referenceId, cslJson)],
		};
		const result = createTrustedAcademicGraphSnapshot(graph, binding);
		if (result.type === 'invalid') {
			assert.fail(`Expected a trusted graph, received ${result.reason} at ${result.path}.`);
		}

		cslJson.title = 'Changed after construction';
		assert.equal(result.value.referenceSnapshots[0]?.cslJson['title'], 'Original title');
		assert.equal(Object.isFrozen(result.value), true);
		assert.equal(Object.isFrozen(result.value.referenceSnapshots), true);
		assert.equal(Object.isFrozen(result.value.referenceSnapshots[0]?.cslJson), true);
		assert.equal(Object.isFrozen(result.value.claims[0]?.anchor), true);
		assert.equal(Object.isFrozen(result.value.claims[0]?.anchor.document), true);
		assert.equal(Object.isFrozen(result.value.claimEvidenceRelations[0]?.assessedBy), true);
	});

	test('rejects URI strings instead of retaining serialized URI values', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			referenceSnapshots: [{
				...graph.referenceSnapshots[0],
				externalUri: sourceUri.toString(),
			}],
		}, 'invalid-reference-snapshot');
		assertInvalid({
			...graph,
			evidenceLinks: [{
				...graph.evidenceLinks[0],
				sourceUri: sourceUri.toString(),
			}],
		}, 'invalid-evidence-link');
		assertInvalid({
			...graph,
			claims: [{
				...graph.claims[0],
				anchor: {
					...graph.claims[0]?.anchor,
					document: {
						...graph.claims[0]?.anchor.document,
						resource: resource.toString(),
					},
				},
			}],
		}, 'invalid-claim');
	});

	test('rejects legacy derived hash fields from every academic entity', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			referenceSnapshots: [{
				...graph.referenceSnapshots[0],
				metadataHash: sourceHash,
			}],
		}, 'invalid-reference-snapshot');
		assertInvalid({
			...graph,
			evidenceLinks: [{
				...graph.evidenceLinks[0],
				excerptHash: sourceHash,
			}],
		}, 'invalid-evidence-link');
		assertInvalid({
			...graph,
			claims: [{
				...graph.claims[0],
				textHash: sourceHash,
			}],
		}, 'invalid-claim');
	});

	test('requires every Claim anchor resource to match while retaining a historical Revision', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			claims: [createClaim(claimId, { anchorResource: otherResource })],
		}, 'anchor-resource-mismatch', '$.claims[0].anchor.document.resource');

		assert.deepStrictEqual(validateAcademicGraphSnapshot({
			...graph,
			claims: [createClaim(claimId, { anchorRevision: otherRevision })],
		}, binding), { type: 'valid' });
	});

	test('requires the exact academic entity type discriminator', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			referenceSnapshots: [{
				...graph.referenceSnapshots[0],
				type: 'claim',
			}],
		}, 'invalid-reference-snapshot');
		assertInvalid({
			...graph,
			evidenceLinks: [{
				...graph.evidenceLinks[0],
				type: 'reference-snapshot',
			}],
		}, 'invalid-evidence-link');
		assertInvalid({
			...graph,
			claims: [{
				...graph.claims[0],
				type: 'evidence-link',
			}],
		}, 'invalid-claim');
	});

	test('requires nested Anchor document identity and the exact relation discriminator', () => {
		const graph = createGraph();
		const claim = graph.claims[0]!;
		assertInvalid({
			...graph,
			claims: [{
				...claim,
				anchor: {
					resource: claim.anchor.document.resource,
					revisionId: claim.anchor.document.revisionId,
					primary: claim.anchor.primary,
				},
			}],
		}, 'invalid-claim');
		const { type: _type, ...relationWithoutType } = graph.claimEvidenceRelations[0]!;
		assertInvalid({
			...graph,
			claimEvidenceRelations: [relationWithoutType],
		}, 'invalid-relation');
	});

	test('requires canonical UTC academic timestamps', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			referenceSnapshots: [{
				...graph.referenceSnapshots[0],
				capturedAt: '2026-02-30T12:00:00.000Z',
			}],
		}, 'invalid-reference-snapshot');
		assertInvalid({
			...graph,
			evidenceLinks: [{
				...graph.evidenceLinks[0],
				verifiedAt: '2026-07-16T12:01:00Z',
			}],
		}, 'invalid-evidence-link');
	});

	test('requires entity collections to be strictly sorted by ID', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			referenceSnapshots: [
				createReference(otherReferenceId),
				createReference(referenceId),
			],
		}, 'collection-not-strictly-sorted', '$.referenceSnapshots[1].id');
		assertInvalid({
			...graph,
			evidenceLinks: [
				createEvidence(otherEvidenceId),
				createEvidence(evidenceId),
			],
		}, 'collection-not-strictly-sorted', '$.evidenceLinks[1].id');
		assertInvalid({
			...graph,
			claims: [
				createClaim(otherClaimId),
				createClaim(claimId),
			],
		}, 'collection-not-strictly-sorted', '$.claims[1].id');
	});

	test('rejects Entity IDs shared across academic entity kinds', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			evidenceLinks: [{
				...createEvidence(),
				id: referenceId,
			}],
		}, 'duplicate-entity-id', '$.evidenceLinks[0].id');
	});

	test('requires one sorted relation per Claim and Evidence pair', () => {
		const graph = createGraph();
		const relation = graph.claimEvidenceRelations[0];
		assertInvalid({
			...graph,
			claimEvidenceRelations: [relation, relation],
		}, 'relation-not-strictly-sorted', '$.claimEvidenceRelations[1]');
	});

	test('rejects relations that reference a missing Claim or Evidence Link', () => {
		const graph = createGraph();
		assertInvalid({
			...graph,
			claimEvidenceRelations: [{
				...graph.claimEvidenceRelations[0],
				evidenceId: otherEvidenceId,
			}],
		}, 'dangling-relation', '$.claimEvidenceRelations[0]');
	});

	test('rejects sparse collections and fields outside the closed graph shape', () => {
		const graph = createGraph();
		const sparseReferences = new Array<ReferenceSnapshot>(2);
		sparseReferences[1] = createReference();
		assertInvalid({
			...graph,
			referenceSnapshots: sparseReferences,
		}, 'invalid-graph-shape');
		assertInvalid({
			...graph,
			futureField: true,
		}, 'invalid-graph-shape');
	});

	test('captures mutable input once before validating and freezing it', () => {
		const graph = createGraph();
		const reference = {
			...graph.referenceSnapshots[0],
			cslJson: {
				title: 'Captured title',
			},
		};
		let descriptorReads = 0;
		const proxiedReference = new Proxy(reference, {
			getOwnPropertyDescriptor(target, property) {
				descriptorReads += 1;
				const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
				if (
					descriptorReads > Reflect.ownKeys(target).length
					&& property === 'cslJson'
				) {
					return {
						configurable: true,
						enumerable: true,
						value: {
							title: 'Changed on a second descriptor pass',
						},
						writable: true,
					};
				}
				return descriptor;
			},
		});
		const result = createTrustedAcademicGraphSnapshot({
			...graph,
			referenceSnapshots: [proxiedReference],
		}, binding);
		if (result.type === 'invalid') {
			assert.fail(`Expected a trusted graph, received ${result.reason} at ${result.path}.`);
		}

		reference.cslJson.title = 'Mutated after capture';
		assert.equal(
			result.value.referenceSnapshots[0]?.cslJson['title'],
			'Captured title',
		);
		assert.equal(descriptorReads, Reflect.ownKeys(reference).length);
	});

	test('rejects accessors and Proxy descriptor failures without reading values', () => {
		const graph = createGraph();
		const accessorReference = {
			...graph.referenceSnapshots[0],
		};
		Object.defineProperty(accessorReference, 'cslJson', {
			enumerable: true,
			get() {
				throw new Error('must not run');
			},
		});
		const accessorResult = createTrustedAcademicGraphSnapshot({
			...graph,
			referenceSnapshots: [accessorReference],
		}, binding);
		assert.deepStrictEqual(accessorResult, {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});

		const proxyResult = createTrustedAcademicGraphSnapshot(new Proxy(graph, {
			getOwnPropertyDescriptor() {
				throw new Error('descriptor failure');
			},
		}), binding);
		assert.deepStrictEqual(proxyResult, {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});
	});

	test('rejects collections beyond the absolute capture budget before traversal', () => {
		const oversizedReferences = new Array<ReferenceSnapshot>(100_001);
		const result = createTrustedAcademicGraphSnapshot({
			...createGraph(),
			referenceSnapshots: oversizedReferences,
		}, binding);
		assert.deepStrictEqual(result, {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
		});
	});

	test('rejects oversized aggregate academic text with a typed resource failure', () => {
		const graph = createGraph();
		const result = createTrustedAcademicGraphSnapshot({
			...graph,
			referenceSnapshots: [{
				...graph.referenceSnapshots[0],
				cslJson: {
					title: 'x'.repeat(16 * 1024 * 1024 + 1),
				},
			}],
		}, binding);
		assert.deepStrictEqual(result, {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
		});
	});
});

function containsRuntimeUri(value: unknown): boolean {
	if (value instanceof URI) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some(containsRuntimeUri);
	}
	return value !== null && typeof value === 'object'
		? Object.values(value).some(containsRuntimeUri)
		: false;
}

function assertSafePrototypeKeyRecord(
	value: Readonly<Record<string, CanonicalJsonValue>>,
): void {
	assert.equal(Object.getPrototypeOf(value), Object.prototype);
	assert.equal(Object.hasOwn(value, '__proto__'), true);
	const nested = value['__proto__'];
	assert.ok(nested !== null && typeof nested === 'object' && !Array.isArray(nested));
	assert.equal(Object.getPrototypeOf(nested), Object.prototype);
	assert.equal(
		(nested as Readonly<Record<string, CanonicalJsonValue>>)['polluted'],
		'contained',
	);
	assert.equal(({} as { readonly polluted?: unknown }).polluted, undefined);
}
