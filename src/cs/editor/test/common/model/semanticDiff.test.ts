/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import {
	parseNodeId,
	parseOperationId,
	parseProposalId,
	parseRevisionId,
} from 'cs/editor/common/core/identifiers';
import { parseUtf16Offset } from 'cs/editor/common/core/semanticPosition';
import {
	createProposalChangeGroupIdentity,
	proposalChangeGroupIdentityAlgorithm,
	proposalChangeGroupKinds,
	type CanonicalSemanticTargetRef,
	type IProposalChangeGroupIdentityInput,
	type ProposalChangeGroupIdentityResult,
} from 'cs/editor/common/model/semanticDiff';

const documentUri = 'comet-draft:018f0000-0000-7000-8000-000000000001';
const generatedAgainstRevisionId = valid(
	parseRevisionId('018f0000-0000-7000-8000-000000000002'),
);
const proposalId = valid(parseProposalId('018f0000-0000-7000-8000-000000000003'));
const firstOperationId = valid(
	parseOperationId('018f0000-0000-7000-8000-000000000004'),
);
const secondOperationId = valid(
	parseOperationId('018f0000-0000-7000-8000-000000000005'),
);
const targetNodeId = valid(parseNodeId('018f0000-0000-7000-8000-000000000006'));
const alternateRevisionId = valid(
	parseRevisionId('018f0000-0000-7000-8000-000000000007'),
);
const alternateProposalId = valid(
	parseProposalId('018f0000-0000-7000-8000-000000000008'),
);
const alternateOperationId = valid(
	parseOperationId('018f0000-0000-7000-8000-000000000009'),
);

const baseTargetRefs: readonly CanonicalSemanticTargetRef[] = Object.freeze([
	Object.freeze({
		kind: 'node',
		nodeId: targetNodeId,
	}),
	Object.freeze({
		kind: 'metadata',
		field: 'title',
	}),
]);

const baseInput: IProposalChangeGroupIdentityInput = Object.freeze({
	documentUri,
	generatedAgainstRevisionId,
	proposalId,
	proposalRevision: 2,
	kind: 'rewrite-content',
	targetRefs: baseTargetRefs,
	operationIds: Object.freeze([firstOperationId, secondOperationId]),
});

function valid<TIdentifier>(
	result:
		| {
			readonly type: 'valid';
			readonly value: TIdentifier;
		}
		| {
			readonly type: 'invalid';
			readonly reason: string;
		},
): TIdentifier {
	if (result.type === 'invalid') {
		throw new Error(`Invalid test identifier: ${result.reason}.`);
	}
	assert.equal(result.type, 'valid');
	return result.value;
}

function requireIdentity(
	input: IProposalChangeGroupIdentityInput,
): Extract<ProposalChangeGroupIdentityResult, { readonly type: 'ok' }> {
	const result = createProposalChangeGroupIdentity(input);
	if (result.type === 'error') {
		throw new Error(`Unexpected identity failure: ${result.reason} at ${result.path}.`);
	}
	assert.equal(result.type, 'ok');
	return result;
}

function createFromUnknown(input: unknown): ProposalChangeGroupIdentityResult {
	return Reflect.apply(createProposalChangeGroupIdentity, undefined, [input]);
}

function expectIdentityError(
	input: unknown,
	reason: Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }>['reason'],
	path: string,
): void {
	assert.deepStrictEqual(createFromUnknown(input), {
		type: 'error',
		reason,
		path,
	});
}

suite('Proposal change group identity', () => {
	test('freezes the identity algorithm, kinds, preimage, hash, and UUIDv8 vector', () => {
		assert.equal(proposalChangeGroupIdentityAlgorithm, 'nireco-proposal-change-group-1');
		assert.equal(Object.isFrozen(proposalChangeGroupKinds), true);
		assert.deepStrictEqual(proposalChangeGroupKinds, [
			'insert-content',
			'rewrite-content',
			'delete-content',
			'move-structure',
			'add-citation',
			'replace-citation',
			'change-evidence',
			'change-claim-relation',
			'metadata',
		]);

		const result = requireIdentity(baseInput);
		const canonicalJson =
			'{"algorithm":"nireco-proposal-change-group-1","documentUri":"comet-draft:018f0000-0000-7000-8000-000000000001","generatedAgainstRevisionId":"018f0000-0000-7000-8000-000000000002","kind":"rewrite-content","operationIds":["018f0000-0000-7000-8000-000000000004","018f0000-0000-7000-8000-000000000005"],"proposalId":"018f0000-0000-7000-8000-000000000003","proposalRevision":2,"targetRefs":[{"field":"title","kind":"metadata"},{"kind":"node","nodeId":"018f0000-0000-7000-8000-000000000006"}]}';
		const preimage =
			`NIRECO\0HASH\0V1\0nireco.proposal-change-group.v1\0${canonicalJson}`;

		assert.equal(result.canonicalJson, canonicalJson);
		assert.equal(result.preimage, preimage);
		assert.equal(
			result.hash,
			'sha256:667715b3c7fdfe5ccf4171e303be3d23f4f76edba302238dece8fc0eaf18d22f',
		);
		assert.equal(result.hash, `sha256:${createHash('sha256').update(preimage).digest('hex')}`);
		assert.equal(result.id, '667715b3-c7fd-8e5c-8f41-71e303be3d23');
		assert.deepStrictEqual(result.payload, {
			algorithm: proposalChangeGroupIdentityAlgorithm,
			documentUri,
			generatedAgainstRevisionId,
			proposalId,
			proposalRevision: 2,
			kind: 'rewrite-content',
			targetRefs: [
				{
					kind: 'metadata',
					field: 'title',
				},
				{
					kind: 'node',
					nodeId: targetNodeId,
				},
			],
			operationIds: [firstOperationId, secondOperationId],
		});
		assert.equal(Object.isFrozen(result.payload), true);
		assert.equal(Object.isFrozen(result.payload.targetRefs), true);
		assert.equal(Object.isFrozen(result.payload.operationIds), true);
	});

	test('canonicalizes target display order without changing identity', () => {
		const reversed = requireIdentity({
			...baseInput,
			targetRefs: [...baseInput.targetRefs].reverse(),
		});
		const original = requireIdentity(baseInput);

		assert.equal(reversed.id, original.id);
		assert.equal(reversed.hash, original.hash);
		assert.equal(reversed.preimage, original.preimage);
		assert.deepStrictEqual(reversed.payload.targetRefs, original.payload.targetRefs);
	});

	test('preserves persisted operation order as an identity field', () => {
		const original = requireIdentity(baseInput);
		const reversed = requireIdentity({
			...baseInput,
			operationIds: [secondOperationId, firstOperationId],
		});

		assert.notEqual(reversed.id, original.id);
		assert.notEqual(reversed.hash, original.hash);
		assert.deepStrictEqual(
			reversed.payload.operationIds,
			[secondOperationId, firstOperationId],
		);
	});

	test('changes identity when any frozen semantic field changes', () => {
		const alternatives: readonly IProposalChangeGroupIdentityInput[] = [
			{
				...baseInput,
				documentUri: 'comet-draft:018f0000-0000-7000-8000-00000000000a',
			},
			{
				...baseInput,
				generatedAgainstRevisionId: alternateRevisionId,
			},
			{
				...baseInput,
				proposalId: alternateProposalId,
			},
			{
				...baseInput,
				proposalRevision: baseInput.proposalRevision + 1,
			},
			{
				...baseInput,
				kind: 'metadata',
			},
			{
				...baseInput,
				targetRefs: [{
					kind: 'metadata',
					field: 'abstract',
				}],
			},
			{
				...baseInput,
				operationIds: [firstOperationId, alternateOperationId],
			},
		];
		const original = requireIdentity(baseInput);
		const identities = alternatives.map(input => requireIdentity(input).id);

		assert.equal(new Set([original.id, ...identities]).size, alternatives.length + 1);
	});

	test('rejects non-canonical document and primary identifiers', () => {
		expectIdentityError(
			{ ...baseInput, documentUri: documentUri.toUpperCase() },
			'invalid-document-uri',
			'$.documentUri',
		);
		expectIdentityError(
			{
				...baseInput,
				generatedAgainstRevisionId: '018f0000-0000-8000-8000-000000000002',
			},
			'invalid-generated-revision-id',
			'$.generatedAgainstRevisionId',
		);
		expectIdentityError(
			{
				...baseInput,
				proposalId: '018f0000-0000-8000-8000-000000000003',
			},
			'invalid-proposal-id',
			'$.proposalId',
		);
		for (const proposalRevision of [0, -1, 1.5, Number.NaN]) {
			expectIdentityError(
				{ ...baseInput, proposalRevision },
				'invalid-proposal-revision',
				'$.proposalRevision',
			);
		}
		expectIdentityError(
			{ ...baseInput, kind: 'presentation-only' },
			'invalid-kind',
			'$.kind',
		);
	});

	test('rejects empty, duplicate, and malformed target refs without invoking accessors', () => {
		expectIdentityError(
			{ ...baseInput, targetRefs: [] },
			'empty-target-refs',
			'$.targetRefs',
		);
		expectIdentityError(
			{ ...baseInput, targetRefs: [baseTargetRefs[0], baseTargetRefs[0]] },
			'duplicate-target-ref',
			'$.targetRefs',
		);
		expectIdentityError(
			{
				...baseInput,
				targetRefs: [{
					kind: 'node',
					nodeId: targetNodeId,
					presentation: 'heading',
				}],
			},
			'invalid-target-ref',
			'$.targetRefs[0]',
		);

		let getterCalls = 0;
		const accessorTarget = {
			kind: 'node',
		};
		Object.defineProperty(accessorTarget, 'nodeId', {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return targetNodeId;
			},
		});
		expectIdentityError(
			{ ...baseInput, targetRefs: [accessorTarget] },
			'invalid-target-ref',
			'$.targetRefs[0]',
		);
		assert.equal(getterCalls, 0);
	});

	test('validates canonical semantic range positions and ordering', () => {
		const textNodeId = targetNodeId;
		const startOffset = valid(parseUtf16Offset(1));
		const endOffset = valid(parseUtf16Offset(4));
		const validRange = requireIdentity({
			...baseInput,
			targetRefs: [{
				kind: 'range',
				start: {
					kind: 'text',
					textNodeId,
					utf16Offset: startOffset,
					affinity: 'before',
				},
				end: {
					kind: 'text',
					textNodeId,
					utf16Offset: endOffset,
					affinity: 'after',
				},
			}],
		});
		assert.equal(validRange.payload.targetRefs[0]?.kind, 'range');

		expectIdentityError(
			{
				...baseInput,
				targetRefs: [{
					kind: 'range',
					start: {
						kind: 'text',
						textNodeId,
						utf16Offset: endOffset,
						affinity: 'before',
					},
					end: {
						kind: 'text',
						textNodeId,
						utf16Offset: startOffset,
						affinity: 'after',
					},
				}],
			},
			'invalid-target-ref',
			'$.targetRefs[0]',
		);
		expectIdentityError(
			{
				...baseInput,
				targetRefs: [{
					kind: 'range',
					start: {
						kind: 'text',
						textNodeId,
						utf16Offset: '1',
						affinity: 'before',
					},
					end: {
						kind: 'text',
						textNodeId,
						utf16Offset: endOffset,
						affinity: 'after',
					},
				}],
			},
			'invalid-target-ref',
			'$.targetRefs[0].start',
		);
	});

	test('rejects missing, duplicate, and non-UUIDv7 operation identities', () => {
		expectIdentityError(
			{ ...baseInput, operationIds: [] },
			'empty-operation-ids',
			'$.operationIds',
		);
		expectIdentityError(
			{ ...baseInput, operationIds: [firstOperationId, firstOperationId] },
			'duplicate-operation-id',
			'$.operationIds[1]',
		);
		expectIdentityError(
			{
				...baseInput,
				operationIds: [
					firstOperationId,
					'018f0000-0000-8000-8000-000000000005',
				],
			},
			'invalid-operation-id',
			'$.operationIds[1]',
		);
	});
});
