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
import type { AcademicGraphSnapshot } from 'cs/editor/common/model/academicGraph';
import type {
	DocumentSemanticSettings,
	ManuscriptMetadata,
	ManuscriptNode,
} from 'cs/editor/common/model/manuscript';
import type { ManuscriptMerkleVector } from 'cs/editor/common/model/merkleVector';

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
