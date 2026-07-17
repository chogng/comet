/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import {
	captureBoundedClosedJson,
	type BoundedClosedJsonLimit,
	type IBoundedClosedJsonLimits,
} from 'cs/editor/common/core/boundedClosedJson';
import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';
import { cloneCanonicalRuntimeUri } from 'cs/editor/common/core/canonicalUri';
import {
	parseContentHash,
	parseRevisionId,
	type ContentHash,
	type EntityId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { validateManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import {
	createTrustedAcademicGraphSnapshot,
	decodeAcademicEntityV1,
	decodeClaimEvidenceRelationV1,
	encodeAcademicEntityV1,
	encodeClaimEvidenceRelationV1,
	type AcademicEntity,
	type AcademicGraphSnapshot,
	type ClaimEvidenceRelation,
	type PersistedAcademicEntityV1,
	type PersistedClaimEvidenceRelationV1,
} from 'cs/editor/common/model/academicGraph';
import {
	createDocumentIndex,
	type DocumentIndex,
} from 'cs/editor/common/model/documentIndex';
import type { ManuscriptMetadata } from 'cs/editor/common/model/manuscript';
import {
	decodeDocumentSemanticSettingsV1,
	decodeManuscriptMetadataV1,
	decodeManuscriptRootV1,
	encodeDocumentSemanticSettingsV1,
	encodeManuscriptMetadataV1,
	encodeManuscriptRootV1,
	type IManuscriptTreeCodecLimits,
	type ManuscriptSchemaFailure,
	type PersistedDocumentNodeV1,
	type PersistedDocumentSemanticSettingsV1,
	type PersistedManuscriptMetadataV1,
} from 'cs/editor/common/model/manuscriptSchema';
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

export interface IDocumentSnapshotCodecLimits extends IBoundedClosedJsonLimits {
	readonly maximumNodes: number;
	readonly maximumNodeDepth: number;
	readonly maximumEntities: number;
	readonly maximumRelations: number;
	readonly maximumCollectionItems: number;
}

export type PersistedAcademicGraphV1 = Readonly<{
	readonly referenceSnapshots: readonly PersistedAcademicEntityV1[];
	readonly evidenceLinks: readonly PersistedAcademicEntityV1[];
	readonly claims: readonly PersistedAcademicEntityV1[];
	readonly claimEvidenceRelations: readonly PersistedClaimEvidenceRelationV1[];
}>;

export type PersistedDocumentSnapshotV1 = Readonly<{
	readonly format: typeof documentFormat;
	readonly formatVersion: typeof documentFormatVersion;
	readonly schemaId: typeof manuscriptSchemaId;
	readonly schemaVersion: typeof manuscriptSchemaVersion;
	readonly revisionId: RevisionId;
	readonly documentHash: ContentHash;
	readonly metadata: PersistedManuscriptMetadataV1;
	readonly root: PersistedDocumentNodeV1;
	readonly academicGraph: PersistedAcademicGraphV1;
	readonly settings: PersistedDocumentSemanticSettingsV1;
}>;

export type DocumentSnapshotCodecFailure =
	| ManuscriptSchemaFailure
	| 'invalid-context'
	| 'invalid-envelope'
	| 'unsupported-format'
	| 'unsupported-format-version'
	| 'unsupported-schema'
	| 'unsupported-schema-version'
	| 'invalid-revision-id'
	| 'invalid-document-hash'
	| 'invalid-academic-graph'
	| 'entity-budget-exceeded'
	| 'relation-budget-exceeded'
	| 'duplicate-entity-id'
	| 'dangling-citation-reference'
	| 'dangling-cross-reference'
	| 'dangling-footnote-reference'
	| 'invalid-document-index'
	| 'invalid-merkle-state'
	| 'document-hash-mismatch'
	| 'resource-limit-exceeded';

export type DocumentSnapshotCodecError =
	| {
		readonly type: 'invalid';
		readonly reason: Exclude<
			DocumentSnapshotCodecFailure,
			'resource-limit-exceeded'
		>;
		readonly path: string;
	}
	| {
		readonly type: 'invalid';
		readonly reason: 'resource-limit-exceeded';
		readonly path: string;
		readonly limit: BoundedClosedJsonLimit;
	};

export interface IDecodedDocumentSnapshotV1 {
	readonly snapshot: DocumentSnapshot;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
}

export type DecodeDocumentSnapshotResult =
	| {
		readonly type: 'valid';
		readonly value: IDecodedDocumentSnapshotV1;
	}
	| DocumentSnapshotCodecError;

export type EncodeDocumentSnapshotResult =
	| {
		readonly type: 'valid';
		readonly value: PersistedDocumentSnapshotV1;
	}
	| DocumentSnapshotCodecError;

type ClosedRecord = Readonly<Record<string, CanonicalJsonValue>>;

const snapshotKeys = Object.freeze([
	'format',
	'formatVersion',
	'schemaId',
	'schemaVersion',
	'revisionId',
	'documentHash',
	'metadata',
	'root',
	'academicGraph',
	'settings',
] as const);
const academicGraphKeys = Object.freeze([
	'referenceSnapshots',
	'evidenceLinks',
	'claims',
	'claimEvidenceRelations',
] as const);
const codecLimitKeys = Object.freeze([
	'maximumDepth',
	'maximumValues',
	'maximumArrayLength',
	'maximumObjectProperties',
	'maximumCanonicalUtf8Bytes',
	'maximumNodes',
	'maximumNodeDepth',
	'maximumEntities',
	'maximumRelations',
	'maximumCollectionItems',
] as const);

export function decodeDocumentSnapshot(
	value: unknown,
	expectedResource: URI,
	limits: IDocumentSnapshotCodecLimits,
): DecodeDocumentSnapshotResult {
	const copiedLimits = copyCodecLimits(limits);
	if (copiedLimits === undefined) {
		return invalidSnapshot('invalid-limits', '$limits');
	}
	const resource = validatedExpectedResource(expectedResource);
	if (resource === undefined) {
		return invalidSnapshot('invalid-context', '$context.resource');
	}

	const captured = captureBoundedClosedJson(value, copiedLimits);
	if (captured.type === 'invalid') {
		return captured.reason === 'inspection-failed'
			? invalidSnapshot('inspection-failed', captured.path)
			: resourceLimitSnapshot(captured.limit, captured.path);
	}
	const document = asRecord(captured.value);
	if (
		document === undefined
		|| !hasExactKeys(document, snapshotKeys, snapshotKeys)
	) {
		return invalidSnapshot('invalid-envelope', '$');
	}
	if (document['format'] !== documentFormat) {
		return invalidSnapshot('unsupported-format', '$.format');
	}
	if (document['formatVersion'] !== documentFormatVersion) {
		return invalidSnapshot(
			'unsupported-format-version',
			'$.formatVersion',
		);
	}
	if (document['schemaId'] !== manuscriptSchemaId) {
		return invalidSnapshot('unsupported-schema', '$.schemaId');
	}
	if (document['schemaVersion'] !== manuscriptSchemaVersion) {
		return invalidSnapshot(
			'unsupported-schema-version',
			'$.schemaVersion',
		);
	}

	const revisionId = parseRevisionIdValue(document['revisionId']);
	if (revisionId === undefined) {
		return invalidSnapshot('invalid-revision-id', '$.revisionId');
	}
	const declaredDocumentHash = parseContentHashValue(document['documentHash']);
	if (declaredDocumentHash === undefined) {
		return invalidSnapshot('invalid-document-hash', '$.documentHash');
	}

	const treeLimits = toTreeLimits(copiedLimits);
	const metadata = decodeManuscriptMetadataV1(
		document['metadata'],
		copiedLimits.maximumCollectionItems,
		'$.metadata',
	);
	if (metadata.type === 'error') {
		return invalidSnapshot(metadata.reason, metadata.path);
	}
	const settings = decodeDocumentSemanticSettingsV1(
		document['settings'],
		'$.settings',
	);
	if (settings.type === 'error') {
		return invalidSnapshot(settings.reason, settings.path);
	}
	const tree = decodeManuscriptRootV1(
		document['root'],
		treeLimits,
		'$.root',
	);
	if (tree.type === 'error') {
		return invalidSnapshot(tree.reason, tree.path);
	}
	const graph = decodeAcademicGraph(
		document['academicGraph'],
		resource,
		copiedLimits,
	);
	if (graph.type === 'invalid') {
		return graph;
	}

	const entityValidation = validateGlobalEntitiesAndReferences(
		metadata.value.metadata,
		tree.value,
		graph.value,
		copiedLimits.maximumEntities,
	);
	if (entityValidation.type === 'invalid') {
		return entityValidation;
	}

	const content: DocumentContent = Object.freeze({
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: metadata.value.metadata,
		root: tree.value.root,
		academicGraph: graph.value,
		settings: settings.value,
	});
	const snapshot: DocumentSnapshot = Object.freeze({
		...content,
		revisionId,
		documentHash: declaredDocumentHash,
	});

	const indexResult = createDocumentIndex(snapshot.root, {
		maximumNodes: copiedLimits.maximumNodes,
		maximumDepth: copiedLimits.maximumNodeDepth,
	});
	if (indexResult.type === 'error') {
		return invalidSnapshot('invalid-document-index', '$.root');
	}

	let merkleState: RevisionMerkleState;
	try {
		merkleState = rebuildRevisionMerkleState(
			content,
			undefined,
			{
				maximumNodes: copiedLimits.maximumNodes,
				maximumDepth: copiedLimits.maximumNodeDepth,
			},
		);
	} catch {
		return invalidSnapshot('invalid-merkle-state', '$');
	}
	if (merkleState.documentHash !== declaredDocumentHash) {
		return invalidSnapshot('document-hash-mismatch', '$.documentHash');
	}

	return {
		type: 'valid',
		value: Object.freeze({
			snapshot,
			index: indexResult.value,
			merkleState,
		}),
	};
}

export function encodeDocumentSnapshotV1(
	value: unknown,
	expectedResource: URI,
	limits: IDocumentSnapshotCodecLimits,
): EncodeDocumentSnapshotResult {
	const copiedLimits = copyCodecLimits(limits);
	if (copiedLimits === undefined) {
		return invalidSnapshot('invalid-limits', '$limits');
	}
	const resource = validatedExpectedResource(expectedResource);
	if (resource === undefined) {
		return invalidSnapshot('invalid-context', '$context.resource');
	}

	let document: Readonly<Record<string, unknown>>;
	try {
		const inspected = inspectRuntimeRecord(value);
		if (
			inspected === undefined
			|| !hasExactKeys(inspected, snapshotKeys, snapshotKeys)
		) {
			return invalidSnapshot('invalid-envelope', '$');
		}
		document = inspected;
	} catch {
		return invalidSnapshot('inspection-failed', '$');
	}

	if (
		typeof document['format'] !== 'string'
		|| typeof document['formatVersion'] !== 'string'
		|| typeof document['schemaId'] !== 'string'
		|| typeof document['schemaVersion'] !== 'string'
		|| typeof document['revisionId'] !== 'string'
		|| typeof document['documentHash'] !== 'string'
	) {
		return invalidSnapshot('invalid-envelope', '$');
	}

	const metadata = encodeManuscriptMetadataV1(
		document['metadata'],
		copiedLimits.maximumCollectionItems,
		'$.metadata',
	);
	if (metadata.type === 'error') {
		return invalidSnapshot(metadata.reason, metadata.path);
	}
	const root = encodeManuscriptRootV1(
		document['root'],
		toTreeLimits(copiedLimits),
		'$.root',
	);
	if (root.type === 'error') {
		return invalidSnapshot(root.reason, root.path);
	}
	const settings = encodeDocumentSemanticSettingsV1(
		document['settings'],
		'$.settings',
	);
	if (settings.type === 'error') {
		return invalidSnapshot(settings.reason, settings.path);
	}
	const academicGraph = encodeAcademicGraph(
		document['academicGraph'],
		resource,
		copiedLimits,
	);
	if (academicGraph.type === 'invalid') {
		return academicGraph;
	}

	const persisted = Object.freeze({
		format: document['format'],
		formatVersion: document['formatVersion'],
		schemaId: document['schemaId'],
		schemaVersion: document['schemaVersion'],
		revisionId: document['revisionId'],
		documentHash: document['documentHash'],
		metadata: metadata.value,
		root: root.value,
		academicGraph: academicGraph.value,
		settings: settings.value,
	}) as PersistedDocumentSnapshotV1;
	const verified = decodeDocumentSnapshot(
		persisted,
		resource,
		copiedLimits,
	);
	return verified.type === 'invalid'
		? verified
		: {
			type: 'valid',
			value: persisted,
		};
}

function decodeAcademicGraph(
	value: CanonicalJsonValue,
	expectedResource: URI,
	limits: IDocumentSnapshotCodecLimits,
):
	| {
		readonly type: 'valid';
		readonly value: AcademicGraphSnapshot;
	}
	| DocumentSnapshotCodecError {
	const record = asRecord(value);
	if (
		record === undefined
		|| !hasExactKeys(record, academicGraphKeys, academicGraphKeys)
	) {
		return invalidSnapshot('invalid-academic-graph', '$.academicGraph');
	}
	const references = asArray(record['referenceSnapshots']);
	const evidence = asArray(record['evidenceLinks']);
	const claims = asArray(record['claims']);
	const relations = asArray(record['claimEvidenceRelations']);
	if (
		references === undefined
		|| evidence === undefined
		|| claims === undefined
		|| relations === undefined
	) {
		return invalidSnapshot('invalid-academic-graph', '$.academicGraph');
	}
	for (const [values, path] of [
		[references, '$.academicGraph.referenceSnapshots'],
		[evidence, '$.academicGraph.evidenceLinks'],
		[claims, '$.academicGraph.claims'],
		[relations, '$.academicGraph.claimEvidenceRelations'],
	] as const) {
		if (values.length > limits.maximumCollectionItems) {
			return invalidSnapshot('collection-budget-exceeded', path);
		}
	}
	if (references.length + evidence.length + claims.length > limits.maximumEntities) {
		return invalidSnapshot('entity-budget-exceeded', '$.academicGraph');
	}
	if (relations.length > limits.maximumRelations) {
		return invalidSnapshot(
			'relation-budget-exceeded',
			'$.academicGraph.claimEvidenceRelations',
		);
	}

	const decodedReferences = decodeAcademicEntityCollection(
		references,
		'reference-snapshot',
		expectedResource,
		'$.academicGraph.referenceSnapshots',
	);
	if (decodedReferences.type === 'invalid') {
		return decodedReferences;
	}
	const decodedEvidence = decodeAcademicEntityCollection(
		evidence,
		'evidence-link',
		expectedResource,
		'$.academicGraph.evidenceLinks',
	);
	if (decodedEvidence.type === 'invalid') {
		return decodedEvidence;
	}
	const decodedClaims = decodeAcademicEntityCollection(
		claims,
		'claim',
		expectedResource,
		'$.academicGraph.claims',
	);
	if (decodedClaims.type === 'invalid') {
		return decodedClaims;
	}
	const decodedRelations: ClaimEvidenceRelation[] = [];
	for (let index = 0; index < relations.length; index += 1) {
		const relation = decodeClaimEvidenceRelationV1(relations[index]);
		if (relation === undefined) {
			return invalidSnapshot(
				'invalid-academic-graph',
				`$.academicGraph.claimEvidenceRelations[${index}]`,
			);
		}
		decodedRelations.push(relation);
	}

	const candidate: AcademicGraphSnapshot = Object.freeze({
		referenceSnapshots: Object.freeze(decodedReferences.value),
		evidenceLinks: Object.freeze(decodedEvidence.value),
		claims: Object.freeze(decodedClaims.value),
		claimEvidenceRelations: Object.freeze(decodedRelations),
	});
	const trusted = createTrustedAcademicGraphSnapshot(candidate, {
		resource: expectedResource,
	});
	if (trusted.type === 'invalid') {
		return invalidSnapshot(
			'invalid-academic-graph',
			prefixAcademicGraphPath(trusted.path),
		);
	}
	return {
		type: 'valid',
		value: trusted.value,
	};
}

function decodeAcademicEntityCollection<TType extends AcademicEntity['type']>(
	values: readonly CanonicalJsonValue[],
	expectedType: TType,
	expectedResource: URI,
	path: string,
):
	| {
		readonly type: 'valid';
		readonly value: Extract<AcademicEntity, { readonly type: TType }>[];
	}
	| DocumentSnapshotCodecError {
	const decoded: Extract<AcademicEntity, { readonly type: TType }>[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const entity = decodeAcademicEntityV1(values[index], expectedResource);
		if (entity === undefined || entity.type !== expectedType) {
			return invalidSnapshot(
				'invalid-academic-graph',
				`${path}[${index}]`,
			);
		}
		decoded.push(
			entity as Extract<AcademicEntity, { readonly type: TType }>,
		);
	}
	return {
		type: 'valid',
		value: decoded,
	};
}

function encodeAcademicGraph(
	value: unknown,
	expectedResource: URI,
	limits: IDocumentSnapshotCodecLimits,
):
	| {
		readonly type: 'valid';
		readonly value: PersistedAcademicGraphV1;
	}
	| DocumentSnapshotCodecError {
	const trusted = createTrustedAcademicGraphSnapshot(value, {
		resource: expectedResource,
	});
	if (trusted.type === 'invalid') {
		return invalidSnapshot(
			'invalid-academic-graph',
			prefixAcademicGraphPath(trusted.path),
		);
	}
	const graph = trusted.value;
	for (const [values, path] of [
		[graph.referenceSnapshots, '$.academicGraph.referenceSnapshots'],
		[graph.evidenceLinks, '$.academicGraph.evidenceLinks'],
		[graph.claims, '$.academicGraph.claims'],
		[graph.claimEvidenceRelations, '$.academicGraph.claimEvidenceRelations'],
	] as const) {
		if (values.length > limits.maximumCollectionItems) {
			return invalidSnapshot('collection-budget-exceeded', path);
		}
	}
	if (
		graph.referenceSnapshots.length
		+ graph.evidenceLinks.length
		+ graph.claims.length
		> limits.maximumEntities
	) {
		return invalidSnapshot('entity-budget-exceeded', '$.academicGraph');
	}
	if (graph.claimEvidenceRelations.length > limits.maximumRelations) {
		return invalidSnapshot(
			'relation-budget-exceeded',
			'$.academicGraph.claimEvidenceRelations',
		);
	}

	const referenceSnapshots = encodeAcademicEntities(
		graph.referenceSnapshots,
		expectedResource,
		'$.academicGraph.referenceSnapshots',
	);
	if (referenceSnapshots.type === 'invalid') {
		return referenceSnapshots;
	}
	const evidenceLinks = encodeAcademicEntities(
		graph.evidenceLinks,
		expectedResource,
		'$.academicGraph.evidenceLinks',
	);
	if (evidenceLinks.type === 'invalid') {
		return evidenceLinks;
	}
	const claims = encodeAcademicEntities(
		graph.claims,
		expectedResource,
		'$.academicGraph.claims',
	);
	if (claims.type === 'invalid') {
		return claims;
	}
	const relations: PersistedClaimEvidenceRelationV1[] = [];
	for (
		let index = 0;
		index < graph.claimEvidenceRelations.length;
		index += 1
	) {
		const encoded = encodeClaimEvidenceRelationV1(
			graph.claimEvidenceRelations[index],
		);
		if (encoded === undefined) {
			return invalidSnapshot(
				'invalid-academic-graph',
				`$.academicGraph.claimEvidenceRelations[${index}]`,
			);
		}
		relations.push(encoded);
	}

	return {
		type: 'valid',
		value: Object.freeze({
			referenceSnapshots: Object.freeze(referenceSnapshots.value),
			evidenceLinks: Object.freeze(evidenceLinks.value),
			claims: Object.freeze(claims.value),
			claimEvidenceRelations: Object.freeze(relations),
		}),
	};
}

function encodeAcademicEntities(
	values: readonly AcademicEntity[],
	expectedResource: URI,
	path: string,
):
	| {
		readonly type: 'valid';
		readonly value: PersistedAcademicEntityV1[];
	}
	| DocumentSnapshotCodecError {
	const encoded: PersistedAcademicEntityV1[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const entity = encodeAcademicEntityV1(values[index], expectedResource);
		if (entity === undefined) {
			return invalidSnapshot(
				'invalid-academic-graph',
				`${path}[${index}]`,
			);
		}
		encoded.push(entity);
	}
	return {
		type: 'valid',
		value: encoded,
	};
}

function validateGlobalEntitiesAndReferences(
	metadata: ManuscriptMetadata,
	tree: Extract<
		ReturnType<typeof decodeManuscriptRootV1>,
		{ readonly type: 'ok' }
	>['value'],
	graph: AcademicGraphSnapshot,
	maximumEntities: number,
): { readonly type: 'valid' } | DocumentSnapshotCodecError {
	const allEntityIds = new Set<EntityId>();
	const referenceIds = new Set<EntityId>();
	const addEntity = (
		entityId: EntityId,
		path: string,
	): DocumentSnapshotCodecError | undefined => {
		if (allEntityIds.has(entityId)) {
			return invalidSnapshot('duplicate-entity-id', path);
		}
		if (allEntityIds.size >= maximumEntities) {
			return invalidSnapshot('entity-budget-exceeded', path);
		}
		allEntityIds.add(entityId);
		return undefined;
	};

	for (let index = 0; index < metadata.authors.length; index += 1) {
		const authorId = metadata.authors[index]?.id;
		if (authorId === undefined) {
			continue;
		}
		const duplicate = addEntity(
			authorId,
			`$.metadata.authors[${index}].id`,
		);
		if (duplicate !== undefined) {
			return duplicate;
		}
	}
	for (const entityId of tree.declaredEntityIds) {
		const duplicate = addEntity(entityId, '$.root');
		if (duplicate !== undefined) {
			return duplicate;
		}
	}
	for (const [values, collection] of [
		[graph.referenceSnapshots, 'referenceSnapshots'],
		[graph.evidenceLinks, 'evidenceLinks'],
		[graph.claims, 'claims'],
	] as const) {
		for (let index = 0; index < values.length; index += 1) {
			const entity = values[index]!;
			const duplicate = addEntity(
				entity.id,
				`$.academicGraph.${collection}[${index}].id`,
			);
			if (duplicate !== undefined) {
				return duplicate;
			}
			if (entity.type === 'reference-snapshot') {
				referenceIds.add(entity.id);
			}
		}
	}
	for (const reference of tree.citationReferences) {
		if (!referenceIds.has(reference.entityId)) {
			return invalidSnapshot(
				'dangling-citation-reference',
				reference.path,
			);
		}
	}
	for (const reference of tree.crossReferences) {
		if (!allEntityIds.has(reference.entityId)) {
			return invalidSnapshot(
				'dangling-cross-reference',
				reference.path,
			);
		}
	}
	for (const reference of tree.footnoteReferences) {
		if (tree.getNodeType(reference.nodeId) !== 'footnote') {
			return invalidSnapshot(
				'dangling-footnote-reference',
				reference.path,
			);
		}
	}
	return {
		type: 'valid',
	};
}

function validatedExpectedResource(value: unknown): URI | undefined {
	const captured = cloneCanonicalRuntimeUri(value);
	if (captured === undefined) {
		return undefined;
	}
	const validated = validateManuscriptResource(captured);
	return validated.type === 'valid'
		? validated.resource
		: undefined;
}

function copyCodecLimits(
	limits: unknown,
): IDocumentSnapshotCodecLimits | undefined {
	let record: Readonly<Record<string, unknown>> | undefined;
	try {
		record = inspectRuntimeRecord(limits);
	} catch {
		return undefined;
	}
	if (
		record === undefined
		|| !hasExactKeys(record, codecLimitKeys, codecLimitKeys)
	) {
		return undefined;
	}
	const values = codecLimitKeys.map(key => record[key]);
	if (values.some(value =>
		typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < 0
	)) {
		return undefined;
	}
	return Object.freeze({
		maximumDepth: record['maximumDepth'] as number,
		maximumValues: record['maximumValues'] as number,
		maximumArrayLength: record['maximumArrayLength'] as number,
		maximumObjectProperties: record['maximumObjectProperties'] as number,
		maximumCanonicalUtf8Bytes: record['maximumCanonicalUtf8Bytes'] as number,
		maximumNodes: record['maximumNodes'] as number,
		maximumNodeDepth: record['maximumNodeDepth'] as number,
		maximumEntities: record['maximumEntities'] as number,
		maximumRelations: record['maximumRelations'] as number,
		maximumCollectionItems: record['maximumCollectionItems'] as number,
	});
}

function toTreeLimits(
	limits: IDocumentSnapshotCodecLimits,
): IManuscriptTreeCodecLimits {
	return {
		maximumNodes: limits.maximumNodes,
		maximumDepth: limits.maximumNodeDepth,
		maximumCollectionItems: limits.maximumCollectionItems,
	};
}

function inspectRuntimeRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
	) {
		return undefined;
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Runtime record has an unsupported prototype.');
	}
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Runtime record has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Runtime record has an unsafe property descriptor.');
		}
		result[key] = descriptor.value;
	}
	return result;
}

function asRecord(value: unknown): ClosedRecord | undefined {
	return (
		value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
	)
		? value as ClosedRecord
		: undefined;
}

function asArray(
	value: CanonicalJsonValue | undefined,
): readonly CanonicalJsonValue[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

function hasExactKeys(
	record: Readonly<Record<string, unknown>>,
	allowed: readonly string[],
	required: readonly string[],
): boolean {
	const allowedSet = new Set(allowed);
	return (
		Object.keys(record).every(key => allowedSet.has(key))
		&& required.every(key => Object.hasOwn(record, key))
	);
}

function parseRevisionIdValue(value: unknown): RevisionId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseRevisionId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function parseContentHashValue(value: unknown): ContentHash | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseContentHash(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function prefixAcademicGraphPath(path: string): string {
	return path === '$'
		? '$.academicGraph'
		: `$.academicGraph${path.slice(1)}`;
}

function invalidSnapshot(
	reason: Exclude<
		DocumentSnapshotCodecFailure,
		'resource-limit-exceeded'
	>,
	path: string,
): Extract<
	DocumentSnapshotCodecError,
	{ readonly reason: Exclude<DocumentSnapshotCodecFailure, 'resource-limit-exceeded'> }
> {
	return Object.freeze({
		type: 'invalid',
		reason,
		path,
	});
}

function resourceLimitSnapshot(
	limit: BoundedClosedJsonLimit,
	path: string,
): Extract<
	DocumentSnapshotCodecError,
	{ readonly reason: 'resource-limit-exceeded' }
> {
	return Object.freeze({
		type: 'invalid',
		reason: 'resource-limit-exceeded',
		path,
		limit,
	});
}
