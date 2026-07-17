/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';
import { encodeCanonicalUri } from 'cs/editor/common/core/canonicalUri';
import type {
	ContentHash,
	EntityId,
	NodeId,
	RevisionId,
} from 'cs/editor/common/core/identifiers';
import type { SemanticPosition } from 'cs/editor/common/core/semanticPosition';
import {
	manuscriptHashDomains,
	type ManuscriptHashDomain,
} from 'cs/editor/common/core/hashPreimage';
import { hashCanonicalJson } from 'cs/editor/common/core/sha256';
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
	createDocumentIndex,
	type IDocumentIndexLimits,
} from 'cs/editor/common/model/documentIndex';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type DocumentSemanticSettings,
	type ManuscriptMetadata,
	type ManuscriptNode,
	type Mark,
} from 'cs/editor/common/model/manuscript';
import {
	ManuscriptMerkleVector,
	manuscriptMerkleVectorRoles,
	type ManuscriptMerkleVectorHashCall,
	type ManuscriptMerkleVectorHashCallObserver,
	type ManuscriptMerkleVectorPayload,
} from 'cs/editor/common/model/merkleVector';

export const documentFormat = 'nireco-document';
export const documentFormatVersion = '1';
export const manuscriptSchemaId = 'nireco.manuscript';
export const manuscriptSchemaVersion = '1';

export const manuscriptNodeHashAlgorithm = 'nireco-manuscript-node-1';
export const academicEntityHashAlgorithm = 'nireco-academic-entity-1';
export const academicGraphHashAlgorithm = 'nireco-academic-graph-1';
export const manuscriptMetadataHashAlgorithm = 'nireco-manuscript-metadata-1';
export const manuscriptSettingsHashAlgorithm = 'nireco-manuscript-settings-1';
export const documentMerkleHashAlgorithm = 'nireco-document-merkle-1';

export interface DocumentContent {
	readonly format: typeof documentFormat;
	readonly formatVersion: typeof documentFormatVersion;
	readonly schemaId: typeof manuscriptSchemaId;
	readonly schemaVersion: typeof manuscriptSchemaVersion;
	readonly metadata: ManuscriptMetadata;
	readonly root: ManuscriptNode;
	readonly academicGraph: AcademicGraphSnapshot;
	readonly settings: DocumentSemanticSettings;
}

export interface DocumentSnapshot extends DocumentContent {
	readonly revisionId: RevisionId;
	readonly documentHash: ContentHash;
}

export interface IMerkleVectorDescriptor {
	readonly count: number;
	readonly hash: ContentHash;
}

export type CanonicalManuscriptMark =
	| {
		readonly type: Exclude<Mark['type'], 'link'>;
	}
	| {
		readonly type: 'link';
		readonly href: string;
		readonly title?: string;
	};

export type ManuscriptNodeHashPayload =
	| {
		readonly algorithm: typeof manuscriptNodeHashAlgorithm;
		readonly id: NodeId;
		readonly type: 'text';
		readonly value: string;
		readonly marks: readonly CanonicalManuscriptMark[];
	}
	| {
		readonly algorithm: typeof manuscriptNodeHashAlgorithm;
		readonly id: NodeId;
		readonly type: Exclude<DocumentNode['type'], 'text'>;
		readonly attrs: Readonly<Record<string, CanonicalJsonValue>>;
		readonly children?: IMerkleVectorDescriptor;
	};

export type ManuscriptMetadataHashPayload =
	| {
		readonly algorithm: typeof manuscriptMetadataHashAlgorithm;
		readonly kind: 'text-field';
		readonly field: 'title' | 'abstract';
		readonly value: string;
	}
	| {
		readonly algorithm: typeof manuscriptMetadataHashAlgorithm;
		readonly kind: 'author';
		readonly id?: EntityId;
		readonly name: string;
		readonly given?: string;
		readonly family?: string;
		readonly orcid?: string;
		readonly affiliations?: readonly string[];
	}
	| {
		readonly algorithm: typeof manuscriptMetadataHashAlgorithm;
		readonly kind: 'keyword';
		readonly value: string;
	}
	| {
		readonly algorithm: typeof manuscriptMetadataHashAlgorithm;
		readonly titleHash: ContentHash;
		readonly authors: IMerkleVectorDescriptor;
		readonly abstractHash: ContentHash;
		readonly keywords: IMerkleVectorDescriptor;
	};

export interface ManuscriptSettingsHashPayload {
	readonly algorithm: typeof manuscriptSettingsHashAlgorithm;
	readonly language: string;
	readonly citationStyle: string;
	readonly headingNumbering: boolean;
	readonly bibliographyEnabled: boolean;
}

export interface ICanonicalPersistentAnchor {
	readonly document: {
		readonly resource: string;
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

export type AcademicEntityHashPayload =
	| {
		readonly algorithm: typeof academicEntityHashAlgorithm;
		readonly id: EntityId;
		readonly type: 'reference-snapshot';
		readonly externalUri?: string;
		readonly cslJson: Readonly<Record<string, CanonicalJsonValue>>;
		readonly capturedAt: string;
		readonly sourceProvider?: string;
	}
	| {
		readonly algorithm: typeof academicEntityHashAlgorithm;
		readonly id: EntityId;
		readonly type: 'evidence-link';
		readonly sourceUri: string;
		readonly sourceContentHash: ContentHash;
		readonly locator: EvidenceLocator;
		readonly excerpt?: string;
		readonly verificationStatus: EvidenceLink['verificationStatus'];
		readonly verifiedBy?: ActorRef;
		readonly verifiedAt?: string;
	}
	| {
		readonly algorithm: typeof academicEntityHashAlgorithm;
		readonly id: EntityId;
		readonly type: 'claim';
		readonly anchor: ICanonicalPersistentAnchor;
		readonly textSnapshot: string;
	}
	| {
		readonly algorithm: typeof academicEntityHashAlgorithm;
		readonly type: 'claim-evidence-relation';
		readonly claimId: EntityId;
		readonly evidenceId: EntityId;
		readonly relation: ClaimEvidenceRelation['relation'];
		readonly assessedBy: ActorRef;
		readonly confidence?: number;
	};

export interface AcademicGraphHashPayload {
	readonly algorithm: typeof academicGraphHashAlgorithm;
	readonly referenceSnapshots: IMerkleVectorDescriptor;
	readonly evidenceLinks: IMerkleVectorDescriptor;
	readonly claims: IMerkleVectorDescriptor;
	readonly claimEvidenceRelations: IMerkleVectorDescriptor;
}

export interface DocumentMerklePayload {
	readonly algorithm: typeof documentMerkleHashAlgorithm;
	readonly schemaId: typeof manuscriptSchemaId;
	readonly schemaVersion: typeof manuscriptSchemaVersion;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
}

export type RevisionMerkleHashPayload =
	| ManuscriptMerkleVectorPayload
	| ManuscriptNodeHashPayload
	| ManuscriptMetadataHashPayload
	| ManuscriptSettingsHashPayload
	| AcademicEntityHashPayload
	| AcademicGraphHashPayload
	| DocumentMerklePayload;

export interface IRevisionMerkleHashCall {
	readonly domain: ManuscriptHashDomain;
	readonly payload: RevisionMerkleHashPayload;
	readonly canonicalJson: string;
	readonly hash: ContentHash;
}

export type RevisionMerkleHashCallObserver = (
	call: IRevisionMerkleHashCall,
) => void;

export interface RevisionMerkleState {
	readonly documentHash: ContentHash;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly metadataAuthorsVector: ManuscriptMerkleVector;
	readonly metadataKeywordsVector: ManuscriptMerkleVector;
	readonly academicReferenceSnapshotsVector: ManuscriptMerkleVector;
	readonly academicEvidenceLinksVector: ManuscriptMerkleVector;
	readonly academicClaimsVector: ManuscriptMerkleVector;
	readonly academicClaimEvidenceRelationsVector: ManuscriptMerkleVector;

	getNodeHash(nodeId: NodeId): ContentHash | undefined;
	getNodeChildrenVector(nodeId: NodeId): ManuscriptMerkleVector | undefined;
	getEntityHash(entityId: EntityId): ContentHash | undefined;
	getRelationHash(claimId: EntityId, evidenceId: EntityId): ContentHash | undefined;
}

interface INodeMerkleBuild {
	readonly rootHash: ContentHash;
	readonly hashesById: ReadonlyMap<NodeId, ContentHash>;
	readonly childVectorsById: ReadonlyMap<NodeId, ManuscriptMerkleVector>;
}

interface IMetadataMerkleBuild {
	readonly hash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly authorsVector: ManuscriptMerkleVector;
	readonly keywordsVector: ManuscriptMerkleVector;
}

interface IAcademicGraphMerkleBuild {
	readonly hash: ContentHash;
	readonly referenceSnapshotsVector: ManuscriptMerkleVector;
	readonly evidenceLinksVector: ManuscriptMerkleVector;
	readonly claimsVector: ManuscriptMerkleVector;
	readonly claimEvidenceRelationsVector: ManuscriptMerkleVector;
	readonly relationHashesByKey: ReadonlyMap<string, ContentHash>;
}

type NodeTraversalFrame =
	| {
		readonly kind: 'enter';
		readonly node: DocumentNode;
	}
	| {
		readonly kind: 'exit';
		readonly node: DocumentNode;
	};

class ImmutableRevisionMerkleState implements RevisionMerkleState {
	readonly documentHash: ContentHash;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly metadataAuthorsVector: ManuscriptMerkleVector;
	readonly metadataKeywordsVector: ManuscriptMerkleVector;
	readonly academicReferenceSnapshotsVector: ManuscriptMerkleVector;
	readonly academicEvidenceLinksVector: ManuscriptMerkleVector;
	readonly academicClaimsVector: ManuscriptMerkleVector;
	readonly academicClaimEvidenceRelationsVector: ManuscriptMerkleVector;

	private readonly nodeHashesById: ReadonlyMap<NodeId, ContentHash>;
	private readonly nodeChildVectorsById: ReadonlyMap<NodeId, ManuscriptMerkleVector>;
	private readonly entityHashesById: ReadonlyMap<EntityId, ContentHash>;
	private readonly relationHashesByKey: ReadonlyMap<string, ContentHash>;

	constructor(options: {
		readonly documentHash: ContentHash;
		readonly metadata: IMetadataMerkleBuild;
		readonly nodes: INodeMerkleBuild;
		readonly academicGraph: IAcademicGraphMerkleBuild;
		readonly settingsHash: ContentHash;
		readonly entityHashesById: ReadonlyMap<EntityId, ContentHash>;
	}) {
		this.documentHash = options.documentHash;
		this.metadataHash = options.metadata.hash;
		this.rootNodeHash = options.nodes.rootHash;
		this.academicGraphHash = options.academicGraph.hash;
		this.settingsHash = options.settingsHash;
		this.titleHash = options.metadata.titleHash;
		this.abstractHash = options.metadata.abstractHash;
		this.metadataAuthorsVector = options.metadata.authorsVector;
		this.metadataKeywordsVector = options.metadata.keywordsVector;
		this.academicReferenceSnapshotsVector =
			options.academicGraph.referenceSnapshotsVector;
		this.academicEvidenceLinksVector = options.academicGraph.evidenceLinksVector;
		this.academicClaimsVector = options.academicGraph.claimsVector;
		this.academicClaimEvidenceRelationsVector =
			options.academicGraph.claimEvidenceRelationsVector;
		this.nodeHashesById = new Map(options.nodes.hashesById);
		this.nodeChildVectorsById = new Map(options.nodes.childVectorsById);
		this.entityHashesById = new Map(options.entityHashesById);
		this.relationHashesByKey = new Map(
			options.academicGraph.relationHashesByKey,
		);
		this.nodeCount = this.nodeHashesById.size;
		this.entityCount = this.entityHashesById.size;
		this.relationCount = this.relationHashesByKey.size;
		Object.freeze(this);
	}

	getNodeHash(nodeId: NodeId): ContentHash | undefined {
		return this.nodeHashesById.get(nodeId);
	}

	getNodeChildrenVector(nodeId: NodeId): ManuscriptMerkleVector | undefined {
		return this.nodeChildVectorsById.get(nodeId);
	}

	getEntityHash(entityId: EntityId): ContentHash | undefined {
		return this.entityHashesById.get(entityId);
	}

	getRelationHash(
		claimId: EntityId,
		evidenceId: EntityId,
	): ContentHash | undefined {
		return this.relationHashesByKey.get(relationKey(claimId, evidenceId));
	}
}

/**
 * Independently rebuilds every Merkle layer from canonical document content.
 *
 * The rebuild never consumes an external hash cache and does not retain whole-tree
 * canonical text or object-identity trust markers.
 */
export function rebuildRevisionMerkleState(
	content: DocumentContent,
	observer?: RevisionMerkleHashCallObserver,
	indexLimits?: IDocumentIndexLimits,
): RevisionMerkleState {
	const entityHashesById = new Map<EntityId, ContentHash>();
	const nodes = rebuildNodeMerkleState(content.root, observer, indexLimits);
	const metadata = rebuildMetadataMerkleState(
		content.metadata,
		observer,
	);
	const settingsHash = rebuildSettingsHash(content.settings, observer);
	const academicGraph = rebuildAcademicGraphMerkleState(
		content.academicGraph,
		entityHashesById,
		observer,
	);
	const documentPayload: DocumentMerklePayload = Object.freeze({
		algorithm: documentMerkleHashAlgorithm,
		schemaId: content.schemaId,
		schemaVersion: content.schemaVersion,
		metadataHash: metadata.hash,
		rootNodeHash: nodes.rootHash,
		academicGraphHash: academicGraph.hash,
		settingsHash,
	});
	const documentHash = hashPayload(
		manuscriptHashDomains.documentContent,
		documentPayload,
		observer,
	);

	return new ImmutableRevisionMerkleState({
		documentHash,
		metadata,
		nodes,
		academicGraph,
		settingsHash,
		entityHashesById,
	});
}

function rebuildNodeMerkleState(
	root: ManuscriptNode,
	observer: RevisionMerkleHashCallObserver | undefined,
	indexLimits: IDocumentIndexLimits | undefined,
): INodeMerkleBuild {
	const indexResult = createDocumentIndex(root, indexLimits);
	if (indexResult.type === 'error') {
		throw new TypeError(
			`Cannot rebuild document node hashes: ${indexResult.error.reason}.`,
		);
	}
	const index = indexResult.value;
	const hashesById = new Map<NodeId, ContentHash>();
	const childVectorsById = new Map<NodeId, ManuscriptMerkleVector>();
	const pending: NodeTraversalFrame[] = [{
		kind: 'enter',
		node: root,
	}];

	while (pending.length > 0) {
		const frame = pending.pop();
		if (frame === undefined) {
			break;
		}
		if (frame.kind === 'enter') {
			pending.push({
				kind: 'exit',
				node: frame.node,
			});
			const children = getDocumentNodeChildren(frame.node);
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const child = children[index];
				if (child !== undefined) {
					pending.push({
						kind: 'enter',
						node: child,
					});
				}
			}
			continue;
		}

		const children = getDocumentNodeChildren(frame.node);
		let childVector: ManuscriptMerkleVector | undefined;
		if (nodeOwnsChildren(frame.node)) {
			const childHashes = children.map(child => {
				const hash = hashesById.get(child.id);
				if (hash === undefined) {
					throw new Error(`Missing subtree hash for child Node ${child.id}.`);
				}
				return hash;
			});
			childVector = ManuscriptMerkleVector.create(
				manuscriptMerkleVectorRoles.nodeChildren,
				childHashes,
				toMerkleObserver(observer),
			);
			childVectorsById.set(frame.node.id, childVector);
		}

		const payload = createNodeHashPayload(frame.node, childVector);
		const hash = hashPayload(
			manuscriptHashDomains.node,
			payload,
			observer,
		);
		hashesById.set(frame.node.id, hash);
	}

	const rootHash = hashesById.get(index.rootNodeId);
	if (rootHash === undefined || hashesById.size !== index.nodeCount) {
		throw new Error('The document node Merkle rebuild is incomplete.');
	}
	return {
		rootHash,
		hashesById,
		childVectorsById,
	};
}

function createNodeHashPayload(
	node: DocumentNode,
	childVector: ManuscriptMerkleVector | undefined,
): ManuscriptNodeHashPayload {
	if (node.type === 'text') {
		return Object.freeze({
			algorithm: manuscriptNodeHashAlgorithm,
			id: node.id,
			type: node.type,
			value: node.value,
			marks: Object.freeze(node.marks.map(encodeMark)),
		});
	}

	const attrs = encodeCanonicalRecord(node.attrs);
	return Object.freeze({
		algorithm: manuscriptNodeHashAlgorithm,
		id: node.id,
		type: node.type,
		attrs,
		...(childVector === undefined
			? {}
			: { children: vectorDescriptor(childVector) }),
	});
}

function encodeMark(mark: Mark): CanonicalManuscriptMark {
	if (mark.type !== 'link') {
		return Object.freeze({
			type: mark.type,
		});
	}
	return Object.freeze({
		type: mark.type,
		href: encodeRuntimeUri(mark.href),
		...(mark.title === undefined ? {} : { title: mark.title }),
	});
}

function rebuildMetadataMerkleState(
	metadata: ManuscriptMetadata,
	observer: RevisionMerkleHashCallObserver | undefined,
): IMetadataMerkleBuild {
	const titlePayload: ManuscriptMetadataHashPayload = Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		kind: 'text-field',
		field: 'title',
		value: metadata.title,
	});
	const titleHash = hashPayload(
		manuscriptHashDomains.documentContent,
		titlePayload,
		observer,
	);

	const authorHashes = metadata.authors.map(author => {
		const payload: ManuscriptMetadataHashPayload = Object.freeze({
			algorithm: manuscriptMetadataHashAlgorithm,
			kind: 'author',
			...(author.id === undefined ? {} : { id: author.id }),
			name: author.name,
			...(author.given === undefined ? {} : { given: author.given }),
			...(author.family === undefined ? {} : { family: author.family }),
			...(author.orcid === undefined ? {} : { orcid: author.orcid }),
			...(author.affiliations === undefined
				? {}
				: { affiliations: Object.freeze([...author.affiliations]) }),
		});
		const hash = hashPayload(
			manuscriptHashDomains.documentContent,
			payload,
			observer,
		);
		return hash;
	});
	const authorsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.metadataAuthors,
		authorHashes,
		toMerkleObserver(observer),
	);

	const abstractPayload: ManuscriptMetadataHashPayload = Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		kind: 'text-field',
		field: 'abstract',
		value: metadata.abstract,
	});
	const abstractHash = hashPayload(
		manuscriptHashDomains.documentContent,
		abstractPayload,
		observer,
	);

	const keywordHashes = metadata.keywords.map(keyword => {
		const payload: ManuscriptMetadataHashPayload = Object.freeze({
			algorithm: manuscriptMetadataHashAlgorithm,
			kind: 'keyword',
			value: keyword,
		});
		return hashPayload(
			manuscriptHashDomains.documentContent,
			payload,
			observer,
		);
	});
	const keywordsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.metadataKeywords,
		keywordHashes,
		toMerkleObserver(observer),
	);

	const payload: ManuscriptMetadataHashPayload = Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		titleHash,
		authors: vectorDescriptor(authorsVector),
		abstractHash,
		keywords: vectorDescriptor(keywordsVector),
	});
	return {
		hash: hashPayload(
			manuscriptHashDomains.documentContent,
			payload,
			observer,
		),
		titleHash,
		abstractHash,
		authorsVector,
		keywordsVector,
	};
}

function rebuildSettingsHash(
	settings: DocumentSemanticSettings,
	observer: RevisionMerkleHashCallObserver | undefined,
): ContentHash {
	const payload: ManuscriptSettingsHashPayload = Object.freeze({
		algorithm: manuscriptSettingsHashAlgorithm,
		language: settings.language,
		citationStyle: settings.citationStyle,
		headingNumbering: settings.headingNumbering,
		bibliographyEnabled: settings.bibliographyEnabled,
	});
	return hashPayload(
		manuscriptHashDomains.documentContent,
		payload,
		observer,
	);
}

function rebuildAcademicGraphMerkleState(
	graph: AcademicGraphSnapshot,
	entityHashesById: Map<EntityId, ContentHash>,
	observer: RevisionMerkleHashCallObserver | undefined,
): IAcademicGraphMerkleBuild {
	const referenceSnapshotHashes = graph.referenceSnapshots.map(reference => {
		const hash = hashAcademicPayload(
			createReferenceHashPayload(reference),
			observer,
		);
		setEntityHash(entityHashesById, reference.id, hash);
		return hash;
	});
	const referenceSnapshotsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.academicReferenceSnapshots,
		referenceSnapshotHashes,
		toMerkleObserver(observer),
	);

	const evidenceLinkHashes = graph.evidenceLinks.map(evidenceLink => {
		const hash = hashAcademicPayload(
			createEvidenceLinkHashPayload(evidenceLink),
			observer,
		);
		setEntityHash(entityHashesById, evidenceLink.id, hash);
		return hash;
	});
	const evidenceLinksVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.academicEvidenceLinks,
		evidenceLinkHashes,
		toMerkleObserver(observer),
	);

	const claimHashes = graph.claims.map(claim => {
		const hash = hashAcademicPayload(
			createClaimHashPayload(claim),
			observer,
		);
		setEntityHash(entityHashesById, claim.id, hash);
		return hash;
	});
	const claimsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.academicClaims,
		claimHashes,
		toMerkleObserver(observer),
	);

	const relationHashesByKey = new Map<string, ContentHash>();
	const relationHashes = graph.claimEvidenceRelations.map(relation => {
		const key = relationKey(relation.claimId, relation.evidenceId);
		if (relationHashesByKey.has(key)) {
			throw new TypeError(
				'Duplicate Claim-Evidence relation during Merkle rebuild.',
			);
		}
		const hash = hashAcademicPayload(
			createRelationHashPayload(relation),
			observer,
		);
		relationHashesByKey.set(key, hash);
		return hash;
	});
	const claimEvidenceRelationsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
		relationHashes,
		toMerkleObserver(observer),
	);

	const payload: AcademicGraphHashPayload = Object.freeze({
		algorithm: academicGraphHashAlgorithm,
		referenceSnapshots: vectorDescriptor(referenceSnapshotsVector),
		evidenceLinks: vectorDescriptor(evidenceLinksVector),
		claims: vectorDescriptor(claimsVector),
		claimEvidenceRelations: vectorDescriptor(claimEvidenceRelationsVector),
	});
	return {
		hash: hashPayload(
			manuscriptHashDomains.documentContent,
			payload,
			observer,
		),
		referenceSnapshotsVector,
		evidenceLinksVector,
		claimsVector,
		claimEvidenceRelationsVector,
		relationHashesByKey,
	};
}

function createReferenceHashPayload(
	reference: ReferenceSnapshot,
): Extract<AcademicEntityHashPayload, { readonly type: 'reference-snapshot' }> {
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		id: reference.id,
		type: reference.type,
		...(reference.externalUri === undefined
			? {}
			: { externalUri: encodeRuntimeUri(reference.externalUri) }),
		cslJson: encodeCanonicalRecord(reference.cslJson),
		capturedAt: reference.capturedAt,
		...(reference.sourceProvider === undefined
			? {}
			: { sourceProvider: reference.sourceProvider }),
	});
}

function createEvidenceLinkHashPayload(
	evidenceLink: EvidenceLink,
): Extract<AcademicEntityHashPayload, { readonly type: 'evidence-link' }> {
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		id: evidenceLink.id,
		type: evidenceLink.type,
		sourceUri: encodeRuntimeUri(evidenceLink.sourceUri),
		sourceContentHash: evidenceLink.sourceContentHash,
		locator: Object.freeze({ ...evidenceLink.locator }),
		...(evidenceLink.excerpt === undefined
			? {}
			: { excerpt: evidenceLink.excerpt }),
		verificationStatus: evidenceLink.verificationStatus,
		...(evidenceLink.verifiedBy === undefined
			? {}
			: { verifiedBy: cloneActor(evidenceLink.verifiedBy) }),
		...(evidenceLink.verifiedAt === undefined
			? {}
			: { verifiedAt: evidenceLink.verifiedAt }),
	});
}

function createClaimHashPayload(
	claim: ClaimEntity,
): Extract<AcademicEntityHashPayload, { readonly type: 'claim' }> {
	const anchor: ICanonicalPersistentAnchor = Object.freeze({
		document: Object.freeze({
			resource: encodeRuntimeUri(claim.anchor.document.resource),
			revisionId: claim.anchor.document.revisionId,
		}),
		primary: Object.freeze({ ...claim.anchor.primary }),
		...(claim.anchor.targetNodeId === undefined
			? {}
			: { targetNodeId: claim.anchor.targetNodeId }),
		...(claim.anchor.textQuote === undefined
			? {}
			: { textQuote: Object.freeze({ ...claim.anchor.textQuote }) }),
		...(claim.anchor.pathHint === undefined
			? {}
			: { pathHint: Object.freeze([...claim.anchor.pathHint]) }),
	});
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		id: claim.id,
		type: claim.type,
		anchor,
		textSnapshot: claim.textSnapshot,
	});
}

function createRelationHashPayload(
	relation: ClaimEvidenceRelation,
): Extract<
	AcademicEntityHashPayload,
	{ readonly type: 'claim-evidence-relation' }
> {
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		type: relation.type,
		claimId: relation.claimId,
		evidenceId: relation.evidenceId,
		relation: relation.relation,
		assessedBy: cloneActor(relation.assessedBy),
		...(relation.confidence === undefined
			? {}
			: { confidence: relation.confidence }),
	});
}

function hashAcademicPayload(
	payload: AcademicEntityHashPayload,
	observer: RevisionMerkleHashCallObserver | undefined,
): ContentHash {
	return hashPayload(
		manuscriptHashDomains.academicEntity,
		payload,
		observer,
	);
}

function setEntityHash(
	hashesById: Map<EntityId, ContentHash>,
	entityId: EntityId,
	hash: ContentHash,
): void {
	if (hashesById.has(entityId)) {
		throw new TypeError(`Duplicate Entity ID during Merkle rebuild: ${entityId}.`);
	}
	hashesById.set(entityId, hash);
}

function relationKey(claimId: EntityId, evidenceId: EntityId): string {
	return `${claimId}\0${evidenceId}`;
}

function cloneActor(actor: ActorRef): ActorRef {
	return actor.type === 'system'
		? Object.freeze({
			type: actor.type,
			id: actor.id,
			role: actor.role,
		})
		: Object.freeze({
			type: actor.type,
			id: actor.id,
		});
}

function nodeOwnsChildren(node: DocumentNode): boolean {
	return 'children' in node;
}

function vectorDescriptor(
	vector: ManuscriptMerkleVector,
): IMerkleVectorDescriptor {
	return Object.freeze({
		count: vector.count,
		hash: vector.rootHash,
	});
}

function encodeCanonicalRecord(
	value: object,
): Readonly<Record<string, CanonicalJsonValue>> {
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Document hash payload has an unsupported record prototype.');
	}
	const result: Record<string, CanonicalJsonValue> = Object.create(
		Object.prototype,
	);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Document hash payload has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Document hash payload has an unsafe property.');
		}
		const item = encodeCanonicalValue(
			descriptor.value,
		);
		Object.defineProperty(result, key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return Object.freeze(result);
}

function encodeCanonicalValue(value: unknown): CanonicalJsonValue {
	if (
		value === null
		|| typeof value === 'string'
		|| typeof value === 'boolean'
		|| typeof value === 'number'
	) {
		return value;
	}
	if (URI.isUri(value)) {
		return encodeRuntimeUri(value);
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(encodeCanonicalValue));
	}
	if (value !== null && typeof value === 'object') {
		return encodeCanonicalRecord(value);
	}
	throw new TypeError('Document hash payload contains a non-canonical value.');
}

function encodeRuntimeUri(value: URI): string {
	const encoded = encodeCanonicalUri(value);
	if (encoded === undefined) {
		throw new TypeError('Document hash payload contains a non-canonical URI.');
	}
	return encoded;
}

function toMerkleObserver(
	observer: RevisionMerkleHashCallObserver | undefined,
): ManuscriptMerkleVectorHashCallObserver | undefined {
	return observer === undefined
		? undefined
		: (call: ManuscriptMerkleVectorHashCall) => observer(call);
}

function hashPayload(
	domain: ManuscriptHashDomain,
	payload: RevisionMerkleHashPayload,
	observer: RevisionMerkleHashCallObserver | undefined,
): ContentHash {
	const result = hashCanonicalJson(domain, payload);
	if (result.type === 'error') {
		throw new TypeError(`Document hash payload is not canonical JSON at ${result.path}.`);
	}
	observer?.(Object.freeze({
		domain,
		payload,
		canonicalJson: result.canonicalJson,
		hash: result.hash,
	}));
	return result.hash;
}
