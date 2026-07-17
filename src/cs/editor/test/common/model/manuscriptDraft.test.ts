/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	parseNodeId,
	parseOperationId,
	parseRevisionId,
	type NodeId,
	type OperationId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	advanceManuscriptDraftOperation,
	decodeManuscriptDraft,
	getManuscriptDraftReadView,
	type AdvanceManuscriptDraftOperationResult,
	type ManuscriptDraft,
	type ManuscriptDraftAdvanceFailure,
} from 'cs/editor/common/model/manuscriptDraft';
import type { ManuscriptNode } from 'cs/editor/common/model/manuscript';
import type { Operation } from 'cs/editor/common/model/operation';
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
import { maximumOperationWitness } from 'cs/editor/test/common/performance/manuscriptProfiles';

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

function operationId(sequence: number): OperationId {
	const parsed = parseOperationId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Operation ID.');
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

function requireAdvanced(
	result: AdvanceManuscriptDraftOperationResult,
): ManuscriptDraft {
	if (result.type === 'error') {
		throw new Error(
			`Expected draft advance success, received ${result.error.reason}.`,
		);
	}
	return result.value;
}

function requireAdvanceFailure(
	result: AdvanceManuscriptDraftOperationResult,
	reason: ManuscriptDraftAdvanceFailure['reason'],
): ManuscriptDraftAdvanceFailure {
	if (result.type === 'ok') {
		throw new Error('Expected draft advance failure.');
	}
	assert.equal(result.error.reason, reason);
	return result.error;
}

function contentFromSnapshot(
	snapshot: DocumentSnapshot,
): DocumentContent {
	return Object.freeze({
		format: snapshot.format,
		formatVersion: snapshot.formatVersion,
		schemaId: snapshot.schemaId,
		schemaVersion: snapshot.schemaVersion,
		metadata: snapshot.metadata,
		root: snapshot.root,
		academicGraph: snapshot.academicGraph,
		settings: snapshot.settings,
	});
}

function createSetMetadataOperation(
	content: DocumentContent,
	sequence: number,
	title: string,
): Extract<Operation, { readonly type: 'set-metadata' }> {
	return Object.freeze({
		id: operationId(sequence),
		type: 'set-metadata',
		expectedMetadataHash:
			rebuildRevisionMerkleState(content).metadataHash,
		metadata: Object.freeze({
			title,
			authors: content.metadata.authors,
			abstract: content.metadata.abstract,
			keywords: content.metadata.keywords,
		}),
	});
}

function applySetMetadataOperation(
	content: DocumentContent,
	operation: Extract<Operation, { readonly type: 'set-metadata' }>,
): DocumentContent {
	return Object.freeze({
		...content,
		metadata: operation.metadata,
	});
}

suite('Manuscript draft authority', () => {
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

	test('advances linearly through current checkpoint hashes', () => {
		const fixture = createFixture();
		const base = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		let expectedContent = contentFromSnapshot(fixture.snapshot);
		const firstOperation = createSetMetadataOperation(
			expectedContent,
			300,
			'First successor',
		);
		const firstResult = advanceManuscriptDraftOperation(
			base,
			firstOperation,
		);
		assert.equal(Object.isFrozen(firstResult), true);
		assert.deepStrictEqual(
			Reflect.ownKeys(firstResult).sort(),
			['type', 'value'],
		);
		const first = requireAdvanced(firstResult);
		expectedContent = applySetMetadataOperation(
			expectedContent,
			firstOperation,
		);

		assert.equal(getManuscriptDraftReadView(base), undefined);
		assert.deepStrictEqual(Reflect.ownKeys(first), []);
		assert.equal(Reflect.getPrototypeOf(first), null);
		assert.equal(Object.isFrozen(first), true);
		const firstView = getManuscriptDraftReadView(first);
		assert.ok(firstView);
		assert.equal(
			firstView.documentHash,
			rebuildRevisionMerkleState(expectedContent).documentHash,
		);
		assert.equal(firstView.pendingTransitionCount, 1);

		const secondOperation = createSetMetadataOperation(
			expectedContent,
			301,
			'Second successor',
		);
		const second = requireAdvanced(
			advanceManuscriptDraftOperation(first, secondOperation),
		);
		expectedContent = applySetMetadataOperation(
			expectedContent,
			secondOperation,
		);

		assert.equal(getManuscriptDraftReadView(first), undefined);
		const secondView = getManuscriptDraftReadView(second);
		assert.ok(secondView);
		assert.equal(
			secondView.documentHash,
			rebuildRevisionMerkleState(expectedContent).documentHash,
		);
		assert.notEqual(secondView.documentHash, firstView.documentHash);
		assert.equal(
			secondView.generatedAgainstRevisionId,
			fixture.snapshot.revisionId,
		);
		assert.equal(secondView.pendingTransitionCount, 2);
		assert.equal(secondView.nodeCount, firstView.nodeCount);
		assert.equal(secondView.entityCount, firstView.entityCount);
		assert.equal(secondView.relationCount, firstView.relationCount);
	});

	test('preserves predecessor authority when an Operation is rejected', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const expectedContent = contentFromSnapshot(fixture.snapshot);
		const validOperation = createSetMetadataOperation(
			expectedContent,
			310,
			'Accepted after retry',
		);
		assert.notEqual(
			validOperation.expectedMetadataHash,
			fixture.snapshot.documentHash,
		);
		const rejectedOperation: Operation = Object.freeze({
			...validOperation,
			id: operationId(311),
			expectedMetadataHash: fixture.snapshot.documentHash,
		});
		const before = getManuscriptDraftReadView(draft);
		assert.ok(before);

		const failure = requireAdvanceFailure(
			advanceManuscriptDraftOperation(draft, rejectedOperation),
			'operation-rejected',
		);
		assert.equal(Object.isFrozen(failure), true);
		assert.deepStrictEqual(
			Reflect.ownKeys(failure).sort(),
			['reason', 'reducerFailure'],
		);
		assert.equal(
			failure.reason === 'operation-rejected'
				? failure.reducerFailure.reason
				: undefined,
			'hash-mismatch',
		);
		const after = getManuscriptDraftReadView(draft);
		assert.ok(after);
		assert.equal(after.documentHash, before.documentHash);
		assert.equal(after.pendingTransitionCount, 0);

		const successor = requireAdvanced(
			advanceManuscriptDraftOperation(draft, validOperation),
		);
		assert.equal(getManuscriptDraftReadView(draft), undefined);
		assert.equal(
			getManuscriptDraftReadView(successor)?.pendingTransitionCount,
			1,
		);
	});

	test('captures immutable Operation limits at decode authority creation', () => {
		const fixture = createFixture();
		const mutableLimits = {
			...generousLimits,
		};
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			mutableLimits,
		));
		mutableLimits.maximumNodes = 0;
		mutableLimits.maximumNodeDepth = 0;

		const successor = requireAdvanced(
			advanceManuscriptDraftOperation(
				draft,
				createSetMetadataOperation(
					contentFromSnapshot(fixture.snapshot),
					315,
					'Captured limits',
				),
			),
		);
		assert.equal(getManuscriptDraftReadView(draft), undefined);
		assert.equal(
			getManuscriptDraftReadView(successor)?.pendingTransitionCount,
			1,
		);
	});

	test('keeps independently decoded A/B authorities isolated', () => {
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
		const initialContent = contentFromSnapshot(fixture.snapshot);
		const operation = createSetMetadataOperation(
			initialContent,
			320,
			'Independent advance',
		);

		const firstSuccessor = requireAdvanced(
			advanceManuscriptDraftOperation(first, operation),
		);
		assert.equal(getManuscriptDraftReadView(first), undefined);
		assert.equal(
			getManuscriptDraftReadView(second)?.pendingTransitionCount,
			0,
		);

		const secondSuccessor = requireAdvanced(
			advanceManuscriptDraftOperation(second, operation),
		);
		assert.notEqual(firstSuccessor, secondSuccessor);
		assert.equal(getManuscriptDraftReadView(second), undefined);
		assert.equal(
			getManuscriptDraftReadView(firstSuccessor)?.documentHash,
			getManuscriptDraftReadView(secondSuccessor)?.documentHash,
		);

		requireAdvanceFailure(
			advanceManuscriptDraftOperation(firstSuccessor, operation),
			'operation-rejected',
		);
		assert.equal(
			getManuscriptDraftReadView(firstSuccessor)
				?.pendingTransitionCount,
			1,
		);
		assert.equal(
			getManuscriptDraftReadView(secondSuccessor)
				?.pendingTransitionCount,
			1,
		);
	});

	test('rejects clone, Proxy, derived, same-shape, and stale tokens without reading the Operation', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		let operationReads = 0;
		const hostileOperation = new Proxy(Object.create(null), {
			get() {
				operationReads += 1;
				throw new Error('An invalid draft must not inspect its Operation.');
			},
		}) as Operation;
		for (const candidate of [
			Object.freeze(Object.create(null)),
			Object.create(draft),
			{ ...draft },
			new Proxy(draft, {
				get() {
					throw new Error('A token Proxy must not be inspected.');
				},
				getPrototypeOf() {
					throw new Error('A token Proxy must not be inspected.');
				},
			}),
		]) {
			requireAdvanceFailure(
				advanceManuscriptDraftOperation(
					candidate,
					hostileOperation,
				),
				'invalid-draft',
			);
		}
		assert.equal(operationReads, 0);

		const validOperation = createSetMetadataOperation(
			contentFromSnapshot(fixture.snapshot),
			330,
			'Invalidate predecessor',
		);
		requireAdvanced(
			advanceManuscriptDraftOperation(draft, validOperation),
		);
		requireAdvanceFailure(
			advanceManuscriptDraftOperation(draft, hostileOperation),
			'invalid-draft',
		);
		assert.equal(operationReads, 0);
	});

	test('rejects same-token reentrancy before reading its nested Operation', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const independentDraft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const content = contentFromSnapshot(fixture.snapshot);
		const metadataOperation = createSetMetadataOperation(
			content,
			340,
			'Reentrant outer advance',
		);
		let nestedOperationReads = 0;
		const nestedOperation = new Proxy(Object.create(null), {
			get() {
				nestedOperationReads += 1;
				throw new Error('A busy draft must not read the nested Operation.');
			},
		}) as Operation;
		let nestedResult:
			AdvanceManuscriptDraftOperationResult | undefined;
		let independentResult:
			AdvanceManuscriptDraftOperationResult | undefined;
		let typeReads = 0;
		const reentrantOperation = Object.defineProperties({
			id: metadataOperation.id,
			expectedMetadataHash:
				metadataOperation.expectedMetadataHash,
			metadata: metadataOperation.metadata,
		}, {
			type: {
				enumerable: true,
				configurable: true,
				get() {
					typeReads += 1;
					if (typeReads === 1) {
						nestedResult = advanceManuscriptDraftOperation(
							draft,
							nestedOperation,
						);
						independentResult =
							advanceManuscriptDraftOperation(
								independentDraft,
								createSetMetadataOperation(
									content,
									341,
									'Independent nested advance',
								),
							);
					}
					return 'set-metadata';
				},
			},
		}) as Operation;

		const successor = requireAdvanced(
			advanceManuscriptDraftOperation(
				draft,
				reentrantOperation,
			),
		);
		assert.ok(nestedResult);
		requireAdvanceFailure(nestedResult, 'draft-busy');
		assert.ok(independentResult);
		const independentSuccessor = requireAdvanced(independentResult);
		assert.equal(nestedOperationReads, 0);
		assert.equal(getManuscriptDraftReadView(draft), undefined);
		assert.equal(
			getManuscriptDraftReadView(independentDraft),
			undefined,
		);
		const successorView = getManuscriptDraftReadView(successor);
		assert.ok(successorView);
		assert.equal(successorView.pendingTransitionCount, 1);
		assert.equal(
			getManuscriptDraftReadView(independentSuccessor)
				?.pendingTransitionCount,
			1,
		);

		const readsAfterAdvance = typeReads;
		assert.equal(Reflect.defineProperty(reentrantOperation, 'type', {
			enumerable: true,
			configurable: true,
			get() {
				throw new Error(
					'Successor authority must not retain or reread the caller Operation.',
				);
			},
		}), true);
		Reflect.set(reentrantOperation, 'id', operationId(342));
		Reflect.set(
			reentrantOperation,
			'expectedMetadataHash',
			fixture.snapshot.documentHash,
		);
		Reflect.set(reentrantOperation, 'metadata', Object.freeze({
			title: 'Mutated after success',
			authors: [],
			abstract: '',
			keywords: [],
		}));
		assert.equal(
			getManuscriptDraftReadView(successor)?.documentHash,
			successorView.documentHash,
		);
		assert.equal(typeReads, readsAfterAdvance);

		const expectedSuccessorContent = applySetMetadataOperation(
			content,
			metadataOperation,
		);
		const finalSuccessor = requireAdvanced(
			advanceManuscriptDraftOperation(
				successor,
				createSetMetadataOperation(
					expectedSuccessorContent,
					343,
					'Advance after caller mutation',
				),
			),
		);
		assert.equal(getManuscriptDraftReadView(successor), undefined);
		assert.equal(
			getManuscriptDraftReadView(finalSuccessor)
				?.pendingTransitionCount,
			2,
		);
		assert.equal(typeReads, readsAfterAdvance);
	});

	test('keeps the predecessor atomic when the incremental updater rejects a hostile capture', () => {
		const fixture = createFixture();
		const draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		const content = contentFromSnapshot(fixture.snapshot);
		const metadataOperation = createSetMetadataOperation(
			content,
			350,
			'Updater must reject this capture',
		);
		let typeReads = 0;
		const hostileOperation = Object.defineProperties({
			id: metadataOperation.id,
			expectedMetadataHash:
				metadataOperation.expectedMetadataHash,
			metadata: metadataOperation.metadata,
		}, {
			type: {
				enumerable: true,
				get() {
					typeReads += 1;
					return typeReads === 1
						? 'set-metadata'
						: 'set-settings';
				},
			},
		}) as Operation;

		requireAdvanceFailure(
			advanceManuscriptDraftOperation(draft, hostileOperation),
			'merkle-update-failed',
		);
		const afterFailure = getManuscriptDraftReadView(draft);
		assert.ok(afterFailure);
		assert.equal(afterFailure.documentHash, fixture.snapshot.documentHash);
		assert.equal(afterFailure.pendingTransitionCount, 0);

		const successor = requireAdvanced(
			advanceManuscriptDraftOperation(
				draft,
				createSetMetadataOperation(
					content,
					351,
					'Retry after updater failure',
				),
			),
		);
		assert.equal(getManuscriptDraftReadView(draft), undefined);
		assert.equal(
			getManuscriptDraftReadView(successor)?.pendingTransitionCount,
			1,
		);
	});

	test('extends the maximum-operation profile as a private pending cons chain', () => {
		const fixture = createFixture();
		let draft = requireDraft(decodeManuscriptDraft(
			fixture.encoded,
			fixture.resource,
			generousLimits,
		));
		let expectedContent = contentFromSnapshot(fixture.snapshot);
		for (
			let index = 0;
			index < maximumOperationWitness.operationCount;
			index += 1
		) {
			const operation = createSetMetadataOperation(
				expectedContent,
				10_000 + index,
				`Pending ${index}`,
			);
			const predecessor = draft;
			draft = requireAdvanced(
				advanceManuscriptDraftOperation(draft, operation),
			);
			expectedContent = applySetMetadataOperation(
				expectedContent,
				operation,
			);
			assert.equal(getManuscriptDraftReadView(predecessor), undefined);
		}

		const view = getManuscriptDraftReadView(draft);
		assert.ok(view);
		assert.equal(
			view.pendingTransitionCount,
			maximumOperationWitness.expectedPendingTransitionCount,
		);
		assert.equal(
			view.documentHash,
			rebuildRevisionMerkleState(expectedContent).documentHash,
		);
		assert.equal(
			Reflect.ownKeys(view).some(key =>
				key === 'pendingTransitions'
					|| key === 'pendingTransitionTail'
					|| key === 'receipt'
					|| key === 'capture'
					|| key === 'touchSet'
					|| key === 'positionMapFragments'
			),
			false,
		);
	});
});
