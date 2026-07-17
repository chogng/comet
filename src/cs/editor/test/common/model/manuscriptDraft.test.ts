/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	parseNodeId,
	parseRevisionId,
	type NodeId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	decodeManuscriptDraft,
	getManuscriptDraftReadView,
	type ManuscriptDraft,
} from 'cs/editor/common/model/manuscriptDraft';
import type { ManuscriptNode } from 'cs/editor/common/model/manuscript';
import { rebuildRevisionMerkleState } from 'cs/editor/common/model/revisionMerkleState';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	type DocumentContent,
	type DocumentSnapshot,
} from 'cs/editor/common/model/snapshot';
import {
	decodeDocumentSnapshot,
	encodeDocumentSnapshotV1,
	type IDocumentSnapshotCodecLimits,
	type PersistedDocumentSnapshotV1,
} from 'cs/editor/common/model/snapshotDecoder';

interface IFixture {
	readonly resource: URI;
	readonly snapshot: DocumentSnapshot;
	readonly encoded: PersistedDocumentSnapshotV1;
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

function revisionId(sequence: number): RevisionId {
	const parsed = parseRevisionId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Revision ID.');
	}
	return parsed.value;
}

function createFixture(): IFixture {
	const resource = createManuscriptDraftResource(uuid(100));
	const root: ManuscriptNode = {
		id: nodeId(1),
		type: 'manuscript',
		attrs: {},
		children: [{
			id: nodeId(2),
			type: 'body',
			attrs: {},
			children: [{
				id: nodeId(3),
				type: 'paragraph',
				attrs: {
					alignment: 'start',
				},
				children: [],
			}],
		}],
	};
	const content: DocumentContent = {
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: {
			title: 'Base draft',
			authors: [],
			abstract: '',
			keywords: [],
		},
		root,
		academicGraph: {
			referenceSnapshots: [],
			evidenceLinks: [],
			claims: [],
			claimEvidenceRelations: [],
		},
		settings: {
			language: 'en',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		},
	};
	const snapshot: DocumentSnapshot = {
		...content,
		revisionId: revisionId(200),
		documentHash: rebuildRevisionMerkleState(content).documentHash,
	};
	const encoded = encodeDocumentSnapshotV1(
		snapshot,
		resource,
		generousLimits,
	);
	if (encoded.type === 'invalid') {
		throw new Error(
			`Expected fixture encode success, received ${encoded.reason} at ${encoded.path}.`,
		);
	}
	return {
		resource,
		snapshot,
		encoded: encoded.value,
	};
}

function requireDraft(
	result: ReturnType<typeof decodeManuscriptDraft>,
): ManuscriptDraft {
	if (result.type === 'invalid') {
		throw new Error(
			`Expected draft decode success, received ${result.reason} at ${result.path}.`,
		);
	}
	return result.value;
}

suite('Manuscript draft base provenance', () => {
	test('mints only zero-field identity tokens and exposes primitive summaries', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));

		assert.deepStrictEqual(Reflect.ownKeys(draft), []);
		assert.equal(Reflect.getPrototypeOf(draft), null);
		assert.equal(Object.isFrozen(draft), true);

		const view = getManuscriptDraftReadView(draft);
		assert.ok(view);
		assert.equal(Object.isFrozen(view), true);
		assert.deepStrictEqual(Reflect.ownKeys(view).sort(), [
			'canonicalResource',
			'documentHash',
			'entityCount',
			'format',
			'formatVersion',
			'generatedAgainstRevisionId',
			'nodeCount',
			'pendingTransitionCount',
			'relationCount',
			'resource',
			'schemaId',
			'schemaVersion',
		]);
		assert.equal(view.canonicalResource, fixture.resource.toString());
		assert.equal(view.resource.toString(), fixture.resource.toString());
		assert.equal(view.generatedAgainstRevisionId, fixture.snapshot.revisionId);
		assert.equal(view.documentHash, fixture.snapshot.documentHash);
		assert.equal(view.nodeCount, 3);
		assert.equal(view.entityCount, 0);
		assert.equal(view.relationCount, 0);
		assert.equal(view.pendingTransitionCount, 0);
		assert.equal(
			Reflect.ownKeys(view).some(key =>
				key === 'snapshot'
				|| key === 'content'
				|| key === 'index'
				|| key === 'merkleState'
			),
			false,
		);
	});

	test('does not adopt decoded candidates, their parts, or spliced triples', () => {
		const fixture = createFixture();
		const firstCandidate = decodeDocumentSnapshot(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		);
		const secondCandidate = decodeDocumentSnapshot(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		);
		if (
			firstCandidate.type === 'invalid'
			|| secondCandidate.type === 'invalid'
		) {
			throw new Error('Expected strict decoder candidates.');
		}

		assert.equal(getManuscriptDraftReadView(firstCandidate), undefined);
		assert.equal(getManuscriptDraftReadView(firstCandidate.value), undefined);
		assert.equal(
			getManuscriptDraftReadView(firstCandidate.value.snapshot),
			undefined,
		);
		assert.equal(
			getManuscriptDraftReadView(firstCandidate.value.index),
			undefined,
		);
		assert.equal(
			getManuscriptDraftReadView(firstCandidate.value.merkleState),
			undefined,
		);
		assert.equal(getManuscriptDraftReadView({
			snapshot: firstCandidate.value.snapshot,
			index: secondCandidate.value.index,
			merkleState: firstCandidate.value.merkleState,
		}), undefined);
		for (const candidateValue of [
			firstCandidate.value,
			firstCandidate.value.index,
			firstCandidate.value.merkleState,
			{
				snapshot: firstCandidate.value.snapshot,
				index: secondCandidate.value.index,
				merkleState: firstCandidate.value.merkleState,
			},
		]) {
			const adoption = decodeManuscriptDraft(
				candidateValue,
				fixture.resource,
				generousLimits,
			);
			assert.equal(adoption.type, 'invalid');
			assert.equal(getManuscriptDraftReadView(adoption), undefined);
		}

		// A decoded Snapshot that is still a closed canonical value may be
		// decoded again, but that path mints fresh authority instead of adopting
		// the candidate's index or Merkle state.
		const firstRedecode = requireDraft(decodeManuscriptDraft(
			firstCandidate.value.snapshot,
			fixture.resource,
			generousLimits,
		));
		const secondRedecode = requireDraft(decodeManuscriptDraft(
			firstCandidate.value.snapshot,
			fixture.resource,
			generousLimits,
		));
		assert.notEqual(firstRedecode, secondRedecode);
		const firstRedecodeView = getManuscriptDraftReadView(firstRedecode);
		const secondRedecodeView = getManuscriptDraftReadView(secondRedecode);
		assert.ok(firstRedecodeView);
		assert.ok(secondRedecodeView);
		assert.notEqual(firstRedecodeView.resource, secondRedecodeView.resource);
		assert.equal(
			firstRedecodeView.canonicalResource,
			secondRedecodeView.canonicalResource,
		);
		assert.equal(
			firstRedecodeView.documentHash,
			secondRedecodeView.documentHash,
		);
	});

	test('keeps identical decodes independent and rejects every lookalike', () => {
		const fixture = createFixture();
		const first = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const second = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		assert.notEqual(first, second);
		assert.notEqual(
			getManuscriptDraftReadView(first),
			getManuscriptDraftReadView(second),
		);

		assert.equal(
			getManuscriptDraftReadView(Object.freeze(Object.create(null))),
			undefined,
		);
		assert.equal(
			getManuscriptDraftReadView(Object.create(first)),
			undefined,
		);
		assert.equal(getManuscriptDraftReadView({ ...first }), undefined);
		assert.equal(
			getManuscriptDraftReadView(new Proxy(first, {})),
			undefined,
		);
	});

	test('returns a fresh URI and contains mutation of its writable lazy cache', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const first = getManuscriptDraftReadView(draft);
		const second = getManuscriptDraftReadView(draft);
		assert.ok(first);
		assert.ok(second);
		assert.notEqual(first.resource, second.resource);

		const cacheDescriptor = Reflect.getOwnPropertyDescriptor(
			first.resource,
			'_formatted',
		);
		assert.equal(cacheDescriptor?.writable, true);
		Reflect.set(first.resource, '_formatted', 'poisoned-by-reader');
		assert.equal(first.resource.toString(), 'poisoned-by-reader');

		const afterMutation = getManuscriptDraftReadView(draft);
		assert.ok(afterMutation);
		assert.notEqual(afterMutation.resource, first.resource);
		assert.equal(afterMutation.canonicalResource, fixture.resource.toString());
		assert.equal(afterMutation.resource.toString(), fixture.resource.toString());
	});

	test('rejects hostile and reentrant view candidates without caller reads', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		let calls = 0;
		const accessor = Object.defineProperty({}, 'snapshot', {
			enumerable: true,
			get() {
				calls += 1;
				return getManuscriptDraftReadView(draft);
			},
		});
		assert.equal(getManuscriptDraftReadView(accessor), undefined);

		const hostile = new Proxy(Object.create(null), {
			get() {
				calls += 1;
				return getManuscriptDraftReadView(draft);
			},
			getOwnPropertyDescriptor() {
				calls += 1;
				throw new Error('descriptor trap must not run');
			},
			getPrototypeOf() {
				calls += 1;
				throw new Error('prototype trap must not run');
			},
			ownKeys() {
				calls += 1;
				throw new Error('key trap must not run');
			},
		});
		assert.equal(getManuscriptDraftReadView(hostile), undefined);
		assert.equal(calls, 0);
	});

	test('validates the resource first and never mints on failed decode', () => {
		const fixture = createFixture();
		let inspections = 0;
		const hostileValue = new Proxy({}, {
			ownKeys() {
				inspections += 1;
				throw new Error('snapshot should not be inspected');
			},
		});
		const invalidContext = decodeManuscriptDraft(
			hostileValue,
			URI.parse('file:///not-a-manuscript'),
			generousLimits,
		);
		assert.deepStrictEqual(invalidContext, {
			type: 'invalid',
			reason: 'invalid-context',
			path: '$context.resource',
		});
		assert.equal(inspections, 0);
		assert.equal(getManuscriptDraftReadView(invalidContext), undefined);

		const invalidSnapshot = decodeManuscriptDraft({
			...fixture.encoded,
			documentHash: `sha256:${'0'.repeat(64)}`,
		}, fixture.resource, generousLimits);
		assert.equal(invalidSnapshot.type, 'invalid');
		assert.equal(getManuscriptDraftReadView(invalidSnapshot), undefined);
	});
});
