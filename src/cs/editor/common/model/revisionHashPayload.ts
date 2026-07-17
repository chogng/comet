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
import type {
	ManuscriptHashDomain,
} from 'cs/editor/common/core/hashPreimage';
import { hashCanonicalJson } from 'cs/editor/common/core/sha256';
import type {
	AcademicEntity,
	ClaimEntity,
	ClaimEvidenceRelation,
	EvidenceLink,
	EvidenceLocator,
	ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';
import type { ActorRef } from 'cs/editor/common/model/actor';
import type {
	DocumentNode,
	DocumentSemanticSettings,
	ManuscriptAuthor,
	Mark,
	TextNode,
} from 'cs/editor/common/model/manuscript';
import type {
	ManuscriptMerkleVectorPayload,
} from 'cs/editor/common/model/merkleVector';

export const manuscriptNodeHashAlgorithm = 'nireco-manuscript-node-1';
export const academicEntityHashAlgorithm = 'nireco-academic-entity-1';
export const academicGraphHashAlgorithm = 'nireco-academic-graph-1';
export const manuscriptMetadataHashAlgorithm = 'nireco-manuscript-metadata-1';
export const manuscriptSettingsHashAlgorithm = 'nireco-manuscript-settings-1';
export const documentMerkleHashAlgorithm = 'nireco-document-merkle-1';

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

type DocumentNodeWithChildren = Extract<
	DocumentNode,
	{ readonly children: readonly DocumentNode[] }
>;

type DocumentNodeWithoutChildren = Exclude<
	DocumentNode,
	TextNode | DocumentNodeWithChildren
>;

export type DocumentNodeLocalComparisonPayload =
	| {
		readonly id: NodeId;
		readonly type: 'text';
		readonly value: string;
		readonly marks: readonly CanonicalManuscriptMark[];
	}
	| {
		readonly id: NodeId;
		readonly type: Exclude<DocumentNode['type'], 'text'>;
		readonly attrs: Readonly<Record<string, CanonicalJsonValue>>;
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
		readonly type: DocumentNodeWithChildren['type'];
		readonly attrs: Readonly<Record<string, CanonicalJsonValue>>;
		readonly children: IMerkleVectorDescriptor;
	}
	| {
		readonly algorithm: typeof manuscriptNodeHashAlgorithm;
		readonly id: NodeId;
		readonly type: DocumentNodeWithoutChildren['type'];
		readonly attrs: Readonly<Record<string, CanonicalJsonValue>>;
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
	readonly schemaId: string;
	readonly schemaVersion: string;
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

export interface IMerkleVectorDescriptorSource {
	readonly count: number;
	readonly rootHash: ContentHash;
}

export function createMerkleVectorDescriptor(
	vector: IMerkleVectorDescriptorSource,
): IMerkleVectorDescriptor {
	return Object.freeze({
		count: vector.count,
		hash: vector.rootHash,
	});
}

export function createCanonicalManuscriptMark(
	mark: Mark,
): CanonicalManuscriptMark {
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

export function createDocumentNodeLocalComparisonPayload(
	node: DocumentNode,
): DocumentNodeLocalComparisonPayload {
	if (node.type === 'text') {
		return Object.freeze({
			id: node.id,
			type: node.type,
			value: node.value,
			marks: Object.freeze(node.marks.map(createCanonicalManuscriptMark)),
		});
	}
	return Object.freeze({
		id: node.id,
		type: node.type,
		attrs: encodeCanonicalRecord(node.attrs),
	});
}

export function createDocumentNodeHashPayload(
	node: TextNode,
): ManuscriptNodeHashPayload;
export function createDocumentNodeHashPayload(
	node: DocumentNodeWithChildren,
	children: IMerkleVectorDescriptor,
): ManuscriptNodeHashPayload;
export function createDocumentNodeHashPayload(
	node: DocumentNodeWithoutChildren,
): ManuscriptNodeHashPayload;
export function createDocumentNodeHashPayload(
	node: DocumentNode,
	children?: IMerkleVectorDescriptor,
): ManuscriptNodeHashPayload {
	if (node.type === 'text') {
		if (children !== undefined) {
			throw new TypeError(
				'Text node hash payloads cannot contain a child descriptor.',
			);
		}
		return Object.freeze({
			algorithm: manuscriptNodeHashAlgorithm,
			id: node.id,
			type: node.type,
			value: node.value,
			marks: Object.freeze(node.marks.map(createCanonicalManuscriptMark)),
		});
	}
	const ownsChildren = 'children' in node;
	if (ownsChildren !== (children !== undefined)) {
		throw new TypeError(
			ownsChildren
				? 'Container node hash payloads require a child descriptor.'
				: 'Leaf node hash payloads cannot contain a child descriptor.',
		);
	}
	return Object.freeze({
		algorithm: manuscriptNodeHashAlgorithm,
		id: node.id,
		type: node.type,
		attrs: encodeCanonicalRecord(node.attrs),
		...(children === undefined
			? {}
			: { children: cloneVectorDescriptor(children) }),
	}) as ManuscriptNodeHashPayload;
}

export function createMetadataTextHashPayload(
	field: 'title' | 'abstract',
	value: string,
): ManuscriptMetadataHashPayload {
	return Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		kind: 'text-field',
		field,
		value,
	});
}

export function createMetadataAuthorHashPayload(
	author: ManuscriptAuthor,
): ManuscriptMetadataHashPayload {
	return Object.freeze({
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
}

export function createMetadataKeywordHashPayload(
	keyword: string,
): ManuscriptMetadataHashPayload {
	return Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		kind: 'keyword',
		value: keyword,
	});
}

export function createMetadataRootHashPayload(
	titleHash: ContentHash,
	authors: IMerkleVectorDescriptor,
	abstractHash: ContentHash,
	keywords: IMerkleVectorDescriptor,
): ManuscriptMetadataHashPayload {
	return Object.freeze({
		algorithm: manuscriptMetadataHashAlgorithm,
		titleHash,
		authors: cloneVectorDescriptor(authors),
		abstractHash,
		keywords: cloneVectorDescriptor(keywords),
	});
}

export function createSettingsHashPayload(
	settings: DocumentSemanticSettings,
): ManuscriptSettingsHashPayload {
	return Object.freeze({
		algorithm: manuscriptSettingsHashAlgorithm,
		language: settings.language,
		citationStyle: settings.citationStyle,
		headingNumbering: settings.headingNumbering,
		bibliographyEnabled: settings.bibliographyEnabled,
	});
}

export function createAcademicEntityHashPayload(
	entity: AcademicEntity,
): AcademicEntityHashPayload {
	switch (entity.type) {
		case 'reference-snapshot':
			return createAcademicReferenceHashPayload(entity);
		case 'evidence-link':
			return createAcademicEvidenceHashPayload(entity);
		case 'claim':
			return createAcademicClaimHashPayload(entity);
	}
}

export function createAcademicReferenceHashPayload(
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

export function createAcademicEvidenceHashPayload(
	evidence: EvidenceLink,
): Extract<AcademicEntityHashPayload, { readonly type: 'evidence-link' }> {
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		id: evidence.id,
		type: evidence.type,
		sourceUri: encodeRuntimeUri(evidence.sourceUri),
		sourceContentHash: evidence.sourceContentHash,
		locator: createCanonicalEvidenceLocator(evidence.locator),
		...(evidence.excerpt === undefined
			? {}
			: { excerpt: evidence.excerpt }),
		verificationStatus: evidence.verificationStatus,
		...(evidence.verifiedBy === undefined
			? {}
			: { verifiedBy: cloneActor(evidence.verifiedBy) }),
		...(evidence.verifiedAt === undefined
			? {}
			: { verifiedAt: evidence.verifiedAt }),
	});
}

export function createAcademicClaimHashPayload(
	claim: ClaimEntity,
): Extract<AcademicEntityHashPayload, { readonly type: 'claim' }> {
	return Object.freeze({
		algorithm: academicEntityHashAlgorithm,
		id: claim.id,
		type: claim.type,
		anchor: createCanonicalPersistentAnchor(claim),
		textSnapshot: claim.textSnapshot,
	});
}

export function createAcademicRelationHashPayload(
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

export function createAcademicGraphHashPayload(
	referenceSnapshots: IMerkleVectorDescriptor,
	evidenceLinks: IMerkleVectorDescriptor,
	claims: IMerkleVectorDescriptor,
	claimEvidenceRelations: IMerkleVectorDescriptor,
): AcademicGraphHashPayload {
	return Object.freeze({
		algorithm: academicGraphHashAlgorithm,
		referenceSnapshots: cloneVectorDescriptor(referenceSnapshots),
		evidenceLinks: cloneVectorDescriptor(evidenceLinks),
		claims: cloneVectorDescriptor(claims),
		claimEvidenceRelations: cloneVectorDescriptor(claimEvidenceRelations),
	});
}

export function createDocumentMerkleHashPayload(options: {
	readonly schemaId: string;
	readonly schemaVersion: string;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
}): DocumentMerklePayload {
	return Object.freeze({
		algorithm: documentMerkleHashAlgorithm,
		schemaId: options.schemaId,
		schemaVersion: options.schemaVersion,
		metadataHash: options.metadataHash,
		rootNodeHash: options.rootNodeHash,
		academicGraphHash: options.academicGraphHash,
		settingsHash: options.settingsHash,
	});
}

export function hashRevisionMerklePayload(
	domain: ManuscriptHashDomain,
	payload: RevisionMerkleHashPayload,
	observer?: RevisionMerkleHashCallObserver,
): ContentHash {
	const result = hashCanonicalJson(domain, payload);
	if (result.type === 'error') {
		throw new TypeError(
			`Revision Merkle hash payload is not canonical JSON at ${result.path}.`,
		);
	}
	observer?.(Object.freeze({
		domain,
		payload,
		canonicalJson: result.canonicalJson,
		hash: result.hash,
	}));
	return result.hash;
}

function createCanonicalEvidenceLocator(
	locator: EvidenceLocator,
): EvidenceLocator {
	switch (locator.kind) {
		case 'page':
			return Object.freeze({
				kind: locator.kind,
				page: locator.page,
				...(locator.pageLabel === undefined
					? {}
					: { pageLabel: locator.pageLabel }),
			});
		case 'section':
			return Object.freeze({
				kind: locator.kind,
				section: locator.section,
			});
		case 'text-quote':
			return Object.freeze({
				kind: locator.kind,
				exact: locator.exact,
				...(locator.prefix === undefined
					? {}
					: { prefix: locator.prefix }),
				...(locator.suffix === undefined
					? {}
					: { suffix: locator.suffix }),
			});
		case 'time':
			return Object.freeze({
				kind: locator.kind,
				startSeconds: locator.startSeconds,
				...(locator.endSeconds === undefined
					? {}
					: { endSeconds: locator.endSeconds }),
			});
		case 'record':
			return Object.freeze({
				kind: locator.kind,
				recordKey: locator.recordKey,
			});
	}
}

function createCanonicalPersistentAnchor(
	claim: ClaimEntity,
): ICanonicalPersistentAnchor {
	return Object.freeze({
		document: Object.freeze({
			resource: encodeRuntimeUri(claim.anchor.document.resource),
			revisionId: claim.anchor.document.revisionId,
		}),
		primary: cloneSemanticPosition(claim.anchor.primary),
		...(claim.anchor.targetNodeId === undefined
			? {}
			: { targetNodeId: claim.anchor.targetNodeId }),
		...(claim.anchor.textQuote === undefined
			? {}
			: {
				textQuote: Object.freeze({
					exact: claim.anchor.textQuote.exact,
					...(claim.anchor.textQuote.prefix === undefined
						? {}
						: { prefix: claim.anchor.textQuote.prefix }),
					...(claim.anchor.textQuote.suffix === undefined
						? {}
						: { suffix: claim.anchor.textQuote.suffix }),
				}),
			}),
		...(claim.anchor.pathHint === undefined
			? {}
			: { pathHint: Object.freeze([...claim.anchor.pathHint]) }),
	});
}

function cloneSemanticPosition(position: SemanticPosition): SemanticPosition {
	return position.kind === 'text'
		? Object.freeze({
			kind: position.kind,
			textNodeId: position.textNodeId,
			utf16Offset: position.utf16Offset,
			affinity: position.affinity,
		})
		: Object.freeze({
			kind: position.kind,
			parentNodeId: position.parentNodeId,
			childIndex: position.childIndex,
			affinity: position.affinity,
		});
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

function cloneVectorDescriptor(
	descriptor: IMerkleVectorDescriptor,
): IMerkleVectorDescriptor {
	return Object.freeze({
		count: descriptor.count,
		hash: descriptor.hash,
	});
}

function encodeCanonicalRecord(
	value: object,
): Readonly<Record<string, CanonicalJsonValue>> {
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(
			'Revision Merkle hash payload has an unsupported record prototype.',
		);
	}
	const result: Record<string, CanonicalJsonValue> = Object.create(
		Object.prototype,
	);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Revision Merkle hash payload has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Revision Merkle hash payload has an unsafe property.');
		}
		Object.defineProperty(result, key, {
			value: encodeCanonicalValue(descriptor.value),
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
	throw new TypeError(
		'Revision Merkle hash payload contains a non-canonical value.',
	);
}

function encodeRuntimeUri(value: URI): string {
	const encoded = encodeCanonicalUri(value);
	if (encoded === undefined) {
		throw new TypeError(
			'Revision Merkle hash payload contains a non-canonical URI.',
		);
	}
	return encoded;
}
