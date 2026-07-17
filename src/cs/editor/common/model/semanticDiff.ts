/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	deriveProposalChangeGroupId,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseProposalId,
	parseRevisionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type OperationId,
	type ProposalChangeGroupId,
	type ProposalId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { serializeCanonicalJson } from 'cs/editor/common/core/canonicalJson';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import { parseManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type SemanticPosition,
} from 'cs/editor/common/core/semanticPosition';
import {
	hashCanonicalJson,
	hashUtf8Bytes,
} from 'cs/editor/common/core/sha256';

export const proposalChangeGroupIdentityAlgorithm = 'nireco-proposal-change-group-1';

export const proposalChangeGroupKinds = Object.freeze([
	'insert-content',
	'rewrite-content',
	'delete-content',
	'move-structure',
	'add-citation',
	'replace-citation',
	'change-evidence',
	'change-claim-relation',
	'metadata',
] as const);

export type ProposalChangeGroupKind = (typeof proposalChangeGroupKinds)[number];

export type CanonicalSemanticTargetRef =
	| {
		readonly kind: 'node';
		readonly nodeId: NodeId;
	}
	| {
		readonly kind: 'academic-entity';
		readonly entityId: EntityId;
	}
	| {
		readonly kind: 'range';
		readonly start: SemanticPosition;
		readonly end: SemanticPosition;
	}
	| {
		readonly kind: 'metadata';
		readonly field: 'title' | 'authors' | 'abstract' | 'keywords';
	};

export interface IProposalChangeGroupIdentityPayload {
	readonly algorithm: typeof proposalChangeGroupIdentityAlgorithm;
	readonly documentUri: string;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly proposalId: ProposalId;
	readonly proposalRevision: number;
	readonly kind: ProposalChangeGroupKind;
	readonly targetRefs: readonly CanonicalSemanticTargetRef[];
	readonly operationIds: readonly OperationId[];
}

export interface IProposalChangeGroupIdentityInput {
	readonly documentUri: string;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly proposalId: ProposalId;
	readonly proposalRevision: number;
	readonly kind: ProposalChangeGroupKind;
	readonly targetRefs: readonly CanonicalSemanticTargetRef[];
	readonly operationIds: readonly OperationId[];
}

export type ProposalChangeGroupIdentityFailure =
	| 'invalid-document-uri'
	| 'invalid-generated-revision-id'
	| 'invalid-proposal-id'
	| 'invalid-proposal-revision'
	| 'invalid-kind'
	| 'empty-target-refs'
	| 'invalid-target-ref'
	| 'duplicate-target-ref'
	| 'empty-operation-ids'
	| 'invalid-operation-id'
	| 'duplicate-operation-id'
	| 'canonical-json';

export type ProposalChangeGroupIdentityResult =
	| {
		readonly type: 'ok';
		readonly id: ProposalChangeGroupId;
		readonly hash: ContentHash;
		readonly payload: IProposalChangeGroupIdentityPayload;
		readonly canonicalJson: string;
		readonly preimage: string;
	}
	| {
		readonly type: 'error';
		readonly reason: ProposalChangeGroupIdentityFailure;
		readonly path: string;
	};

export function createProposalChangeGroupIdentity(
	input: IProposalChangeGroupIdentityInput,
): ProposalChangeGroupIdentityResult {
	if (typeof input.documentUri !== 'string') {
		return identityError('invalid-document-uri', '$.documentUri');
	}
	const document = parseManuscriptResource(input.documentUri);
	if (document.type === 'invalid') {
		return identityError('invalid-document-uri', '$.documentUri');
	}

	if (typeof input.generatedAgainstRevisionId !== 'string') {
		return identityError(
			'invalid-generated-revision-id',
			'$.generatedAgainstRevisionId',
		);
	}
	const generatedRevision = parseRevisionId(input.generatedAgainstRevisionId);
	if (generatedRevision.type === 'invalid') {
		return identityError(
			'invalid-generated-revision-id',
			'$.generatedAgainstRevisionId',
		);
	}

	if (typeof input.proposalId !== 'string') {
		return identityError('invalid-proposal-id', '$.proposalId');
	}
	const proposalId = parseProposalId(input.proposalId);
	if (proposalId.type === 'invalid') {
		return identityError('invalid-proposal-id', '$.proposalId');
	}

	if (!Number.isSafeInteger(input.proposalRevision) || input.proposalRevision < 1) {
		return identityError('invalid-proposal-revision', '$.proposalRevision');
	}

	if (!isProposalChangeGroupKind(input.kind)) {
		return identityError('invalid-kind', '$.kind');
	}

	const targetRefs = canonicalizeTargetRefs(input.targetRefs);
	if (targetRefs.type === 'error') {
		return targetRefs;
	}

	const operationIds = validateOperationIds(input.operationIds);
	if (operationIds.type === 'error') {
		return operationIds;
	}

	const payload: IProposalChangeGroupIdentityPayload = Object.freeze({
		algorithm: proposalChangeGroupIdentityAlgorithm,
		documentUri: document.canonical,
		generatedAgainstRevisionId: generatedRevision.value,
		proposalId: proposalId.value,
		proposalRevision: input.proposalRevision,
		kind: input.kind,
		targetRefs: targetRefs.values,
		operationIds: operationIds.values,
	});
	const hashed = hashCanonicalJson(manuscriptHashDomains.proposalChangeGroup, payload);
	if (hashed.type === 'error') {
		return identityError('canonical-json', hashed.path);
	}

	return {
		type: 'ok',
		id: deriveProposalChangeGroupId(hashUtf8Bytes(hashed.preimage)),
		hash: hashed.hash,
		payload,
		canonicalJson: hashed.canonicalJson,
		preimage: hashed.preimage,
	};
}

type CanonicalTargetRefsResult =
	| {
		readonly type: 'ok';
		readonly values: readonly CanonicalSemanticTargetRef[];
	}
	| Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }>;

function canonicalizeTargetRefs(
	targetRefs: readonly CanonicalSemanticTargetRef[],
): CanonicalTargetRefsResult {
	if (targetRefs.length === 0) {
		return identityError('empty-target-refs', '$.targetRefs');
	}

	const keyed: {
		readonly key: string;
		readonly value: CanonicalSemanticTargetRef;
	}[] = [];
	for (let index = 0; index < targetRefs.length; index += 1) {
		const normalized = normalizeTargetRef(targetRefs[index], index);
		if (normalized.type === 'error') {
			return normalized;
		}
		const canonical = serializeCanonicalJson(normalized.value);
		if (canonical.type === 'error') {
			return identityError('canonical-json', canonical.error.path);
		}
		keyed.push({
			key: canonical.value,
			value: normalized.value,
		});
	}

	keyed.sort((left, right) => compareCanonicalKeys(left.key, right.key));
	for (let index = 1; index < keyed.length; index += 1) {
		if (keyed[index - 1]?.key === keyed[index]?.key) {
			return identityError('duplicate-target-ref', '$.targetRefs');
		}
	}

	return {
		type: 'ok',
		values: Object.freeze(keyed.map(entry => entry.value)),
	};
}

type NormalizedTargetRefResult =
	| {
		readonly type: 'ok';
		readonly value: CanonicalSemanticTargetRef;
	}
	| Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }>;

function normalizeTargetRef(
	target: CanonicalSemanticTargetRef | undefined,
	index: number,
): NormalizedTargetRefResult {
	const path = `$.targetRefs[${index}]`;
	if (!isClosedRecord(target)) {
		return identityError('invalid-target-ref', path);
	}

	switch (readDataProperty(target, 'kind')) {
		case 'node': {
			if (!hasExactDataProperties(target, ['kind', 'nodeId'])) {
				return identityError('invalid-target-ref', path);
			}
			const rawNodeId = readDataProperty(target, 'nodeId');
			if (typeof rawNodeId !== 'string') {
				return identityError('invalid-target-ref', `${path}.nodeId`);
			}
			const nodeId = parseNodeId(rawNodeId);
			return nodeId.type === 'valid'
				? {
					type: 'ok',
					value: Object.freeze({
						kind: 'node',
						nodeId: nodeId.value,
					}),
				}
				: identityError('invalid-target-ref', `${path}.nodeId`);
		}
		case 'academic-entity': {
			if (!hasExactDataProperties(target, ['kind', 'entityId'])) {
				return identityError('invalid-target-ref', path);
			}
			const rawEntityId = readDataProperty(target, 'entityId');
			if (typeof rawEntityId !== 'string') {
				return identityError('invalid-target-ref', `${path}.entityId`);
			}
			const entityId = parseEntityId(rawEntityId);
			return entityId.type === 'valid'
				? {
					type: 'ok',
					value: Object.freeze({
						kind: 'academic-entity',
						entityId: entityId.value,
					}),
				}
				: identityError('invalid-target-ref', `${path}.entityId`);
		}
		case 'range': {
			if (!hasExactDataProperties(target, ['kind', 'start', 'end'])) {
				return identityError('invalid-target-ref', path);
			}
			const start = normalizeSemanticPosition(
				readDataProperty(target, 'start'),
				`${path}.start`,
			);
			if (start.type === 'error') {
				return start;
			}
			const end = normalizeSemanticPosition(
				readDataProperty(target, 'end'),
				`${path}.end`,
			);
			if (end.type === 'error') {
				return end;
			}
			if (!isOrderedComparableRange(start.value, end.value)) {
				return identityError('invalid-target-ref', path);
			}
			return {
				type: 'ok',
				value: Object.freeze({
					kind: 'range',
					start: start.value,
					end: end.value,
				}),
			};
		}
		case 'metadata': {
			if (!hasExactDataProperties(target, ['kind', 'field'])) {
				return identityError('invalid-target-ref', path);
			}
			const field = readDataProperty(target, 'field');
			return isMetadataField(field)
				? {
					type: 'ok',
					value: Object.freeze({
						kind: 'metadata',
						field,
					}),
				}
				: identityError('invalid-target-ref', `${path}.field`);
		}
		default:
			return identityError('invalid-target-ref', `${path}.kind`);
	}
}

type NormalizedPositionResult =
	| {
		readonly type: 'ok';
		readonly value: SemanticPosition;
	}
	| Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }>;

function normalizeSemanticPosition(value: unknown, path: string): NormalizedPositionResult {
	if (!isClosedRecord(value)) {
		return identityError('invalid-target-ref', path);
	}

	switch (readDataProperty(value, 'kind')) {
		case 'text': {
			if (
				!hasExactDataProperties(
					value,
					['kind', 'textNodeId', 'utf16Offset', 'affinity'],
				)
			) {
				return identityError('invalid-target-ref', path);
			}
			const rawTextNodeId = readDataProperty(value, 'textNodeId');
			const rawUtf16Offset = readDataProperty(value, 'utf16Offset');
			const affinity = readDataProperty(value, 'affinity');
			if (typeof rawTextNodeId !== 'string' || typeof rawUtf16Offset !== 'number') {
				return identityError('invalid-target-ref', path);
			}
			const textNodeId = parseNodeId(rawTextNodeId);
			const utf16Offset = parseUtf16Offset(rawUtf16Offset);
			if (
				textNodeId.type === 'invalid'
				|| utf16Offset.type === 'invalid'
				|| !isPositionAffinity(affinity)
			) {
				return identityError('invalid-target-ref', path);
			}
			return {
				type: 'ok',
				value: Object.freeze({
					kind: 'text',
					textNodeId: textNodeId.value,
					utf16Offset: utf16Offset.value,
					affinity,
				}),
			};
		}
		case 'node-boundary': {
			if (
				!hasExactDataProperties(
					value,
					['kind', 'parentNodeId', 'childIndex', 'affinity'],
				)
			) {
				return identityError('invalid-target-ref', path);
			}
			const rawParentNodeId = readDataProperty(value, 'parentNodeId');
			const childIndex = readDataProperty(value, 'childIndex');
			const affinity = readDataProperty(value, 'affinity');
			if (
				typeof rawParentNodeId !== 'string'
				|| !isNonnegativeSafeInteger(childIndex)
				|| !isPositionAffinity(affinity)
			) {
				return identityError('invalid-target-ref', path);
			}
			const parentNodeId = parseNodeId(rawParentNodeId);
			if (parentNodeId.type === 'invalid') {
				return identityError('invalid-target-ref', path);
			}
			return {
				type: 'ok',
				value: Object.freeze({
					kind: 'node-boundary',
					parentNodeId: parentNodeId.value,
					childIndex,
					affinity,
				}),
			};
		}
		default:
			return identityError('invalid-target-ref', `${path}.kind`);
	}
}

type ValidOperationIdsResult =
	| {
		readonly type: 'ok';
		readonly values: readonly OperationId[];
	}
	| Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }>;

function validateOperationIds(operationIds: readonly OperationId[]): ValidOperationIdsResult {
	if (operationIds.length === 0) {
		return identityError('empty-operation-ids', '$.operationIds');
	}

	const values: OperationId[] = [];
	const seen = new Set<OperationId>();
	for (let index = 0; index < operationIds.length; index += 1) {
		const rawOperationId = operationIds[index];
		if (typeof rawOperationId !== 'string') {
			return identityError('invalid-operation-id', `$.operationIds[${index}]`);
		}
		const parsed = parseOperationId(rawOperationId);
		if (parsed.type === 'invalid') {
			return identityError('invalid-operation-id', `$.operationIds[${index}]`);
		}
		if (seen.has(parsed.value)) {
			return identityError('duplicate-operation-id', `$.operationIds[${index}]`);
		}
		seen.add(parsed.value);
		values.push(parsed.value);
	}

	return {
		type: 'ok',
		values: Object.freeze(values),
	};
}

function isOrderedComparableRange(start: SemanticPosition, end: SemanticPosition): boolean {
	if (
		start.kind === 'text'
		&& end.kind === 'text'
		&& start.textNodeId === end.textNodeId
	) {
		return start.utf16Offset <= end.utf16Offset;
	}
	if (
		start.kind === 'node-boundary'
		&& end.kind === 'node-boundary'
		&& start.parentNodeId === end.parentNodeId
	) {
		return start.childIndex <= end.childIndex;
	}
	return true;
}

function isProposalChangeGroupKind(value: unknown): value is ProposalChangeGroupKind {
	return proposalChangeGroupKinds.some(kind => kind === value);
}

function isMetadataField(
	value: unknown,
): value is Extract<CanonicalSemanticTargetRef, { readonly kind: 'metadata' }>['field'] {
	return value === 'title'
		|| value === 'authors'
		|| value === 'abstract'
		|| value === 'keywords';
}

function isPositionAffinity(value: unknown): value is 'before' | 'after' {
	return value === 'before' || value === 'after';
}

function isNonnegativeSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isClosedRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	try {
		const prototype = Reflect.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

function hasExactDataProperties(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	let keys: readonly PropertyKey[];
	try {
		keys = Reflect.ownKeys(value);
	} catch {
		return false;
	}
	try {
		return keys.length === expected.length
			&& !keys.some(key => typeof key !== 'string' || !expected.includes(key))
			&& expected.every(key => {
				const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
				return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
			});
	} catch {
		return false;
	}
}

function readDataProperty(
	value: Readonly<Record<string, unknown>>,
	key: string,
): unknown {
	try {
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && 'value' in descriptor
			? descriptor.value
			: undefined;
	} catch {
		return undefined;
	}
}

function compareCanonicalKeys(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function identityError(
	reason: ProposalChangeGroupIdentityFailure,
	path: string,
): Extract<ProposalChangeGroupIdentityResult, { readonly type: 'error' }> {
	return {
		type: 'error',
		reason,
		path,
	};
}
