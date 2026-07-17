/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ContentHash,
	EntityId,
	NodeId,
	RevisionId,
} from 'cs/editor/common/core/identifiers';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import type { AcademicGraphSnapshot } from 'cs/editor/common/model/academicGraph';
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
} from 'cs/editor/common/model/manuscript';
import {
	ManuscriptMerkleVector,
	manuscriptMerkleVectorRoles,
	type ManuscriptMerkleVectorHashCall,
	type ManuscriptMerkleVectorHashCallObserver,
} from 'cs/editor/common/model/merkleVector';
import {
	createAcademicClaimHashPayload,
	createAcademicEvidenceHashPayload,
	createAcademicGraphHashPayload,
	createAcademicReferenceHashPayload,
	createAcademicRelationHashPayload,
	createDocumentMerkleHashPayload,
	createDocumentNodeHashPayload,
	createMerkleVectorDescriptor,
	createMetadataAuthorHashPayload,
	createMetadataKeywordHashPayload,
	createMetadataRootHashPayload,
	createMetadataTextHashPayload,
	createSettingsHashPayload,
	hashRevisionMerklePayload,
	type AcademicEntityHashPayload,
	type RevisionMerkleHashCallObserver,
} from 'cs/editor/common/model/revisionHashPayload';

export const documentFormat = 'nireco-document';
export const documentFormatVersion = '1';
export const manuscriptSchemaId = 'nireco.manuscript';
export const manuscriptSchemaVersion = '1';

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

const immutableRevisionMerkleStateConstructionToken = Object.freeze({});

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

	readonly #nodeHashesById: ReadonlyMap<NodeId, ContentHash>;
	readonly #nodeChildVectorsById:
		ReadonlyMap<NodeId, ManuscriptMerkleVector>;
	readonly #entityHashesById: ReadonlyMap<EntityId, ContentHash>;
	readonly #relationHashesByKey: ReadonlyMap<string, ContentHash>;

	constructor(
		constructionToken: object,
		options: {
			readonly documentHash: ContentHash;
			readonly metadata: IMetadataMerkleBuild;
			readonly nodes: INodeMerkleBuild;
			readonly academicGraph: IAcademicGraphMerkleBuild;
			readonly settingsHash: ContentHash;
			readonly entityHashesById: ReadonlyMap<EntityId, ContentHash>;
		},
	) {
		if (constructionToken !== immutableRevisionMerkleStateConstructionToken) {
			throw new TypeError(
				'Revision Merkle states can only be constructed by the rebuild owner.',
			);
		}
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
		this.#nodeHashesById = new Map(options.nodes.hashesById);
		this.#nodeChildVectorsById = new Map(options.nodes.childVectorsById);
		this.#entityHashesById = new Map(options.entityHashesById);
		this.#relationHashesByKey = new Map(
			options.academicGraph.relationHashesByKey,
		);
		this.nodeCount = this.#nodeHashesById.size;
		this.entityCount = this.#entityHashesById.size;
		this.relationCount = this.#relationHashesByKey.size;
		Object.freeze(this);
	}

	getNodeHash(nodeId: NodeId): ContentHash | undefined {
		return this.#nodeHashesById.get(nodeId);
	}

	getNodeChildrenVector(nodeId: NodeId): ManuscriptMerkleVector | undefined {
		return this.#nodeChildVectorsById.get(nodeId);
	}

	getEntityHash(entityId: EntityId): ContentHash | undefined {
		return this.#entityHashesById.get(entityId);
	}

	getRelationHash(
		claimId: EntityId,
		evidenceId: EntityId,
	): ContentHash | undefined {
		return this.#relationHashesByKey.get(relationKey(claimId, evidenceId));
	}
}

Object.defineProperty(ImmutableRevisionMerkleState.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(ImmutableRevisionMerkleState.prototype);
Object.freeze(ImmutableRevisionMerkleState);

/**
 * Independently rebuilds every Merkle layer from canonical document content.
 *
 * The rebuild never consumes an external hash cache and does not retain
 * canonical text or caller-owned content as a trust marker.
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
	const documentPayload = createDocumentMerkleHashPayload({
		schemaId: content.schemaId,
		schemaVersion: content.schemaVersion,
		metadataHash: metadata.hash,
		rootNodeHash: nodes.rootHash,
		academicGraphHash: academicGraph.hash,
		settingsHash,
	});
	const documentHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		documentPayload,
		observer,
	);

	return new ImmutableRevisionMerkleState(
		immutableRevisionMerkleStateConstructionToken,
		{
			documentHash,
			metadata,
			nodes,
			academicGraph,
			settingsHash,
			entityHashesById,
		},
	);
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
				return Object.freeze({
					item: child,
					hash,
				});
			});
			childVector = ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.nodeChildren,
				childHashes,
				{ onHashCall: toMerkleObserver(observer) },
			);
			childVectorsById.set(frame.node.id, childVector);
		}

		let payload;
		if (frame.node.type === 'text') {
			payload = createDocumentNodeHashPayload(frame.node);
		} else if ('children' in frame.node) {
			if (childVector === undefined) {
				throw new Error(
					`Missing child Merkle vector for container Node ${frame.node.id}.`,
				);
			}
			payload = createDocumentNodeHashPayload(
				frame.node,
				createMerkleVectorDescriptor(childVector),
			);
		} else {
			payload = createDocumentNodeHashPayload(frame.node);
		}
		const hash = hashRevisionMerklePayload(
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
function rebuildMetadataMerkleState(
	metadata: ManuscriptMetadata,
	observer: RevisionMerkleHashCallObserver | undefined,
): IMetadataMerkleBuild {
	const titlePayload = createMetadataTextHashPayload('title', metadata.title);
	const titleHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		titlePayload,
		observer,
	);

	const authorHashes = metadata.authors.map(author => {
		const payload = createMetadataAuthorHashPayload(author);
		const hash = hashRevisionMerklePayload(
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

	const abstractPayload = createMetadataTextHashPayload(
		'abstract',
		metadata.abstract,
	);
	const abstractHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		abstractPayload,
		observer,
	);

	const keywordHashes = metadata.keywords.map(keyword => {
		const payload = createMetadataKeywordHashPayload(keyword);
		return hashRevisionMerklePayload(
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

	const payload = createMetadataRootHashPayload(
		titleHash,
		createMerkleVectorDescriptor(authorsVector),
		abstractHash,
		createMerkleVectorDescriptor(keywordsVector),
	);
	return {
		hash: hashRevisionMerklePayload(
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
	const payload = createSettingsHashPayload(settings);
	return hashRevisionMerklePayload(
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
			createAcademicReferenceHashPayload(reference),
			observer,
		);
		setEntityHash(entityHashesById, reference.id, hash);
		return Object.freeze({ item: reference, hash });
	});
	const referenceSnapshotsVector = ManuscriptMerkleVector.createStructural(
		manuscriptMerkleVectorRoles.academicReferenceSnapshots,
		referenceSnapshotHashes,
		{ onHashCall: toMerkleObserver(observer) },
	);

	const evidenceLinkHashes = graph.evidenceLinks.map(evidenceLink => {
		const hash = hashAcademicPayload(
			createAcademicEvidenceHashPayload(evidenceLink),
			observer,
		);
		setEntityHash(entityHashesById, evidenceLink.id, hash);
		return Object.freeze({ item: evidenceLink, hash });
	});
	const evidenceLinksVector = ManuscriptMerkleVector.createStructural(
		manuscriptMerkleVectorRoles.academicEvidenceLinks,
		evidenceLinkHashes,
		{ onHashCall: toMerkleObserver(observer) },
	);

	const claimHashes = graph.claims.map(claim => {
		const hash = hashAcademicPayload(
			createAcademicClaimHashPayload(claim),
			observer,
		);
		setEntityHash(entityHashesById, claim.id, hash);
		return Object.freeze({ item: claim, hash });
	});
	const claimsVector = ManuscriptMerkleVector.createStructural(
		manuscriptMerkleVectorRoles.academicClaims,
		claimHashes,
		{ onHashCall: toMerkleObserver(observer) },
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
			createAcademicRelationHashPayload(relation),
			observer,
		);
		relationHashesByKey.set(key, hash);
		return Object.freeze({ item: relation, hash });
	});
	const claimEvidenceRelationsVector =
		ManuscriptMerkleVector.createStructural(
		manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
		relationHashes,
		{ onHashCall: toMerkleObserver(observer) },
		);

	const payload = createAcademicGraphHashPayload(
		createMerkleVectorDescriptor(referenceSnapshotsVector),
		createMerkleVectorDescriptor(evidenceLinksVector),
		createMerkleVectorDescriptor(claimsVector),
		createMerkleVectorDescriptor(claimEvidenceRelationsVector),
	);
	return {
		hash: hashRevisionMerklePayload(
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

function hashAcademicPayload(
	payload: AcademicEntityHashPayload,
	observer: RevisionMerkleHashCallObserver | undefined,
): ContentHash {
	return hashRevisionMerklePayload(
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

function nodeOwnsChildren(node: DocumentNode): boolean {
	return 'children' in node;
}

function toMerkleObserver(
	observer: RevisionMerkleHashCallObserver | undefined,
): ManuscriptMerkleVectorHashCallObserver | undefined {
	return observer === undefined
		? undefined
		: (call: ManuscriptMerkleVectorHashCall) => observer(call);
}
