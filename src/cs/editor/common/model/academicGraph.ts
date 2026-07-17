/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import {
	captureBoundedClosedJson,
	type IBoundedClosedJsonLimits,
} from 'cs/editor/common/core/boundedClosedJson';
import {
	isWellFormedUnicodeString,
	serializeCanonicalJson,
	type CanonicalJsonValue,
} from 'cs/editor/common/core/canonicalJson';
import { isCanonicalUtcTimestamp } from 'cs/editor/common/core/canonicalTimestamp';
import {
	cloneCanonicalRuntimeUri,
	decodeCanonicalUri,
	encodeCanonicalUri,
} from 'cs/editor/common/core/canonicalUri';
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
	parseManuscriptResource,
	validateManuscriptResource,
} from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type SemanticPosition,
} from 'cs/editor/common/core/semanticPosition';
import {
	createTrustedActorRef,
	type ActorRef,
} from 'cs/editor/common/model/actor';

export type AcademicEntityKind = 'claim' | 'evidence-link' | 'reference-snapshot';

export interface PersistentAnchor {
	readonly document: {
		readonly resource: URI;
		readonly revisionId: RevisionId;
	};
	readonly primary: SemanticPosition;
	readonly targetNodeId?: NodeId;
	readonly textQuote?: {
		readonly exact: string;
		readonly prefix?: string;
		readonly suffix?: string;
	};
	readonly pathHint?: readonly NodeId[];
}

export interface ReferenceSnapshot {
	readonly id: EntityId;
	readonly type: 'reference-snapshot';
	readonly externalUri?: URI;
	readonly cslJson: Readonly<Record<string, CanonicalJsonValue>>;
	readonly capturedAt: string;
	readonly sourceProvider?: string;
}

export type EvidenceLocator =
	| {
		readonly kind: 'page';
		readonly page: number;
		readonly pageLabel?: string;
	}
	| {
		readonly kind: 'section';
		readonly section: string;
	}
	| {
		readonly kind: 'text-quote';
		readonly exact: string;
		readonly prefix?: string;
		readonly suffix?: string;
	}
	| {
		readonly kind: 'time';
		readonly startSeconds: number;
		readonly endSeconds?: number;
	}
	| {
		readonly kind: 'record';
		readonly recordKey: string;
	};

export interface EvidenceLink {
	readonly id: EntityId;
	readonly type: 'evidence-link';
	readonly sourceUri: URI;
	readonly sourceContentHash: ContentHash;
	readonly locator: EvidenceLocator;
	readonly excerpt?: string;
	readonly verificationStatus:
		| 'verified'
		| 'provisional'
		| 'metadata-only'
		| 'stale'
		| 'rejected';
	readonly verifiedBy?: ActorRef;
	readonly verifiedAt?: string;
}

export interface ClaimEntity {
	readonly id: EntityId;
	readonly type: 'claim';
	readonly anchor: PersistentAnchor;
	readonly textSnapshot: string;
}

export interface ClaimEvidenceRelation {
	readonly type: 'claim-evidence-relation';
	readonly claimId: EntityId;
	readonly evidenceId: EntityId;
	readonly relation:
		| 'supports'
		| 'partially-supports'
		| 'contradicts'
		| 'context-only'
		| 'unclear';
	readonly assessedBy: ActorRef;
	readonly confidence?: number;
}

export type AcademicEntity = ReferenceSnapshot | EvidenceLink | ClaimEntity;

export interface AcademicGraphSnapshot {
	readonly referenceSnapshots: readonly ReferenceSnapshot[];
	readonly evidenceLinks: readonly EvidenceLink[];
	readonly claims: readonly ClaimEntity[];
	readonly claimEvidenceRelations: readonly ClaimEvidenceRelation[];
}

export interface IAcademicGraphBinding {
	readonly resource: URI;
}

export type AcademicGraphValidationFailure =
	| 'invalid-binding'
	| 'inspection-failed'
	| 'resource-limit-exceeded'
	| 'invalid-graph-shape'
	| 'invalid-reference-snapshot'
	| 'invalid-evidence-link'
	| 'invalid-claim'
	| 'invalid-relation'
	| 'collection-not-strictly-sorted'
	| 'duplicate-entity-id'
	| 'anchor-resource-mismatch'
	| 'relation-not-strictly-sorted'
	| 'dangling-relation';

export type AcademicGraphValidationResult =
	| {
		readonly type: 'valid';
	}
	| {
		readonly type: 'invalid';
		readonly reason: AcademicGraphValidationFailure;
		readonly path: string;
	};

export type TrustedAcademicGraphResult =
	| {
		readonly type: 'valid';
		readonly value: AcademicGraphSnapshot;
	}
	| Extract<AcademicGraphValidationResult, { readonly type: 'invalid' }>;

export type PersistedAcademicEntityV1 = Readonly<
	Record<string, CanonicalJsonValue>
>;
export type PersistedClaimEvidenceRelationV1 = Readonly<
	Record<string, CanonicalJsonValue>
>;

export const academicGraphWireJsonLimits: IBoundedClosedJsonLimits = Object.freeze({
	maximumDepth: 256,
	maximumValues: 262_144,
	maximumArrayLength: 131_072,
	maximumObjectProperties: 4_096,
	maximumCanonicalUtf8Bytes: 16 * 1024 * 1024,
});

type ClosedRecord = Readonly<Record<string, unknown>>;

const invalidCapturedValue = Symbol('invalidCapturedAcademicGraphValue');
const resourceLimitCapturedValue = Symbol('academicGraphResourceLimit');
const maximumCapturedGraphDepth = 256;
const maximumCapturedGraphValues = 1_000_000;
const maximumCapturedCollectionLength = 100_000;
const maximumCapturedGraphUtf8Bytes = 16 * 1024 * 1024;
type CapturedAcademicGraphFailure =
	| typeof invalidCapturedValue
	| typeof resourceLimitCapturedValue;
interface ICapturedAcademicGraphBudget {
	remainingValues: number;
	remainingUtf8Bytes: number;
}
const graphKeys = [
	'referenceSnapshots',
	'evidenceLinks',
	'claims',
	'claimEvidenceRelations',
] as const;
const referenceKeys = [
	'id',
	'type',
	'externalUri',
	'cslJson',
	'capturedAt',
	'sourceProvider',
] as const;
const evidenceKeys = [
	'id',
	'type',
	'sourceUri',
	'sourceContentHash',
	'locator',
	'excerpt',
	'verificationStatus',
	'verifiedBy',
	'verifiedAt',
] as const;
const claimKeys = ['id', 'type', 'anchor', 'textSnapshot'] as const;
const relationKeys = [
	'type',
	'claimId',
	'evidenceId',
	'relation',
	'assessedBy',
	'confidence',
] as const;
const verificationStatuses = new Set<EvidenceLink['verificationStatus']>([
	'verified',
	'provisional',
	'metadata-only',
	'stale',
	'rejected',
]);
const claimEvidenceRelations = new Set<ClaimEvidenceRelation['relation']>([
	'supports',
	'partially-supports',
	'contradicts',
	'context-only',
	'unclear',
]);

export function validateAcademicGraphSnapshot(
	value: unknown,
	binding: IAcademicGraphBinding,
): AcademicGraphValidationResult {
	let capturedBinding: IAcademicGraphBinding | undefined;
	try {
		capturedBinding = captureAcademicGraphBinding(binding);
	} catch {
		return invalidGraph('inspection-failed', '$binding');
	}
	if (capturedBinding === undefined) {
		return invalidGraph('invalid-binding', '$binding');
	}
	try {
		return validateAcademicGraphSnapshotUnchecked(value, capturedBinding);
	} catch {
		return invalidGraph('inspection-failed', '$');
	}
}

export function createTrustedAcademicGraphSnapshot(
	value: unknown,
	binding: IAcademicGraphBinding,
): TrustedAcademicGraphResult {
	let captured: unknown;
	try {
		captured = captureRuntimeGraphValue(
			value,
			new Set<object>(),
			0,
			{
				remainingValues: maximumCapturedGraphValues,
				remainingUtf8Bytes: maximumCapturedGraphUtf8Bytes,
			},
		);
	} catch {
		return invalidGraph('inspection-failed', '$');
	}
	if (captured === invalidCapturedValue) {
		return invalidGraph('inspection-failed', '$');
	}
	if (captured === resourceLimitCapturedValue) {
		return invalidGraph('resource-limit-exceeded', '$');
	}

	const validation = validateAcademicGraphSnapshot(captured, binding);
	if (validation.type === 'invalid') {
		return validation;
	}

	try {
		return {
			type: 'valid',
			value: cloneAcademicGraph(captured as AcademicGraphSnapshot),
		};
	} catch {
		return invalidGraph('inspection-failed', '$');
	}
}

export function encodeAcademicEntityV1(
	value: unknown,
	expectedResource: URI,
): PersistedAcademicEntityV1 | undefined {
	const resourceResult = validateManuscriptResource(expectedResource);
	if (resourceResult.type === 'invalid') {
		return undefined;
	}
	const captured = captureAcademicRuntimeValue(value);
	const record = (
		captured === invalidCapturedValue
		|| captured === resourceLimitCapturedValue
	)
		? undefined
		: readOpenRecord(captured);
	if (record === undefined) {
		return undefined;
	}
	const trusted = trustSingleAcademicEntity(
		captured,
		record['type'],
		resourceResult.resource,
	);
	if (trusted === undefined) {
		return undefined;
	}

	let encoded: PersistedAcademicEntityV1 | undefined;
	switch (trusted.type) {
		case 'reference-snapshot': {
			const externalUri = trusted.externalUri === undefined
				? undefined
				: encodeCanonicalUri(trusted.externalUri);
			const cslJson = encodeClosedJsonRecord(trusted.cslJson);
			if (
				cslJson === undefined
				|| (trusted.externalUri !== undefined && externalUri === undefined)
			) {
				return undefined;
			}
			encoded = {
				id: trusted.id,
				type: trusted.type,
				...(externalUri === undefined ? {} : { externalUri }),
				cslJson,
				capturedAt: trusted.capturedAt,
				...(trusted.sourceProvider === undefined
					? {}
					: { sourceProvider: trusted.sourceProvider }),
			};
			break;
		}
		case 'evidence-link': {
			const sourceUri = encodeCanonicalUri(trusted.sourceUri);
			const locator = encodeClosedJsonRecord(trusted.locator);
			const verifiedBy = trusted.verifiedBy === undefined
				? undefined
				: encodeClosedJsonRecord(trusted.verifiedBy);
			if (
				sourceUri === undefined
				|| locator === undefined
				|| (trusted.verifiedBy !== undefined && verifiedBy === undefined)
			) {
				return undefined;
			}
			encoded = {
				id: trusted.id,
				type: trusted.type,
				sourceUri,
				sourceContentHash: trusted.sourceContentHash,
				locator,
				...(trusted.excerpt === undefined ? {} : { excerpt: trusted.excerpt }),
				verificationStatus: trusted.verificationStatus,
				...(verifiedBy === undefined ? {} : { verifiedBy }),
				...(trusted.verifiedAt === undefined
					? {}
					: { verifiedAt: trusted.verifiedAt }),
			};
			break;
		}
		case 'claim': {
			const anchor = encodePersistentAnchorV1(trusted.anchor);
			if (anchor === undefined) {
				return undefined;
			}
			encoded = {
				id: trusted.id,
				type: trusted.type,
				anchor,
				textSnapshot: trusted.textSnapshot,
			};
			break;
		}
	}
	return freezeCanonicalJson(encoded) as PersistedAcademicEntityV1;
}

export function decodeAcademicEntityV1(
	value: unknown,
	expectedResource: URI,
): AcademicEntity | undefined {
	const resourceResult = validateManuscriptResource(expectedResource);
	if (resourceResult.type === 'invalid') {
		return undefined;
	}
	const captured = captureBoundedClosedJson(value, academicGraphWireJsonLimits);
	if (captured.type === 'invalid') {
		return undefined;
	}
	const record = readOpenRecord(captured.value);
	if (record === undefined) {
		return undefined;
	}

	let candidate: unknown;
	switch (record['type']) {
		case 'reference-snapshot': {
			const externalUri = Object.hasOwn(record, 'externalUri')
				? decodeCanonicalUri(record['externalUri'])
				: undefined;
			if (Object.hasOwn(record, 'externalUri') && externalUri === undefined) {
				return undefined;
			}
			candidate = {
				...record,
				...(externalUri === undefined ? {} : { externalUri }),
			};
			break;
		}
		case 'evidence-link': {
			const sourceUri = decodeCanonicalUri(record['sourceUri']);
			if (sourceUri === undefined) {
				return undefined;
			}
			candidate = {
				...record,
				sourceUri,
			};
			break;
		}
		case 'claim': {
			const anchor = decodePersistentAnchorV1(record['anchor']);
			if (anchor === undefined) {
				return undefined;
			}
			candidate = {
				...record,
				anchor,
			};
			break;
		}
		default:
			return undefined;
	}
	return trustSingleAcademicEntity(
		candidate,
		record['type'],
		resourceResult.resource,
	);
}

export function encodeClaimEvidenceRelationV1(
	value: unknown,
): PersistedClaimEvidenceRelationV1 | undefined {
	const captured = captureAcademicRuntimeValue(value);
	if (
		captured === invalidCapturedValue
		|| captured === resourceLimitCapturedValue
	) {
		return undefined;
	}
	const relation = readClosedRecord(captured, relationKeys, [
		'type',
		'claimId',
		'evidenceId',
		'relation',
		'assessedBy',
	]);
	if (relation === undefined || !isValidRelation(relation)) {
		return undefined;
	}
	const canonical = encodeClosedJsonRecord(cloneRelation(
		relation as unknown as ClaimEvidenceRelation,
	));
	return canonical === undefined
		? undefined
		: freezeCanonicalJson(canonical) as PersistedClaimEvidenceRelationV1;
}

export function decodeClaimEvidenceRelationV1(
	value: unknown,
): ClaimEvidenceRelation | undefined {
	const captured = captureBoundedClosedJson(value, academicGraphWireJsonLimits);
	if (captured.type === 'invalid') {
		return undefined;
	}
	const relation = readClosedRecord(captured.value, relationKeys, [
		'type',
		'claimId',
		'evidenceId',
		'relation',
		'assessedBy',
	]);
	return relation !== undefined && isValidRelation(relation)
		? cloneRelation(relation as unknown as ClaimEvidenceRelation)
		: undefined;
}

function captureAcademicRuntimeValue(
	value: unknown,
): unknown | CapturedAcademicGraphFailure {
	try {
		return captureRuntimeGraphValue(
			value,
			new Set<object>(),
			0,
			{
				remainingValues: maximumCapturedGraphValues,
				remainingUtf8Bytes: maximumCapturedGraphUtf8Bytes,
			},
		);
	} catch {
		return invalidCapturedValue;
	}
}

function trustSingleAcademicEntity(
	value: unknown,
	type: unknown,
	expectedResource: URI,
): AcademicEntity | undefined {
	const graph = {
		referenceSnapshots: type === 'reference-snapshot' ? [value] : [],
		evidenceLinks: type === 'evidence-link' ? [value] : [],
		claims: type === 'claim' ? [value] : [],
		claimEvidenceRelations: [],
	};
	const trusted = createTrustedAcademicGraphSnapshot(graph, {
		resource: expectedResource,
	});
	if (trusted.type === 'invalid') {
		return undefined;
	}
	switch (type) {
		case 'reference-snapshot':
			return trusted.value.referenceSnapshots[0];
		case 'evidence-link':
			return trusted.value.evidenceLinks[0];
		case 'claim':
			return trusted.value.claims[0];
		default:
			return undefined;
	}
}

function encodePersistentAnchorV1(
	anchor: PersistentAnchor,
): Readonly<Record<string, CanonicalJsonValue>> | undefined {
	const resource = validateManuscriptResource(anchor.document.resource);
	const primary = encodeClosedJsonRecord(anchor.primary);
	const textQuote = anchor.textQuote === undefined
		? undefined
		: encodeClosedJsonRecord(anchor.textQuote);
	const pathHint = anchor.pathHint === undefined
		? undefined
		: encodeClosedJsonArray(anchor.pathHint);
	if (
		resource.type === 'invalid'
		|| primary === undefined
		|| (anchor.textQuote !== undefined && textQuote === undefined)
		|| (anchor.pathHint !== undefined && pathHint === undefined)
	) {
		return undefined;
	}
	return {
		document: {
			resource: resource.canonical,
			revisionId: anchor.document.revisionId,
		},
		primary,
		...(anchor.targetNodeId === undefined
			? {}
			: { targetNodeId: anchor.targetNodeId }),
		...(textQuote === undefined ? {} : { textQuote }),
		...(pathHint === undefined ? {} : { pathHint }),
	};
}

function decodePersistentAnchorV1(value: unknown): PersistentAnchor | undefined {
	const anchor = readOpenRecord(value);
	const document = anchor === undefined
		? undefined
		: readOpenRecord(anchor['document']);
	if (
		anchor === undefined
		|| document === undefined
		|| typeof document['resource'] !== 'string'
	) {
		return undefined;
	}
	const resource = parseManuscriptResource(document['resource']);
	if (resource.type === 'invalid') {
		return undefined;
	}
	return {
		...anchor,
		document: {
			...document,
			resource: resource.resource,
		},
	} as unknown as PersistentAnchor;
}

function encodeClosedJsonRecord(
	value: unknown,
): Readonly<Record<string, CanonicalJsonValue>> | undefined {
	const captured = captureBoundedClosedJson(value, academicGraphWireJsonLimits);
	return (
		captured.type === 'valid'
		&& captured.value !== null
		&& typeof captured.value === 'object'
		&& !Array.isArray(captured.value)
		)
			? captured.value as Readonly<Record<string, CanonicalJsonValue>>
			: undefined;
}

function encodeClosedJsonArray(
	value: unknown,
): readonly CanonicalJsonValue[] | undefined {
	const captured = captureBoundedClosedJson(value, academicGraphWireJsonLimits);
	return captured.type === 'valid' && Array.isArray(captured.value)
		? captured.value
		: undefined;
}

function validateAcademicGraphSnapshotUnchecked(
	value: unknown,
	binding: IAcademicGraphBinding,
): AcademicGraphValidationResult {
	const graph = readClosedRecord(value, graphKeys, graphKeys);
	if (graph === undefined) {
		return invalidGraph('invalid-graph-shape', '$');
	}

	const references = readDenseArray(graph['referenceSnapshots']);
	const evidenceLinks = readDenseArray(graph['evidenceLinks']);
	const claims = readDenseArray(graph['claims']);
	const relations = readDenseArray(graph['claimEvidenceRelations']);
	if (
		references === undefined
		|| evidenceLinks === undefined
		|| claims === undefined
		|| relations === undefined
	) {
		return invalidGraph('invalid-graph-shape', '$');
	}

	const entityIds = new Set<string>();
	const referenceResult = validateReferenceSnapshots(references, entityIds);
	if (referenceResult.type === 'invalid') {
		return referenceResult;
	}

	const evidenceIds = new Set<string>();
	const evidenceResult = validateEvidenceLinks(evidenceLinks, evidenceIds, entityIds);
	if (evidenceResult.type === 'invalid') {
		return evidenceResult;
	}

	const claimIds = new Set<string>();
	const claimsResult = validateClaims(claims, claimIds, entityIds, binding);
	if (claimsResult.type === 'invalid') {
		return claimsResult;
	}

	return validateRelations(relations, claimIds, evidenceIds);
}

function captureAcademicGraphBinding(
	value: unknown,
): IAcademicGraphBinding | undefined {
	const binding = readOpenRecord(value);
	if (
		binding === undefined
		|| !hasExactKeys(binding, ['resource'], ['resource'])
	) {
		return undefined;
	}
	const resource = binding['resource'] instanceof URI
		? validateManuscriptResource(binding['resource'])
		: undefined;
	return resource?.type === 'valid'
		? Object.freeze({
			resource: resource.resource,
		})
		: undefined;
}

function validateReferenceSnapshots(
	values: readonly unknown[],
	entityIds: Set<string>,
): AcademicGraphValidationResult {
	let previousId: string | undefined;
	for (let index = 0; index < values.length; index += 1) {
		const path = `$.referenceSnapshots[${index}]`;
		const reference = readClosedRecord(values[index], referenceKeys, [
			'id',
			'type',
			'cslJson',
			'capturedAt',
		]);
		if (reference === undefined || !isValidReferenceSnapshot(reference)) {
			return invalidGraph('invalid-reference-snapshot', path);
		}
		const id = reference['id'] as string;
		const order = validateNextEntityId(id, previousId, entityIds, `${path}.id`);
		if (order.type === 'invalid') {
			return order;
		}
		previousId = id;
	}
	return validGraph();
}

function isValidReferenceSnapshot(value: ClosedRecord): boolean {
	const externalUri = value['externalUri'];
	const cslJson = value['cslJson'];
	return (
		isEntityId(value['id'])
		&& value['type'] === 'reference-snapshot'
		&& (
			!Object.hasOwn(value, 'externalUri')
			|| isRuntimeUri(externalUri)
		)
		&& isCanonicalJsonObject(cslJson)
		&& isCanonicalUtcTimestamp(value['capturedAt'])
		&& (
			!Object.hasOwn(value, 'sourceProvider')
			|| isBoundedString(value['sourceProvider'], 1, 256)
		)
	);
}

function validateEvidenceLinks(
	values: readonly unknown[],
	evidenceIds: Set<string>,
	entityIds: Set<string>,
): AcademicGraphValidationResult {
	let previousId: string | undefined;
	for (let index = 0; index < values.length; index += 1) {
		const path = `$.evidenceLinks[${index}]`;
		const evidence = readClosedRecord(values[index], evidenceKeys, [
			'id',
			'type',
			'sourceUri',
			'sourceContentHash',
			'locator',
			'verificationStatus',
		]);
		if (evidence === undefined || !isValidEvidenceLink(evidence)) {
			return invalidGraph('invalid-evidence-link', path);
		}
		const id = evidence['id'] as string;
		const order = validateNextEntityId(id, previousId, entityIds, `${path}.id`);
		if (order.type === 'invalid') {
			return order;
		}
		previousId = id;
		evidenceIds.add(id);
	}
	return validGraph();
}

function isValidEvidenceLink(value: ClosedRecord): boolean {
	return (
		isEntityId(value['id'])
		&& value['type'] === 'evidence-link'
		&& isRuntimeUri(value['sourceUri'])
		&& isContentHash(value['sourceContentHash'])
		&& isEvidenceLocator(value['locator'])
		&& (
			!Object.hasOwn(value, 'excerpt')
			|| isBoundedString(value['excerpt'], 0, 1_000_000)
		)
		&& verificationStatuses.has(value['verificationStatus'] as EvidenceLink['verificationStatus'])
		&& (
			!Object.hasOwn(value, 'verifiedBy')
			|| isActorRef(value['verifiedBy'])
		)
		&& (
			!Object.hasOwn(value, 'verifiedAt')
			|| isCanonicalUtcTimestamp(value['verifiedAt'])
		)
	);
}

function validateClaims(
	values: readonly unknown[],
	claimIds: Set<string>,
	entityIds: Set<string>,
	binding: IAcademicGraphBinding,
): AcademicGraphValidationResult {
	let previousId: string | undefined;
	for (let index = 0; index < values.length; index += 1) {
		const path = `$.claims[${index}]`;
		const claim = readClosedRecord(values[index], claimKeys, claimKeys);
		if (
			claim === undefined
			|| !isEntityId(claim['id'])
			|| claim['type'] !== 'claim'
		) {
			return invalidGraph('invalid-claim', path);
		}
		const anchorResult = validatePersistentAnchor(claim['anchor'], binding, `${path}.anchor`);
		if (anchorResult.type === 'invalid') {
			return anchorResult;
		}
		if (!isBoundedString(claim['textSnapshot'], 0, 1_000_000)) {
			return invalidGraph('invalid-claim', path);
		}

		const id = claim['id'] as string;
		const order = validateNextEntityId(id, previousId, entityIds, `${path}.id`);
		if (order.type === 'invalid') {
			return order;
		}
		previousId = id;
		claimIds.add(id);
	}
	return validGraph();
}

function validatePersistentAnchor(
	value: unknown,
	binding: IAcademicGraphBinding,
	path: string,
): AcademicGraphValidationResult {
	const anchor = readClosedRecord(
		value,
		['document', 'primary', 'targetNodeId', 'textQuote', 'pathHint'],
		['document', 'primary'],
	);
	const document = anchor === undefined
		? undefined
		: readClosedRecord(
			anchor['document'],
			['resource', 'revisionId'],
			['resource', 'revisionId'],
		);
	const anchorResource = document?.['resource'] instanceof URI
		? validateManuscriptResource(document['resource'])
		: undefined;
	if (
		anchor === undefined
		|| document === undefined
		|| anchorResource === undefined
		|| anchorResource.type === 'invalid'
		|| typeof document['revisionId'] !== 'string'
		|| parseRevisionId(document['revisionId']).type === 'invalid'
		|| !isSemanticPosition(anchor['primary'])
		|| (
			Object.hasOwn(anchor, 'targetNodeId')
			&& !isNodeId(anchor['targetNodeId'])
		)
		|| (
			Object.hasOwn(anchor, 'textQuote')
			&& !isTextQuote(anchor['textQuote'])
		)
		|| (
			Object.hasOwn(anchor, 'pathHint')
			&& !isNodeIdPath(anchor['pathHint'])
		)
	) {
		return invalidGraph('invalid-claim', path);
	}

	if (!isEqual(anchorResource.resource, binding.resource)) {
		return invalidGraph('anchor-resource-mismatch', `${path}.document.resource`);
	}
	return validGraph();
}

function validateNextEntityId(
	id: string,
	previousId: string | undefined,
	entityIds: Set<string>,
	path: string,
): AcademicGraphValidationResult {
	if (previousId !== undefined && compareStrings(previousId, id) >= 0) {
		return invalidGraph('collection-not-strictly-sorted', path);
	}
	if (entityIds.has(id)) {
		return invalidGraph('duplicate-entity-id', path);
	}
	entityIds.add(id);
	return validGraph();
}

function validateRelations(
	values: readonly unknown[],
	claimIds: ReadonlySet<string>,
	evidenceIds: ReadonlySet<string>,
): AcademicGraphValidationResult {
	let previousKey: string | undefined;
	for (let index = 0; index < values.length; index += 1) {
		const path = `$.claimEvidenceRelations[${index}]`;
		const relation = readClosedRecord(values[index], relationKeys, [
			'type',
			'claimId',
			'evidenceId',
			'relation',
			'assessedBy',
		]);
		if (relation === undefined || !isValidRelation(relation)) {
			return invalidGraph('invalid-relation', path);
		}
		const claimId = relation['claimId'] as string;
		const evidenceId = relation['evidenceId'] as string;
		const key = `${claimId}\0${evidenceId}`;
		if (previousKey !== undefined && compareStrings(previousKey, key) >= 0) {
			return invalidGraph('relation-not-strictly-sorted', path);
		}
		if (!claimIds.has(claimId) || !evidenceIds.has(evidenceId)) {
			return invalidGraph('dangling-relation', path);
		}
		previousKey = key;
	}
	return validGraph();
}

function isValidRelation(value: ClosedRecord): boolean {
	return (
		value['type'] === 'claim-evidence-relation'
		&& isEntityId(value['claimId'])
		&& isEntityId(value['evidenceId'])
		&& claimEvidenceRelations.has(value['relation'] as ClaimEvidenceRelation['relation'])
		&& isActorRef(value['assessedBy'])
		&& (
			!Object.hasOwn(value, 'confidence')
			|| (
				typeof value['confidence'] === 'number'
				&& Number.isFinite(value['confidence'])
				&& value['confidence'] >= 0
				&& value['confidence'] <= 1
			)
		)
	);
}

function isEvidenceLocator(value: unknown): value is EvidenceLocator {
	const locator = readOpenRecord(value);
	if (locator === undefined) {
		return false;
	}
	switch (locator['kind']) {
		case 'page':
			return (
				hasExactKeys(locator, ['kind', 'page', 'pageLabel'], ['kind', 'page'])
				&& Number.isSafeInteger(locator['page'])
				&& (locator['page'] as number) >= 1
				&& (
					!Object.hasOwn(locator, 'pageLabel')
					|| isBoundedString(locator['pageLabel'], 1, 128)
				)
			);
		case 'section':
			return (
				hasExactKeys(locator, ['kind', 'section'], ['kind', 'section'])
				&& isBoundedString(locator['section'], 1, 4_096)
			);
		case 'text-quote':
			return (
				hasExactKeys(
					locator,
					['kind', 'exact', 'prefix', 'suffix'],
					['kind', 'exact'],
				)
				&& isBoundedString(locator['exact'], 1, 1_000_000)
				&& (
					!Object.hasOwn(locator, 'prefix')
					|| isBoundedString(locator['prefix'], 0, 4_096)
				)
				&& (
					!Object.hasOwn(locator, 'suffix')
					|| isBoundedString(locator['suffix'], 0, 4_096)
				)
			);
		case 'time': {
			if (!hasExactKeys(
				locator,
				['kind', 'startSeconds', 'endSeconds'],
				['kind', 'startSeconds'],
			)) {
				return false;
			}
			const start = locator['startSeconds'];
			const end = locator['endSeconds'];
			return (
				typeof start === 'number'
				&& Number.isFinite(start)
				&& start >= 0
				&& (
					!Object.hasOwn(locator, 'endSeconds')
					|| (
						typeof end === 'number'
						&& Number.isFinite(end)
						&& end >= start
					)
				)
			);
		}
		case 'record':
			return (
				hasExactKeys(locator, ['kind', 'recordKey'], ['kind', 'recordKey'])
				&& isBoundedString(locator['recordKey'], 1, 4_096)
			);
		default:
			return false;
	}
}

function isSemanticPosition(value: unknown): value is SemanticPosition {
	const position = readOpenRecord(value);
	if (position === undefined) {
		return false;
	}
	if (position['kind'] === 'text') {
		return (
			hasExactKeys(
				position,
				['kind', 'textNodeId', 'utf16Offset', 'affinity'],
				['kind', 'textNodeId', 'utf16Offset', 'affinity'],
			)
			&& isNodeId(position['textNodeId'])
			&& typeof position['utf16Offset'] === 'number'
			&& parseUtf16Offset(position['utf16Offset']).type === 'valid'
			&& isAffinity(position['affinity'])
		);
	}
	return (
		position['kind'] === 'node-boundary'
		&& hasExactKeys(
			position,
			['kind', 'parentNodeId', 'childIndex', 'affinity'],
			['kind', 'parentNodeId', 'childIndex', 'affinity'],
		)
		&& isNodeId(position['parentNodeId'])
		&& Number.isSafeInteger(position['childIndex'])
		&& (position['childIndex'] as number) >= 0
		&& isAffinity(position['affinity'])
	);
}

function isTextQuote(value: unknown): boolean {
	const quote = readClosedRecord(
		value,
		['exact', 'prefix', 'suffix'],
		['exact'],
	);
	return (
		quote !== undefined
		&& isBoundedString(quote['exact'], 1, 1_000_000)
		&& (
			!Object.hasOwn(quote, 'prefix')
			|| isBoundedString(quote['prefix'], 0, 4_096)
		)
		&& (
			!Object.hasOwn(quote, 'suffix')
			|| isBoundedString(quote['suffix'], 0, 4_096)
		)
	);
}

function isNodeIdPath(value: unknown): boolean {
	const path = readDenseArray(value);
	if (path === undefined || path.length === 0) {
		return false;
	}
	const seen = new Set<string>();
	for (const nodeId of path) {
		if (!isNodeId(nodeId) || seen.has(nodeId)) {
			return false;
		}
		seen.add(nodeId);
	}
	return true;
}

function isActorRef(value: unknown): value is ActorRef {
	return createTrustedActorRef(value) !== undefined;
}

function isCanonicalJsonObject(value: unknown): value is Readonly<Record<string, CanonicalJsonValue>> {
	return (
		value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& serializeCanonicalJson(value).type === 'ok'
	);
}

function isRuntimeUri(value: unknown): value is URI {
	return cloneCanonicalRuntimeUri(value) !== undefined;
}

function isEntityId(value: unknown): value is EntityId {
	return typeof value === 'string' && parseEntityId(value).type === 'valid';
}

function isNodeId(value: unknown): value is NodeId {
	return typeof value === 'string' && parseNodeId(value).type === 'valid';
}

function isContentHash(value: unknown): value is ContentHash {
	return typeof value === 'string' && parseContentHash(value).type === 'valid';
}

function isAffinity(value: unknown): value is SemanticPosition['affinity'] {
	return value === 'before' || value === 'after';
}

function isBoundedString(
	value: unknown,
	minimumLength: number,
	maximumLength: number,
): value is string {
	return (
		typeof value === 'string'
		&& value.length >= minimumLength
		&& value.length <= maximumLength
		&& isWellFormedUnicodeString(value)
	);
}

function readClosedRecord(
	value: unknown,
	allowedKeys: readonly string[],
	requiredKeys: readonly string[],
): ClosedRecord | undefined {
	const record = readOpenRecord(value);
	return (
		record !== undefined
		&& hasExactKeys(record, allowedKeys, requiredKeys)
	)
		? record
		: undefined;
}

function readOpenRecord(value: unknown): ClosedRecord | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return undefined;
	}

	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			return undefined;
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			return undefined;
		}
		result[key] = descriptor.value;
	}
	return result;
}

function hasExactKeys(
	record: ClosedRecord,
	allowedKeys: readonly string[],
	requiredKeys: readonly string[],
): boolean {
	const keys = Object.keys(record);
	const allowed = new Set(allowedKeys);
	return (
		keys.every(key => allowed.has(key))
		&& requiredKeys.every(key => Object.hasOwn(record, key))
	);
}

function readDenseArray(value: unknown): readonly unknown[] | undefined {
	if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) {
		return undefined;
	}

	const allowedKeys = new Set<string>(['length']);
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const key = String(index);
		allowedKeys.add(key);
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			return undefined;
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
		return undefined;
	}
	return result;
}

function captureRuntimeGraphValue(
	value: unknown,
	activeObjects: Set<object>,
	depth: number,
	budget: ICapturedAcademicGraphBudget,
): unknown | CapturedAcademicGraphFailure {
	budget.remainingValues -= 1;
	if (budget.remainingValues < 0) {
		return resourceLimitCapturedValue;
	}
	if (depth > maximumCapturedGraphDepth) {
		return resourceLimitCapturedValue;
	}
	if (value === null || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		return consumeCapturedGraphString(value, budget);
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : invalidCapturedValue;
	}
	if (typeof value !== 'object') {
		return invalidCapturedValue;
	}
	if (activeObjects.has(value)) {
		return invalidCapturedValue;
	}
	if (value instanceof URI) {
		const captured = cloneCanonicalRuntimeUri(value);
		if (captured === undefined) {
			return invalidCapturedValue;
		}
		for (const component of [
			captured.scheme,
			captured.authority,
			captured.path,
			captured.query,
			captured.fragment,
		]) {
			const consumed = consumeCapturedGraphString(component, budget);
			if (consumed !== component) {
				return consumed;
			}
		}
		return captured;
	}

	const prototype = Reflect.getPrototypeOf(value);
	if (
		prototype !== Object.prototype
		&& prototype !== null
		&& prototype !== Array.prototype
	) {
		return invalidCapturedValue;
	}

	activeObjects.add(value);
	const captured = Array.isArray(value)
		? captureRuntimeArray(value, activeObjects, depth, budget)
		: captureRuntimeRecord(value, activeObjects, depth, budget);
	activeObjects.delete(value);
	return captured;
}

function captureRuntimeArray(
	value: readonly unknown[],
	activeObjects: Set<object>,
	depth: number,
	budget: ICapturedAcademicGraphBudget,
): readonly unknown[] | CapturedAcademicGraphFailure {
	const initialLengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
	if (
		initialLengthDescriptor === undefined
		|| !('value' in initialLengthDescriptor)
		|| typeof initialLengthDescriptor.value !== 'number'
		|| !Number.isSafeInteger(initialLengthDescriptor.value)
		|| initialLengthDescriptor.value < 0
	) {
		return invalidCapturedValue;
	}
	if (initialLengthDescriptor.value > maximumCapturedCollectionLength) {
		return resourceLimitCapturedValue;
	}
	const initialLength = initialLengthDescriptor.value;
	const keys = Reflect.ownKeys(value);
	if (keys.length > maximumCapturedCollectionLength + 1) {
		return resourceLimitCapturedValue;
	}
	const descriptors = new Map<PropertyKey, PropertyDescriptor>();
	for (const key of keys) {
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) {
			return invalidCapturedValue;
		}
		descriptors.set(key, descriptor);
	}

	const lengthDescriptor = descriptors.get('length');
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| lengthDescriptor.value !== initialLength
	) {
		return invalidCapturedValue;
	}
	const length = lengthDescriptor.value as number;
	const allowedKeys = new Set<PropertyKey>(['length']);
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const key = String(index);
		allowedKeys.add(key);
		const descriptor = descriptors.get(key);
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			return invalidCapturedValue;
		}
		const captured = captureRuntimeGraphValue(
			descriptor.value,
			activeObjects,
			depth + 1,
			budget,
		);
		if (
			captured === invalidCapturedValue
			|| captured === resourceLimitCapturedValue
		) {
			return captured;
		}
		result.push(captured);
	}
	if (keys.some(key => !allowedKeys.has(key))) {
		return invalidCapturedValue;
	}
	return result;
}

function captureRuntimeRecord(
	value: object,
	activeObjects: Set<object>,
	depth: number,
	budget: ICapturedAcademicGraphBudget,
): ClosedRecord | CapturedAcademicGraphFailure {
	const keys = Reflect.ownKeys(value);
	if (keys.length > maximumCapturedCollectionLength) {
		return resourceLimitCapturedValue;
	}
	const result: Record<string, unknown> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== 'string') {
			return invalidCapturedValue;
		}
		const capturedKey = consumeCapturedGraphString(key, budget);
		if (
			capturedKey === invalidCapturedValue
			|| capturedKey === resourceLimitCapturedValue
		) {
			return capturedKey;
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			return invalidCapturedValue;
		}
		const captured = captureRuntimeGraphValue(
			descriptor.value,
			activeObjects,
			depth + 1,
			budget,
		);
		if (
			captured === invalidCapturedValue
			|| captured === resourceLimitCapturedValue
		) {
			return captured;
		}
		result[key] = captured;
	}
	return result;
}

function consumeCapturedGraphString(
	value: string,
	budget: ICapturedAcademicGraphBudget,
): string | CapturedAcademicGraphFailure {
	if (value.length > budget.remainingUtf8Bytes) {
		return resourceLimitCapturedValue;
	}
	const bytes = utf8ByteLength(value);
	if (bytes === undefined) {
		return invalidCapturedValue;
	}
	if (bytes > budget.remainingUtf8Bytes) {
		return resourceLimitCapturedValue;
	}
	budget.remainingUtf8Bytes -= bytes;
	return value;
}

function utf8ByteLength(value: string): number | undefined {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit < 0x80) {
			bytes += 1;
		} else if (unit < 0x800) {
			bytes += 2;
		} else if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
				return undefined;
			}
			bytes += 4;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return undefined;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function cloneAcademicGraph(value: AcademicGraphSnapshot): AcademicGraphSnapshot {
	return Object.freeze({
		referenceSnapshots: Object.freeze(value.referenceSnapshots.map(cloneReferenceSnapshot)),
		evidenceLinks: Object.freeze(value.evidenceLinks.map(cloneEvidenceLink)),
		claims: Object.freeze(value.claims.map(cloneClaim)),
		claimEvidenceRelations: Object.freeze(
			value.claimEvidenceRelations.map(cloneRelation),
		),
	});
}

function cloneReferenceSnapshot(value: ReferenceSnapshot): ReferenceSnapshot {
	const canonicalCsl = serializeCanonicalJson(value.cslJson);
	if (canonicalCsl.type === 'error') {
		throw new TypeError('Reference CSL JSON changed after validation.');
	}
	const result: ReferenceSnapshot = {
		id: value.id,
		type: value.type,
		cslJson: freezeCanonicalJson(
			value.cslJson,
		) as Readonly<Record<string, CanonicalJsonValue>>,
		capturedAt: value.capturedAt,
		...(value.externalUri === undefined ? {} : { externalUri: value.externalUri }),
		...(value.sourceProvider === undefined ? {} : { sourceProvider: value.sourceProvider }),
	};
	return Object.freeze(result);
}

function cloneEvidenceLink(value: EvidenceLink): EvidenceLink {
	const result: EvidenceLink = {
		id: value.id,
		type: value.type,
		sourceUri: value.sourceUri,
		sourceContentHash: value.sourceContentHash,
		locator: Object.freeze({ ...value.locator }),
		verificationStatus: value.verificationStatus,
		...(value.excerpt === undefined ? {} : { excerpt: value.excerpt }),
		...(value.verifiedBy === undefined ? {} : { verifiedBy: cloneActor(value.verifiedBy) }),
		...(value.verifiedAt === undefined ? {} : { verifiedAt: value.verifiedAt }),
	};
	return Object.freeze(result);
}

function cloneClaim(value: ClaimEntity): ClaimEntity {
	const anchor: PersistentAnchor = {
		document: Object.freeze({
			resource: value.anchor.document.resource,
			revisionId: value.anchor.document.revisionId,
		}),
		primary: Object.freeze({ ...value.anchor.primary }),
		...(value.anchor.targetNodeId === undefined
			? {}
			: { targetNodeId: value.anchor.targetNodeId }),
		...(value.anchor.textQuote === undefined
			? {}
			: { textQuote: Object.freeze({ ...value.anchor.textQuote }) }),
		...(value.anchor.pathHint === undefined
			? {}
			: { pathHint: Object.freeze([...value.anchor.pathHint]) }),
	};
	return Object.freeze({
		id: value.id,
		type: value.type,
		anchor: Object.freeze(anchor),
		textSnapshot: value.textSnapshot,
	});
}

function cloneRelation(value: ClaimEvidenceRelation): ClaimEvidenceRelation {
	return Object.freeze({
		type: value.type,
		claimId: value.claimId,
		evidenceId: value.evidenceId,
		relation: value.relation,
		assessedBy: cloneActor(value.assessedBy),
		...(value.confidence === undefined ? {} : { confidence: value.confidence }),
	});
}

function cloneActor(value: ActorRef): ActorRef {
	const actor = createTrustedActorRef(value);
	if (actor === undefined) {
		throw new TypeError('Cannot clone an invalid ActorRef.');
	}
	return actor;
}

function freezeCanonicalJson(value: CanonicalJsonValue): CanonicalJsonValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(item => freezeCanonicalJson(item)));
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Canonical JSON record has an unsupported prototype.');
	}
	const result: Record<string, CanonicalJsonValue> = Object.create(
		Object.prototype,
	);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Canonical JSON record has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Canonical JSON record has an unsafe property.');
		}
		Object.defineProperty(result, key, {
			value: freezeCanonicalJson(descriptor.value),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return Object.freeze(result);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function validGraph(): AcademicGraphValidationResult {
	return {
		type: 'valid',
	};
}

function invalidGraph(
	reason: AcademicGraphValidationFailure,
	path: string,
): Extract<AcademicGraphValidationResult, { readonly type: 'invalid' }> {
	return {
		type: 'invalid',
		reason,
		path,
	};
}
