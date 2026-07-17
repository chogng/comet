/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	captureBoundedClosedJson,
	type IBoundedClosedJsonLimits,
} from 'cs/editor/common/core/boundedClosedJson';
import {
	isWellFormedUnicodeString,
	type CanonicalJsonValue,
} from 'cs/editor/common/core/canonicalJson';
import {
	decodeCanonicalUri,
	encodeCanonicalUri,
} from 'cs/editor/common/core/canonicalUri';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	type EntityId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import {
	type DocumentNode,
	type DocumentSemanticSettings,
	type InsertableNode,
	type ManuscriptMetadata,
	type ManuscriptNode,
	type Mark,
	type NodeKind,
} from 'cs/editor/common/model/manuscript';

export interface IManuscriptTreeCodecLimits {
	readonly maximumNodes: number;
	readonly maximumDepth: number;
	readonly maximumCollectionItems: number;
}

export type ManuscriptSchemaFailure =
	| 'invalid-limits'
	| 'invalid-node'
	| 'unsupported-node-kind'
	| 'invalid-node-id'
	| 'duplicate-node-id'
	| 'node-budget-exceeded'
	| 'node-depth-exceeded'
	| 'collection-budget-exceeded'
	| 'invalid-node-attributes'
	| 'invalid-node-children'
	| 'section-heading-level-mismatch'
	| 'invalid-marks'
	| 'invalid-uri'
	| 'inspection-failed'
	| 'duplicate-entity-id'
	| 'invalid-metadata'
	| 'invalid-settings';

export type ManuscriptSchemaResult<T> =
	| {
		readonly type: 'ok';
		readonly value: T;
	}
	| {
		readonly type: 'error';
		readonly reason: ManuscriptSchemaFailure;
		readonly path: string;
	};

export interface IManuscriptEntityReference {
	readonly entityId: EntityId;
	readonly path: string;
}

export interface IManuscriptNodeReference {
	readonly nodeId: NodeId;
	readonly path: string;
}

export interface IDecodedManuscriptTree<TNode extends DocumentNode> {
	readonly root: TNode;
	readonly nodeCount: number;
	readonly declaredEntityIds: readonly EntityId[];
	readonly citationReferences: readonly IManuscriptEntityReference[];
	readonly crossReferences: readonly IManuscriptEntityReference[];
	readonly footnoteReferences: readonly IManuscriptNodeReference[];
	getNodeType(nodeId: NodeId): NodeKind | undefined;
}

export interface IDecodedManuscriptMetadata {
	readonly metadata: ManuscriptMetadata;
	readonly authorEntityIds: readonly EntityId[];
}

export type PersistedDocumentNodeV1 = Readonly<Record<string, CanonicalJsonValue>>;
export type PersistedManuscriptMetadataV1 = Readonly<
	Record<string, CanonicalJsonValue>
>;
export type PersistedDocumentSemanticSettingsV1 = Readonly<
	Record<string, CanonicalJsonValue>
>;
export type PersistedNodeAttributesV1 = Readonly<
	Record<string, CanonicalJsonValue>
>;
export type SettableManuscriptNodeAttributes = Exclude<
	InsertableNode,
	{ readonly type: 'text' }
>['attrs'];

export const maximumManuscriptTextUtf16Length = 1_000_000;

type ClosedJsonRecord = Readonly<Record<string, CanonicalJsonValue>>;
type RuntimeRecord = Readonly<Record<string, unknown>>;

type DecodeNodeFrame =
	| {
		readonly kind: 'enter';
		readonly value: CanonicalJsonValue;
		readonly path: string;
		readonly depth: number;
		readonly destination: DocumentNode[];
	}
	| {
		readonly kind: 'exit';
		readonly id: NodeId;
		readonly type: NodeKind;
		readonly attrs?: Readonly<Record<string, unknown>>;
		readonly textValue?: string;
		readonly marks?: readonly Mark[];
		readonly children: DocumentNode[];
		readonly destination: DocumentNode[];
	};

type EncodeNodeFrame =
	| {
		readonly kind: 'enter';
		readonly value: unknown;
		readonly path: string;
		readonly depth: number;
		readonly destination: PersistedDocumentNodeV1[];
	}
	| {
		readonly kind: 'exit';
		readonly source: object;
		readonly id: string;
		readonly type: NodeKind;
		readonly attrs?: ClosedJsonRecord;
		readonly textValue?: string;
		readonly marks?: readonly CanonicalJsonValue[];
		readonly children: PersistedDocumentNodeV1[];
		readonly destination: PersistedDocumentNodeV1[];
	};

interface ITreeDecodeState {
	readonly nodeIds: Set<NodeId>;
	readonly nodeTypesById: Map<NodeId, NodeKind>;
	readonly declaredEntityIds: EntityId[];
	readonly declaredEntityIdSet: Set<EntityId>;
	readonly citationReferences: IManuscriptEntityReference[];
	readonly crossReferences: IManuscriptEntityReference[];
	readonly footnoteReferences: IManuscriptNodeReference[];
	nodeCount: number;
}

const knownNodeTypes = new Set<NodeKind>([
	'bibliographyPlaceholder',
	'blockQuote',
	'body',
	'citation',
	'codeBlock',
	'crossReference',
	'displayEquation',
	'figure',
	'figureAsset',
	'figureCaption',
	'footnote',
	'footnoteReference',
	'frontMatter',
	'hardBreak',
	'heading',
	'horizontalRule',
	'inlineEquation',
	'list',
	'listItem',
	'manuscript',
	'paragraph',
	'section',
	'table',
	'tableCaption',
	'tableCell',
	'tableRow',
	'text',
]);
const childBearingNodeTypes = new Set<NodeKind>([
	'blockQuote',
	'body',
	'codeBlock',
	'figure',
	'figureCaption',
	'footnote',
	'frontMatter',
	'heading',
	'list',
	'listItem',
	'manuscript',
	'paragraph',
	'section',
	'table',
	'tableCaption',
	'tableCell',
	'tableRow',
]);
const blockNodeTypes = new Set<NodeKind>([
	'section',
	'paragraph',
	'heading',
	'figure',
	'table',
	'displayEquation',
	'blockQuote',
	'codeBlock',
	'list',
	'horizontalRule',
	'footnote',
]);
const sectionBodyNodeTypes = new Set<NodeKind>(
	[...blockNodeTypes].filter(type => type !== 'heading'),
);
const inlineNodeTypes = new Set<NodeKind>([
	'text',
	'citation',
	'crossReference',
	'inlineEquation',
	'footnoteReference',
	'hardBreak',
]);
const footnoteBlockNodeTypes = new Set<NodeKind>([
	'paragraph',
	'blockQuote',
	'codeBlock',
	'list',
]);
const cellBlockNodeTypes = new Set<NodeKind>([
	'paragraph',
	'blockQuote',
	'codeBlock',
	'list',
]);
const simpleMarkTypes = new Set<Exclude<Mark['type'], 'link'>>([
	'bold',
	'italic',
	'underline',
	'strike',
	'code',
	'subscript',
	'superscript',
]);
const markOrder = new Map<Mark['type'], number>(
	[
		'bold',
		'italic',
		'underline',
		'strike',
		'code',
		'link',
		'subscript',
		'superscript',
	].map((type, index) => [type as Mark['type'], index]),
);
const alignments = new Set(['start', 'center', 'end', 'justify']);
const citationLocatorLabels = new Set([
	'page',
	'chapter',
	'section',
	'paragraph',
	'figure',
	'table',
	'timestamp',
	'record',
]);
const languageTagPattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

export function decodeManuscriptRootV1(
	value: CanonicalJsonValue,
	limits: IManuscriptTreeCodecLimits,
	path = '$.root',
): ManuscriptSchemaResult<IDecodedManuscriptTree<ManuscriptNode>> {
	const decoded = decodeNodeTree(value, limits, path);
	if (decoded.type === 'error') {
		return decoded;
	}
	if (decoded.value.root.type !== 'manuscript') {
		return schemaError('invalid-node', `${path}.type`);
	}
	return {
		type: 'ok',
		value: decoded.value as IDecodedManuscriptTree<ManuscriptNode>,
	};
}

export function decodeInsertableNodeV1(
	value: CanonicalJsonValue,
	limits: IManuscriptTreeCodecLimits,
	path = '$.node',
): ManuscriptSchemaResult<IDecodedManuscriptTree<InsertableNode>> {
	const decoded = decodeNodeTree(value, limits, path);
	if (decoded.type === 'error') {
		return decoded;
	}
	if (decoded.value.root.type === 'manuscript') {
		return schemaError('invalid-node', `${path}.type`);
	}
	return {
		type: 'ok',
		value: decoded.value as IDecodedManuscriptTree<InsertableNode>,
	};
}

export function encodeManuscriptRootV1(
	value: unknown,
	limits: IManuscriptTreeCodecLimits,
	path = '$.root',
): ManuscriptSchemaResult<PersistedDocumentNodeV1> {
	try {
		const encoded = encodeNodeTree(value, limits, path);
		if (encoded.type === 'error') {
			return encoded;
		}
		const decoded = decodeManuscriptRootV1(encoded.value, limits, path);
		return decoded.type === 'error'
			? decoded
			: encoded;
	} catch {
		return schemaError('inspection-failed', path);
	}
}

export function encodeInsertableNodeV1(
	value: unknown,
	limits: IManuscriptTreeCodecLimits,
	path = '$.node',
): ManuscriptSchemaResult<PersistedDocumentNodeV1> {
	try {
		const encoded = encodeNodeTree(value, limits, path);
		if (encoded.type === 'error') {
			return encoded;
		}
		const decoded = decodeInsertableNodeV1(encoded.value, limits, path);
		return decoded.type === 'error'
			? decoded
			: encoded;
	} catch {
		return schemaError('inspection-failed', path);
	}
}

export function decodeNodeAttributesV1(
	value: CanonicalJsonValue,
	path = '$.attributes',
): ManuscriptSchemaResult<SettableManuscriptNodeAttributes> {
	for (const type of knownNodeTypes) {
		if (type === 'text') {
			continue;
		}
		const decoded = decodeNodeAttributes(type, value, path);
		if (decoded.type === 'ok') {
			return {
				type: 'ok',
				value: decoded.value as SettableManuscriptNodeAttributes,
			};
		}
	}
	return schemaError('invalid-node-attributes', path);
}

export function encodeNodeAttributesV1(
	value: unknown,
	path = '$.attributes',
): ManuscriptSchemaResult<PersistedNodeAttributesV1> {
	try {
		const inspected = inspectRuntimeRecord(
			value,
			path,
			'invalid-node-attributes',
		);
		if (inspected.type === 'error') {
			return inspected;
		}
		const externalized: Record<string, unknown> = {
			...inspected.value,
		};
		if (Object.hasOwn(externalized, 'uri')) {
			const uri = encodeCanonicalUri(externalized['uri']);
			if (uri === undefined) {
				return schemaError('invalid-uri', `${path}.uri`);
			}
			externalized['uri'] = uri;
		}
		const captured = captureRuntimeJson(
			externalized,
			nodeAttributeCaptureLimits(0),
			path,
		);
		if (captured.type === 'error') {
			return captured;
		}
		const decoded = decodeNodeAttributesV1(captured.value, path);
		const record = asRecord(captured.value);
		if (decoded.type === 'error') {
			return decoded;
		}
		return record === undefined
			? schemaError('invalid-node-attributes', path)
			: {
				type: 'ok',
				value: record,
			};
	} catch {
		return schemaError('inspection-failed', path);
	}
}

export function decodeMarksV1(
	value: CanonicalJsonValue,
	maximumCollectionItems: number,
	path = '$.marks',
): ManuscriptSchemaResult<readonly Mark[]> {
	if (!isNonnegativeSafeInteger(maximumCollectionItems)) {
		return schemaError('invalid-limits', '$limits.maximumCollectionItems');
	}
	return decodeMarks(value, maximumCollectionItems, path);
}

export function encodeMarksV1(
	value: unknown,
	maximumCollectionItems: number,
	path = '$.marks',
): ManuscriptSchemaResult<readonly CanonicalJsonValue[]> {
	if (!isNonnegativeSafeInteger(maximumCollectionItems)) {
		return schemaError('invalid-limits', '$limits.maximumCollectionItems');
	}
	try {
		const encoded = encodeRuntimeMarks(
			value,
			maximumCollectionItems,
			path,
		);
		if (encoded.type === 'error') {
			return encoded;
		}
		const decoded = decodeMarks(encoded.value, maximumCollectionItems, path);
		return decoded.type === 'error'
			? decoded
			: encoded;
	} catch {
		return schemaError('inspection-failed', path);
	}
}

export function decodeManuscriptMetadataV1(
	value: CanonicalJsonValue,
	maximumCollectionItems: number,
	path = '$.metadata',
): ManuscriptSchemaResult<IDecodedManuscriptMetadata> {
	if (!isNonnegativeSafeInteger(maximumCollectionItems)) {
		return schemaError('invalid-limits', '$limits.maximumCollectionItems');
	}
	const record = readExactRecord(
		value,
		['title', 'authors', 'abstract', 'keywords'],
		['title', 'authors', 'abstract', 'keywords'],
	);
	if (
		record === undefined
		|| !isBoundedString(record['title'], 0, 2_048)
		|| !isBoundedString(record['abstract'], 0, 100_000)
	) {
		return schemaError('invalid-metadata', path);
	}
	const authors = readArray(record['authors']);
	const keywords = readArray(record['keywords']);
	if (authors === undefined || keywords === undefined) {
		return schemaError('invalid-metadata', path);
	}
	if (
		authors.length > maximumCollectionItems
		|| keywords.length > maximumCollectionItems
		|| authors.length > 1_024
		|| keywords.length > 1_024
	) {
		return schemaError('collection-budget-exceeded', path);
	}

	const decodedAuthors: ManuscriptMetadata['authors'][number][] = [];
	const authorEntityIds: EntityId[] = [];
	const authorIdSet = new Set<EntityId>();
	for (let index = 0; index < authors.length; index += 1) {
		const authorPath = `${path}.authors[${index}]`;
		const author = decodeAuthor(
			authors[index],
			maximumCollectionItems,
			authorPath,
		);
		if (author.type === 'error') {
			return author;
		}
		if (author.value.id !== undefined) {
			if (authorIdSet.has(author.value.id)) {
				return schemaError('duplicate-entity-id', `${authorPath}.id`);
			}
			authorIdSet.add(author.value.id);
			authorEntityIds.push(author.value.id);
		}
		decodedAuthors.push(author.value);
	}

	const decodedKeywords: string[] = [];
	let previousKeyword: string | undefined;
	for (let index = 0; index < keywords.length; index += 1) {
		const keyword = keywords[index];
		if (
			!isBoundedString(keyword, 1, 512)
			|| (
				previousKeyword !== undefined
				&& compareUnicodeCodePoints(previousKeyword, keyword) >= 0
			)
		) {
			return schemaError('invalid-metadata', `${path}.keywords[${index}]`);
		}
		decodedKeywords.push(keyword);
		previousKeyword = keyword;
	}

	return {
		type: 'ok',
		value: Object.freeze({
			metadata: Object.freeze({
				title: record['title'],
				authors: Object.freeze(decodedAuthors),
				abstract: record['abstract'],
				keywords: Object.freeze(decodedKeywords),
			}),
			authorEntityIds: Object.freeze(authorEntityIds),
		}),
	};
}

export function encodeManuscriptMetadataV1(
	value: unknown,
	maximumCollectionItems: number,
	path = '$.metadata',
): ManuscriptSchemaResult<PersistedManuscriptMetadataV1> {
	if (!isNonnegativeSafeInteger(maximumCollectionItems)) {
		return schemaError('invalid-limits', '$limits.maximumCollectionItems');
	}
	const captured = captureBoundedClosedJson(
		value,
		metadataCaptureLimits(maximumCollectionItems),
	);
	if (captured.type === 'invalid') {
		return schemaError(
			captured.reason === 'inspection-failed'
				? 'inspection-failed'
				: 'collection-budget-exceeded',
			captured.path === '$' ? path : `${path}${captured.path.slice(1)}`,
		);
	}
	const decoded = decodeManuscriptMetadataV1(
		captured.value,
		maximumCollectionItems,
		path,
	);
	return decoded.type === 'error'
		? decoded
		: {
			type: 'ok',
			value: freezeCapturedJson(
				captured.value,
			) as PersistedManuscriptMetadataV1,
		};
}

export function decodeDocumentSemanticSettingsV1(
	value: CanonicalJsonValue,
	path = '$.settings',
): ManuscriptSchemaResult<DocumentSemanticSettings> {
	const record = readExactRecord(
		value,
		[
			'language',
			'citationStyle',
			'headingNumbering',
			'bibliographyEnabled',
		],
		[
			'language',
			'citationStyle',
			'headingNumbering',
			'bibliographyEnabled',
		],
	);
	if (
		record === undefined
		|| typeof record['language'] !== 'string'
		|| !languageTagPattern.test(record['language'])
		|| !isBoundedString(record['citationStyle'], 1, 256)
		|| typeof record['headingNumbering'] !== 'boolean'
		|| typeof record['bibliographyEnabled'] !== 'boolean'
	) {
		return schemaError('invalid-settings', path);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			language: record['language'],
			citationStyle: record['citationStyle'],
			headingNumbering: record['headingNumbering'],
			bibliographyEnabled: record['bibliographyEnabled'],
		}),
	};
}

export function encodeDocumentSemanticSettingsV1(
	value: unknown,
	path = '$.settings',
): ManuscriptSchemaResult<PersistedDocumentSemanticSettingsV1> {
	const captured = captureBoundedClosedJson(value, settingsCaptureLimits);
	if (captured.type === 'invalid') {
		return schemaError(
			captured.reason === 'inspection-failed'
				? 'inspection-failed'
				: 'collection-budget-exceeded',
			captured.path === '$' ? path : `${path}${captured.path.slice(1)}`,
		);
	}
	const decoded = decodeDocumentSemanticSettingsV1(captured.value, path);
	return decoded.type === 'error'
		? decoded
		: {
			type: 'ok',
			value: freezeCapturedJson(
				captured.value,
			) as PersistedDocumentSemanticSettingsV1,
		};
}

function decodeNodeTree(
	value: CanonicalJsonValue,
	limits: IManuscriptTreeCodecLimits,
	path: string,
): ManuscriptSchemaResult<IDecodedManuscriptTree<DocumentNode>> {
	if (!hasValidTreeLimits(limits)) {
		return schemaError('invalid-limits', '$limits');
	}
	const state: ITreeDecodeState = {
		nodeIds: new Set<NodeId>(),
		nodeTypesById: new Map<NodeId, NodeKind>(),
		declaredEntityIds: [],
		declaredEntityIdSet: new Set<EntityId>(),
		citationReferences: [],
		crossReferences: [],
		footnoteReferences: [],
		nodeCount: 0,
	};
	const roots: DocumentNode[] = [];
	const pending: DecodeNodeFrame[] = [{
		kind: 'enter',
		value,
		path,
		depth: 0,
		destination: roots,
	}];

	while (pending.length > 0) {
		const frame = pending.pop();
		if (frame === undefined) {
			break;
		}
		if (frame.kind === 'exit') {
			const node = createDecodedNode(frame);
			frame.destination.push(node);
			continue;
		}

		if (frame.depth > limits.maximumDepth) {
			return schemaError('node-depth-exceeded', frame.path);
		}
		if (state.nodeCount >= limits.maximumNodes) {
			return schemaError('node-budget-exceeded', frame.path);
		}
		const record = asRecord(frame.value);
		if (record === undefined) {
			return schemaError('invalid-node', frame.path);
		}
		const rawType = record['type'];
		if (typeof rawType !== 'string' || !knownNodeTypes.has(rawType as NodeKind)) {
			return schemaError('unsupported-node-kind', `${frame.path}.type`);
		}
		const type = rawType as NodeKind;
		const rawId = record['id'];
		const parsedId = typeof rawId === 'string' ? parseNodeId(rawId) : undefined;
		if (parsedId === undefined || parsedId.type === 'invalid') {
			return schemaError('invalid-node-id', `${frame.path}.id`);
		}
		const id = parsedId.value;
		if (state.nodeIds.has(id)) {
			return schemaError('duplicate-node-id', `${frame.path}.id`);
		}

		const expectedKeys = type === 'text'
			? ['id', 'type', 'value', 'marks']
			: childBearingNodeTypes.has(type)
				? ['id', 'type', 'attrs', 'children']
				: ['id', 'type', 'attrs'];
		if (!hasExactKeys(record, expectedKeys, expectedKeys)) {
			return schemaError('invalid-node', frame.path);
		}

		let attrs: Readonly<Record<string, unknown>> | undefined;
		let textValue: string | undefined;
		let marks: readonly Mark[] | undefined;
		if (type === 'text') {
			if (
				!isBoundedString(
					record['value'],
					0,
					maximumManuscriptTextUtf16Length,
				)
			) {
				return schemaError('invalid-node', `${frame.path}.value`);
			}
			const decodedMarks = decodeMarks(
				record['marks'],
				limits.maximumCollectionItems,
				`${frame.path}.marks`,
			);
			if (decodedMarks.type === 'error') {
				return decodedMarks;
			}
			textValue = record['value'];
			marks = decodedMarks.value;
		} else {
			const decodedAttrs = decodeNodeAttributes(
				type,
				record['attrs'],
				`${frame.path}.attrs`,
			);
			if (decodedAttrs.type === 'error') {
				return decodedAttrs;
			}
			attrs = decodedAttrs.value;
		}

		const rawChildren = childBearingNodeTypes.has(type)
			? readArray(record['children'])
			: [];
		if (rawChildren === undefined) {
			return schemaError('invalid-node-children', `${frame.path}.children`);
		}
		if (rawChildren.length > limits.maximumCollectionItems) {
			return schemaError(
				'collection-budget-exceeded',
				`${frame.path}.children`,
			);
		}
		const childTypes = readChildTypes(rawChildren);
		if (
			childTypes === undefined
			|| !hasValidChildren(type, childTypes)
		) {
			return schemaError('invalid-node-children', `${frame.path}.children`);
		}
		if (
			type === 'section'
			&& !sectionHeadingLevelMatches(attrs, rawChildren[0])
		) {
			return schemaError(
				'section-heading-level-mismatch',
				`${frame.path}.children[0].attrs.level`,
			);
		}

		state.nodeCount += 1;
		state.nodeIds.add(id);
		state.nodeTypesById.set(id, type);
		const references = collectNodeReferences(
			type,
			attrs,
			frame.path,
			state,
		);
		if (references.type === 'error') {
			return references;
		}

		const children: DocumentNode[] = [];
		pending.push({
			kind: 'exit',
			id,
			type,
			attrs,
			textValue,
			marks,
			children,
			destination: frame.destination,
		});
		for (let index = rawChildren.length - 1; index >= 0; index -= 1) {
			const child = rawChildren[index];
			if (child !== undefined) {
				pending.push({
					kind: 'enter',
					value: child,
					path: `${frame.path}.children[${index}]`,
					depth: frame.depth + 1,
					destination: children,
				});
			}
		}
	}

	const root = roots[0];
	if (root === undefined || roots.length !== 1) {
		return schemaError('invalid-node', path);
	}
	const nodeTypesById = state.nodeTypesById;
	return {
		type: 'ok',
		value: Object.freeze({
			root,
			nodeCount: state.nodeCount,
			declaredEntityIds: Object.freeze([...state.declaredEntityIds]),
			citationReferences: freezeEntityReferences(state.citationReferences),
			crossReferences: freezeEntityReferences(state.crossReferences),
			footnoteReferences: Object.freeze(
				state.footnoteReferences.map(reference => Object.freeze({
					nodeId: reference.nodeId,
					path: reference.path,
				})),
			),
			getNodeType: (nodeId: NodeId) => nodeTypesById.get(nodeId),
		}),
	};
}

function createDecodedNode(frame: Extract<DecodeNodeFrame, { readonly kind: 'exit' }>): DocumentNode {
	if (frame.type === 'text') {
		if (frame.textValue === undefined || frame.marks === undefined) {
			throw new Error('Decoded Text node fields were not installed.');
		}
		return Object.freeze({
			id: frame.id,
			type: frame.type,
			value: frame.textValue,
			marks: frame.marks,
		});
	}
	if (frame.attrs === undefined) {
		throw new Error('Decoded Manuscript node attributes were not installed.');
	}
	const node = {
		id: frame.id,
		type: frame.type,
		attrs: frame.attrs,
		...(childBearingNodeTypes.has(frame.type)
			? { children: Object.freeze([...frame.children]) }
			: {}),
	};
	return Object.freeze(node) as unknown as DocumentNode;
}

function encodeNodeTree(
	value: unknown,
	limits: IManuscriptTreeCodecLimits,
	path: string,
): ManuscriptSchemaResult<PersistedDocumentNodeV1> {
	if (!hasValidTreeLimits(limits)) {
		return schemaError('invalid-limits', '$limits');
	}
	const roots: PersistedDocumentNodeV1[] = [];
	const activeNodes = new Set<object>();
	let nodeCount = 0;
	const pending: EncodeNodeFrame[] = [{
		kind: 'enter',
		value,
		path,
		depth: 0,
		destination: roots,
	}];
	while (pending.length > 0) {
		const frame = pending.pop();
		if (frame === undefined) {
			break;
		}
		if (frame.kind === 'exit') {
			activeNodes.delete(frame.source);
			let encoded: PersistedDocumentNodeV1;
			if (frame.type === 'text') {
				if (frame.textValue === undefined || frame.marks === undefined) {
					return schemaError('inspection-failed', path);
				}
				encoded = Object.freeze({
					id: frame.id,
					type: frame.type,
					value: frame.textValue,
					marks: frame.marks,
				});
			} else {
				if (frame.attrs === undefined) {
					return schemaError('inspection-failed', path);
				}
				encoded = Object.freeze({
					id: frame.id,
					type: frame.type,
					attrs: frame.attrs,
					...(childBearingNodeTypes.has(frame.type)
						? { children: Object.freeze([...frame.children]) }
						: {}),
				});
			}
			frame.destination.push(encoded);
			continue;
		}

		if (frame.depth > limits.maximumDepth) {
			return schemaError('node-depth-exceeded', frame.path);
		}
		if (nodeCount >= limits.maximumNodes) {
			return schemaError('node-budget-exceeded', frame.path);
		}
		const inspectedNode = inspectRuntimeRecord(
			frame.value,
			frame.path,
			'invalid-node',
		);
		if (inspectedNode.type === 'error') {
			return inspectedNode;
		}
		if (activeNodes.has(inspectedNode.source)) {
			return schemaError('inspection-failed', frame.path);
		}
		const record = inspectedNode.value;
		const rawType = record['type'];
		if (typeof rawType !== 'string' || !knownNodeTypes.has(rawType as NodeKind)) {
			return schemaError('unsupported-node-kind', `${frame.path}.type`);
		}
		const type = rawType as NodeKind;
		const expectedKeys = type === 'text'
			? ['id', 'type', 'value', 'marks']
			: childBearingNodeTypes.has(type)
				? ['id', 'type', 'attrs', 'children']
				: ['id', 'type', 'attrs'];
		if (!hasExactKeys(record, expectedKeys, expectedKeys)) {
			return schemaError('invalid-node', frame.path);
		}
		const id = record['id'];
		if (typeof id !== 'string') {
			return schemaError('invalid-node-id', `${frame.path}.id`);
		}

		let attrs: ClosedJsonRecord | undefined;
		let textValue: string | undefined;
		let marks: readonly CanonicalJsonValue[] | undefined;
		if (type === 'text') {
			if (
				!isBoundedString(
					record['value'],
					0,
					maximumManuscriptTextUtf16Length,
				)
			) {
				return schemaError('invalid-node', `${frame.path}.value`);
			}
			const encodedMarks = encodeRuntimeMarks(
				record['marks'],
				limits.maximumCollectionItems,
				`${frame.path}.marks`,
			);
			if (encodedMarks.type === 'error') {
				return encodedMarks;
			}
			textValue = record['value'];
			marks = encodedMarks.value;
		} else {
			const encodedAttrs = encodeRuntimeNodeAttributes(
				type,
				record['attrs'],
				limits.maximumCollectionItems,
				`${frame.path}.attrs`,
			);
			if (encodedAttrs.type === 'error') {
				return encodedAttrs;
			}
			attrs = encodedAttrs.value;
		}

		const inspectedChildren = childBearingNodeTypes.has(type)
			? inspectRuntimeArray(
				record['children'],
				limits.maximumCollectionItems,
				`${frame.path}.children`,
				'invalid-node-children',
			)
			: {
				type: 'ok' as const,
				value: Object.freeze([]) as readonly unknown[],
			};
		if (inspectedChildren.type === 'error') {
			return inspectedChildren;
		}

		const children: PersistedDocumentNodeV1[] = [];
		activeNodes.add(inspectedNode.source);
		nodeCount += 1;
		pending.push({
			kind: 'exit',
			source: inspectedNode.source,
			id,
			type,
			attrs,
			textValue,
			marks,
			children,
			destination: frame.destination,
		});
		for (
			let index = inspectedChildren.value.length - 1;
			index >= 0;
			index -= 1
		) {
			const child = inspectedChildren.value[index];
			if (child !== undefined) {
				pending.push({
					kind: 'enter',
					value: child,
					path: `${frame.path}.children[${index}]`,
					depth: frame.depth + 1,
					destination: children,
				});
			}
		}
	}
	const root = roots[0];
	if (root === undefined) {
		return schemaError('invalid-node', path);
	}
	return {
		type: 'ok',
		value: root,
	};
}

function encodeRuntimeNodeAttributes(
	type: Exclude<NodeKind, 'text'>,
	value: unknown,
	maximumCollectionItems: number,
	path: string,
): ManuscriptSchemaResult<ClosedJsonRecord> {
	const inspected = inspectRuntimeRecord(
		value,
		path,
		'invalid-node-attributes',
	);
	if (inspected.type === 'error') {
		return inspected;
	}
	const externalized: Record<string, unknown> = {
		...inspected.value,
	};
	if (type === 'figureAsset' && Object.hasOwn(externalized, 'uri')) {
		const uri = encodeCanonicalUri(externalized['uri']);
		if (uri === undefined) {
			return schemaError('invalid-uri', `${path}.uri`);
		}
		externalized['uri'] = uri;
	}
	const captured = captureRuntimeJson(
		externalized,
		nodeAttributeCaptureLimits(maximumCollectionItems),
		path,
	);
	if (captured.type === 'error') {
		return captured;
	}
	const record = asRecord(captured.value);
	return record === undefined
		? schemaError('invalid-node-attributes', path)
		: {
			type: 'ok',
			value: record,
		};
}

function encodeRuntimeMarks(
	value: unknown,
	maximumCollectionItems: number,
	path: string,
): ManuscriptSchemaResult<readonly CanonicalJsonValue[]> {
	const inspected = inspectRuntimeArray(
		value,
		maximumCollectionItems,
		path,
		'invalid-marks',
	);
	if (inspected.type === 'error') {
		return inspected;
	}
	const encoded: CanonicalJsonValue[] = [];
	for (let index = 0; index < inspected.value.length; index += 1) {
		const markPath = `${path}[${index}]`;
		const inspectedMark = inspectRuntimeRecord(
			inspected.value[index],
			markPath,
			'invalid-marks',
		);
		if (inspectedMark.type === 'error') {
			return inspectedMark;
		}
		const externalized: Record<string, unknown> = {
			...inspectedMark.value,
		};
		if (
			externalized['type'] === 'link'
			&& Object.hasOwn(externalized, 'href')
		) {
			const href = encodeCanonicalUri(externalized['href']);
			if (href === undefined) {
				return schemaError('invalid-uri', `${markPath}.href`);
			}
			externalized['href'] = href;
		}
		const captured = captureRuntimeJson(
			externalized,
			markCaptureLimits,
			markPath,
		);
		if (captured.type === 'error') {
			return captured;
		}
		encoded.push(captured.value);
	}
	return {
		type: 'ok',
		value: Object.freeze(encoded),
	};
}

function captureRuntimeJson(
	value: unknown,
	limits: IBoundedClosedJsonLimits,
	path: string,
): ManuscriptSchemaResult<CanonicalJsonValue> {
	const captured = captureBoundedClosedJson(value, limits);
	if (captured.type === 'invalid') {
		return schemaError(
			captured.reason === 'inspection-failed'
				? 'inspection-failed'
				: 'collection-budget-exceeded',
			captured.path === '$' ? path : `${path}${captured.path.slice(1)}`,
		);
	}
	return {
		type: 'ok',
		value: freezeCapturedJson(captured.value),
	};
}

function inspectRuntimeRecord(
	value: unknown,
	path: string,
	shapeFailure: ManuscriptSchemaFailure,
):
	| {
		readonly type: 'ok';
		readonly value: RuntimeRecord;
		readonly source: object;
	}
	| Extract<ManuscriptSchemaResult<never>, { readonly type: 'error' }> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return schemaError(shapeFailure, path);
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return schemaError('inspection-failed', path);
	}
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			return schemaError('inspection-failed', path);
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return schemaError('inspection-failed', runtimePropertyPath(path, key));
		}
		result[key] = descriptor.value;
	}
	return {
		type: 'ok',
		value: result,
		source: value,
	};
}

function inspectRuntimeArray(
	value: unknown,
	maximumCollectionItems: number,
	path: string,
	shapeFailure: ManuscriptSchemaFailure,
):
	| {
		readonly type: 'ok';
		readonly value: readonly unknown[];
	}
	| Extract<ManuscriptSchemaResult<never>, { readonly type: 'error' }> {
	if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) {
		return schemaError(shapeFailure, path);
	}
	const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| typeof lengthDescriptor.value !== 'number'
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| lengthDescriptor.value < 0
	) {
		return schemaError('inspection-failed', path);
	}
	const length = lengthDescriptor.value;
	if (length > maximumCollectionItems) {
		return schemaError('collection-budget-exceeded', path);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== length + 1 || !keys.includes('length')) {
		return schemaError('inspection-failed', path);
	}
	const keySet = new Set<PropertyKey>(keys);
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const key = String(index);
		if (!keySet.has(key)) {
			return schemaError('inspection-failed', `${path}[${index}]`);
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return schemaError('inspection-failed', `${path}[${index}]`);
		}
		result.push(descriptor.value);
	}
	if (
		keys.some(key =>
			key !== 'length'
			&& (
				typeof key !== 'string'
				|| !/^(?:0|[1-9]\d*)$/u.test(key)
				|| Number(key) >= length
			)
		)
	) {
		return schemaError('inspection-failed', path);
	}
	return {
		type: 'ok',
		value: Object.freeze(result),
	};
}

function freezeCapturedJson(value: CanonicalJsonValue): CanonicalJsonValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(item => freezeCapturedJson(item)));
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Captured JSON record has an unsupported prototype.');
	}
	const record: Record<string, CanonicalJsonValue> = Object.create(
		Object.prototype,
	);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Captured JSON record has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Captured JSON record has an unsafe property.');
		}
		Object.defineProperty(record, key, {
			value: freezeCapturedJson(descriptor.value),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return Object.freeze(record);
}

function runtimePropertyPath(parent: string, key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
		? `${parent}.${key}`
		: `${parent}[${JSON.stringify(key.slice(0, 128))}]`;
}

function nodeAttributeCaptureLimits(
	maximumCollectionItems: number,
): IBoundedClosedJsonLimits {
	return {
		maximumDepth: 8,
		maximumValues: saturatingScale(maximumCollectionItems, 4, 128),
		maximumArrayLength: maximumCollectionItems,
		maximumObjectProperties: Math.max(
			16,
			Math.min(maximumCollectionItems, 1_024),
		),
		maximumCanonicalUtf8Bytes: Number.MAX_SAFE_INTEGER,
	};
}

function metadataCaptureLimits(
	maximumCollectionItems: number,
): IBoundedClosedJsonLimits {
	const maximumArrayLength = Math.min(maximumCollectionItems, 1_024);
	return {
		maximumDepth: 8,
		maximumValues: saturatingScale(
			maximumArrayLength,
			maximumArrayLength + 10,
			128,
		),
		maximumArrayLength,
		maximumObjectProperties: 16,
		maximumCanonicalUtf8Bytes: Number.MAX_SAFE_INTEGER,
	};
}

function saturatingScale(
	value: number,
	multiplier: number,
	addend: number,
): number {
	const product = value * multiplier + addend;
	return Number.isSafeInteger(product)
		? product
		: Number.MAX_SAFE_INTEGER;
}

const markCaptureLimits: IBoundedClosedJsonLimits = Object.freeze({
	maximumDepth: 2,
	maximumValues: 16,
	maximumArrayLength: 0,
	maximumObjectProperties: 4,
	maximumCanonicalUtf8Bytes: Number.MAX_SAFE_INTEGER,
});

const settingsCaptureLimits: IBoundedClosedJsonLimits = Object.freeze({
	maximumDepth: 2,
	maximumValues: 16,
	maximumArrayLength: 0,
	maximumObjectProperties: 8,
	maximumCanonicalUtf8Bytes: Number.MAX_SAFE_INTEGER,
});

function decodeNodeAttributes(
	type: Exclude<NodeKind, 'text'>,
	value: CanonicalJsonValue,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const record = asRecord(value);
	if (record === undefined) {
		return schemaError('invalid-node-attributes', path);
	}
	switch (type) {
		case 'bibliographyPlaceholder':
			return exactAttrs(record, ['heading'], ['heading'], path, attrs =>
				isBoundedString(attrs['heading'], 0, 1_024));
		case 'blockQuote':
		case 'body':
		case 'figureCaption':
		case 'frontMatter':
		case 'hardBreak':
		case 'horizontalRule':
		case 'listItem':
		case 'manuscript':
		case 'tableCaption':
		case 'tableCell':
		case 'tableRow':
			return exactAttrs(record, [], [], path, () => true);
		case 'citation':
			return decodeCitationAttributes(record, path);
		case 'codeBlock':
			return exactAttrs(record, ['language'], [], path, attrs =>
				!Object.hasOwn(attrs, 'language')
				|| isBoundedString(attrs['language'], 0, 128));
		case 'crossReference':
			return decodeCrossReferenceAttributes(record, path);
		case 'displayEquation':
			return decodeDisplayEquationAttributes(record, path);
		case 'figure':
		case 'table':
			return decodeLabeledEntityAttributes(record, path);
		case 'figureAsset':
			return decodeFigureAssetAttributes(record, path);
		case 'footnote':
			return exactAttrs(record, ['label'], [], path, attrs =>
				!Object.hasOwn(attrs, 'label')
				|| isBoundedString(attrs['label'], 0, 128));
		case 'footnoteReference':
			return decodeFootnoteReferenceAttributes(record, path);
		case 'heading':
		case 'section':
			return exactAttrs(record, ['level'], ['level'], path, attrs =>
				isIntegerInRange(attrs['level'], 1, 6));
		case 'inlineEquation':
			return exactAttrs(record, ['source'], ['source'], path, attrs =>
				isBoundedString(attrs['source'], 0, 1_000_000));
		case 'list':
			return decodeListAttributes(record, path);
		case 'paragraph':
			return exactAttrs(
				record,
				['alignment'],
				['alignment'],
				path,
				attrs =>
					typeof attrs['alignment'] === 'string'
					&& alignments.has(attrs['alignment']),
			);
	}
}

function decodeCitationAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(
		record,
		['citationId', 'referenceId', 'locator', 'prefix', 'suffix'],
		['citationId', 'referenceId'],
	);
	const citationId = parseEntityIdValue(attrs?.['citationId']);
	const referenceId = parseEntityIdValue(attrs?.['referenceId']);
	if (attrs === undefined || citationId === undefined || referenceId === undefined) {
		return schemaError('invalid-node-attributes', path);
	}
	let locator: Readonly<Record<string, unknown>> | undefined;
	if (Object.hasOwn(attrs, 'locator')) {
		const decodedLocator = decodeCitationLocator(attrs['locator']);
		if (decodedLocator === undefined) {
			return schemaError('invalid-node-attributes', `${path}.locator`);
		}
		locator = decodedLocator;
	}
	if (
		(Object.hasOwn(attrs, 'prefix') && !isBoundedString(attrs['prefix'], 0, 10_000))
		|| (Object.hasOwn(attrs, 'suffix') && !isBoundedString(attrs['suffix'], 0, 10_000))
	) {
		return schemaError('invalid-node-attributes', path);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			citationId,
			referenceId,
			...(locator === undefined ? {} : { locator }),
			...(Object.hasOwn(attrs, 'prefix') ? { prefix: attrs['prefix'] } : {}),
			...(Object.hasOwn(attrs, 'suffix') ? { suffix: attrs['suffix'] } : {}),
		}),
	};
}

function decodeCrossReferenceAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(
		record,
		['targetEntityId', 'label'],
		['targetEntityId'],
	);
	const targetEntityId = parseEntityIdValue(attrs?.['targetEntityId']);
	if (
		attrs === undefined
		|| targetEntityId === undefined
		|| (
			Object.hasOwn(attrs, 'label')
			&& !isBoundedString(attrs['label'], 0, 1_024)
		)
	) {
		return schemaError('invalid-node-attributes', path);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			targetEntityId,
			...(Object.hasOwn(attrs, 'label') ? { label: attrs['label'] } : {}),
		}),
	};
}

function decodeDisplayEquationAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(
		record,
		['source', 'entityId', 'label'],
		['source'],
	);
	const entityId = Object.hasOwn(attrs ?? {}, 'entityId')
		? parseEntityIdValue(attrs?.['entityId'])
		: undefined;
	if (
		attrs === undefined
		|| !isBoundedString(attrs['source'], 0, 1_000_000)
		|| (Object.hasOwn(attrs, 'entityId') && entityId === undefined)
		|| (
			Object.hasOwn(attrs, 'label')
			&& !isBoundedString(attrs['label'], 0, 256)
		)
	) {
		return schemaError('invalid-node-attributes', path);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			source: attrs['source'],
			...(entityId === undefined ? {} : { entityId }),
			...(Object.hasOwn(attrs, 'label') ? { label: attrs['label'] } : {}),
		}),
	};
}

function decodeLabeledEntityAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(record, ['entityId', 'label'], []);
	const entityId = Object.hasOwn(attrs ?? {}, 'entityId')
		? parseEntityIdValue(attrs?.['entityId'])
		: undefined;
	if (
		attrs === undefined
		|| (Object.hasOwn(attrs, 'entityId') && entityId === undefined)
		|| (
			Object.hasOwn(attrs, 'label')
			&& !isBoundedString(attrs['label'], 0, 256)
		)
	) {
		return schemaError('invalid-node-attributes', path);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			...(entityId === undefined ? {} : { entityId }),
			...(Object.hasOwn(attrs, 'label') ? { label: attrs['label'] } : {}),
		}),
	};
}

function decodeFigureAssetAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(
		record,
		['uri', 'contentHash', 'altText'],
		['uri', 'contentHash', 'altText'],
	);
	const uri = decodeCanonicalUri(attrs?.['uri']);
	const contentHash = typeof attrs?.['contentHash'] === 'string'
		? parseContentHash(attrs['contentHash'])
		: undefined;
	if (
		attrs === undefined
		|| uri === undefined
		|| contentHash === undefined
		|| contentHash.type === 'invalid'
		|| !isBoundedString(attrs['altText'], 0, 10_000)
	) {
		return schemaError(
			uri === undefined ? 'invalid-uri' : 'invalid-node-attributes',
			uri === undefined ? `${path}.uri` : path,
		);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			uri,
			contentHash: contentHash.value,
			altText: attrs['altText'],
		}),
	};
}

function decodeFootnoteReferenceAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(
		record,
		['footnoteNodeId'],
		['footnoteNodeId'],
	);
	const footnoteNodeId = parseNodeIdValue(attrs?.['footnoteNodeId']);
	return attrs === undefined || footnoteNodeId === undefined
		? schemaError('invalid-node-attributes', path)
		: {
			type: 'ok',
			value: Object.freeze({ footnoteNodeId }),
		};
}

function decodeListAttributes(
	record: ClosedJsonRecord,
	path: string,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	if (record['ordered'] === true) {
		const attrs = readExactRecord(record, ['ordered', 'start'], ['ordered', 'start']);
		return attrs !== undefined && isIntegerInRange(attrs['start'], 1)
			? {
				type: 'ok',
				value: Object.freeze({
					ordered: true,
					start: attrs['start'],
				}),
			}
			: schemaError('invalid-node-attributes', path);
	}
	const attrs = readExactRecord(record, ['ordered'], ['ordered']);
	return attrs !== undefined && attrs['ordered'] === false
		? {
			type: 'ok',
			value: Object.freeze({
				ordered: false,
			}),
		}
		: schemaError('invalid-node-attributes', path);
}

function decodeCitationLocator(
	value: CanonicalJsonValue,
): Readonly<Record<string, unknown>> | undefined {
	const locator = readExactRecord(value, ['label', 'value'], ['label', 'value']);
	return (
		locator !== undefined
		&& typeof locator['label'] === 'string'
		&& citationLocatorLabels.has(locator['label'])
		&& isBoundedString(locator['value'], 1, 1_024)
	)
		? Object.freeze({
			label: locator['label'],
			value: locator['value'],
		})
		: undefined;
}

function decodeMarks(
	value: CanonicalJsonValue,
	maximumCollectionItems: number,
	path: string,
): ManuscriptSchemaResult<readonly Mark[]> {
	const values = readArray(value);
	if (values === undefined) {
		return schemaError('invalid-marks', path);
	}
	if (values.length > maximumCollectionItems) {
		return schemaError('collection-budget-exceeded', path);
	}
	const marks: Mark[] = [];
	let previousRank = -1;
	const seen = new Set<Mark['type']>();
	for (let index = 0; index < values.length; index += 1) {
		const markPath = `${path}[${index}]`;
		const record = asRecord(values[index]);
		const type = record?.['type'];
		if (
			record === undefined
			|| typeof type !== 'string'
			|| !markOrder.has(type as Mark['type'])
		) {
			return schemaError('invalid-marks', markPath);
		}
		const markType = type as Mark['type'];
		const rank = markOrder.get(markType);
		if (
			rank === undefined
			|| rank <= previousRank
			|| seen.has(markType)
		) {
			return schemaError('invalid-marks', markPath);
		}
		let mark: Mark;
		if (markType === 'link') {
			if (!hasExactKeys(record, ['type', 'href', 'title'], ['type', 'href'])) {
				return schemaError('invalid-marks', markPath);
			}
			const href = decodeCanonicalUri(record['href']);
			if (
				href === undefined
				|| (
					Object.hasOwn(record, 'title')
					&& !isBoundedString(record['title'], 0, 2_048)
				)
			) {
				return schemaError(
					href === undefined ? 'invalid-uri' : 'invalid-marks',
					href === undefined ? `${markPath}.href` : markPath,
				);
			}
			mark = Object.freeze({
				type: 'link',
				href,
				...(Object.hasOwn(record, 'title')
					? { title: record['title'] as string }
					: {}),
			});
		} else {
			if (
				!simpleMarkTypes.has(markType)
				|| !hasExactKeys(record, ['type'], ['type'])
			) {
				return schemaError('invalid-marks', markPath);
			}
			mark = Object.freeze({ type: markType });
		}
		marks.push(mark);
		seen.add(markType);
		previousRank = rank;
	}
	if (seen.has('subscript') && seen.has('superscript')) {
		return schemaError('invalid-marks', path);
	}
	return {
		type: 'ok',
		value: Object.freeze(marks),
	};
}

function decodeAuthor(
	value: CanonicalJsonValue | undefined,
	maximumCollectionItems: number,
	path: string,
): ManuscriptSchemaResult<ManuscriptMetadata['authors'][number]> {
	const record = readExactRecord(
		value,
		['id', 'name', 'given', 'family', 'orcid', 'affiliations'],
		['name'],
	);
	const id = Object.hasOwn(record ?? {}, 'id')
		? parseEntityIdValue(record?.['id'])
		: undefined;
	if (
		record === undefined
		|| !isBoundedString(record['name'], 1, 1_024)
		|| (Object.hasOwn(record, 'id') && id === undefined)
		|| (
			Object.hasOwn(record, 'given')
			&& !isBoundedString(record['given'], 0, 512)
		)
		|| (
			Object.hasOwn(record, 'family')
			&& !isBoundedString(record['family'], 0, 512)
		)
		|| (
			Object.hasOwn(record, 'orcid')
			&& !isBoundedString(record['orcid'], 1, 128)
		)
	) {
		return schemaError('invalid-metadata', path);
	}
	let affiliations: readonly string[] | undefined;
	if (Object.hasOwn(record, 'affiliations')) {
		const values = readArray(record['affiliations']);
		if (values === undefined) {
			return schemaError('invalid-metadata', `${path}.affiliations`);
		}
		if (
			values.length > maximumCollectionItems
			|| values.length > 1_024
		) {
			return schemaError(
				'collection-budget-exceeded',
				`${path}.affiliations`,
			);
		}
		const decoded: string[] = [];
		let previous: string | undefined;
		for (let index = 0; index < values.length; index += 1) {
			const affiliation = values[index];
			if (
				!isBoundedString(affiliation, 1, 1_024)
				|| (
					previous !== undefined
					&& compareUnicodeCodePoints(previous, affiliation) >= 0
				)
			) {
				return schemaError(
					'invalid-metadata',
					`${path}.affiliations[${index}]`,
				);
			}
			decoded.push(affiliation);
			previous = affiliation;
		}
		affiliations = Object.freeze(decoded);
	}
	return {
		type: 'ok',
		value: Object.freeze({
			...(id === undefined ? {} : { id }),
			name: record['name'],
			...(Object.hasOwn(record, 'given') ? { given: record['given'] as string } : {}),
			...(Object.hasOwn(record, 'family') ? { family: record['family'] as string } : {}),
			...(Object.hasOwn(record, 'orcid') ? { orcid: record['orcid'] as string } : {}),
			...(affiliations === undefined ? {} : { affiliations }),
		}),
	};
}

function collectNodeReferences(
	type: NodeKind,
	attrs: Readonly<Record<string, unknown>> | undefined,
	path: string,
	state: ITreeDecodeState,
): ManuscriptSchemaResult<void> {
	if (attrs === undefined) {
		return {
			type: 'ok',
			value: undefined,
		};
	}
	const declaredEntityId = type === 'citation'
		? attrs['citationId']
		: type === 'displayEquation' || type === 'figure' || type === 'table'
			? attrs['entityId']
			: undefined;
	if (declaredEntityId !== undefined) {
		const entityId = declaredEntityId as EntityId;
		if (state.declaredEntityIdSet.has(entityId)) {
			return schemaError('duplicate-entity-id', `${path}.attrs`);
		}
		state.declaredEntityIdSet.add(entityId);
		state.declaredEntityIds.push(entityId);
	}
	if (type === 'citation') {
		state.citationReferences.push({
			entityId: attrs['referenceId'] as EntityId,
			path: `${path}.attrs.referenceId`,
		});
	} else if (type === 'crossReference') {
		state.crossReferences.push({
			entityId: attrs['targetEntityId'] as EntityId,
			path: `${path}.attrs.targetEntityId`,
		});
	} else if (type === 'footnoteReference') {
		state.footnoteReferences.push({
			nodeId: attrs['footnoteNodeId'] as NodeId,
			path: `${path}.attrs.footnoteNodeId`,
		});
	}
	return {
		type: 'ok',
		value: undefined,
	};
}

function readChildTypes(
	children: readonly CanonicalJsonValue[],
): readonly NodeKind[] | undefined {
	const types: NodeKind[] = [];
	for (const child of children) {
		const type = asRecord(child)?.['type'];
		if (typeof type !== 'string' || !knownNodeTypes.has(type as NodeKind)) {
			return undefined;
		}
		types.push(type as NodeKind);
	}
	return types;
}

function hasValidChildren(type: NodeKind, children: readonly NodeKind[]): boolean {
	switch (type) {
		case 'bibliographyPlaceholder':
		case 'citation':
		case 'crossReference':
		case 'displayEquation':
		case 'figureAsset':
		case 'footnoteReference':
		case 'hardBreak':
		case 'horizontalRule':
		case 'inlineEquation':
		case 'text':
			return children.length === 0;
		case 'blockQuote':
		case 'body':
			return allTypesIn(children, blockNodeTypes, 1);
		case 'codeBlock':
			return children.length === 0
				|| (children.length === 1 && children[0] === 'text');
		case 'figure':
			return (
				(children.length === 1 && children[0] === 'figureAsset')
				|| (
					children.length === 2
					&& children[0] === 'figureAsset'
					&& children[1] === 'figureCaption'
				)
			);
		case 'figureCaption':
		case 'heading':
		case 'paragraph':
		case 'tableCaption':
			return allTypesIn(children, inlineNodeTypes);
		case 'footnote':
			return allTypesIn(children, footnoteBlockNodeTypes, 1);
		case 'frontMatter':
			return children.length === 0;
		case 'list':
			return allTypesAre(children, 'listItem', 1);
		case 'listItem':
			return (
				children.length >= 1
				&& children[0] === 'paragraph'
				&& allTypesIn(children.slice(1), cellBlockNodeTypes)
			);
		case 'manuscript':
			return (
				(children.length === 1 && children[0] === 'body')
				|| (
					children.length === 2
					&& (
						(children[0] === 'frontMatter' && children[1] === 'body')
						|| (
							children[0] === 'body'
							&& children[1] === 'bibliographyPlaceholder'
						)
					)
				)
				|| (
					children.length === 3
					&& children[0] === 'frontMatter'
					&& children[1] === 'body'
					&& children[2] === 'bibliographyPlaceholder'
				)
			);
		case 'section':
			return (
				children.length >= 1
				&& children[0] === 'heading'
				&& allTypesIn(children.slice(1), sectionBodyNodeTypes)
			);
		case 'table':
			return (
				(children.length >= 1 && allTypesAre(children, 'tableRow', 1))
				|| (
					children.length >= 2
					&& children[0] === 'tableCaption'
					&& allTypesAre(children.slice(1), 'tableRow', 1)
				)
			);
		case 'tableCell':
			return (
				children.length >= 1
				&& children[0] === 'paragraph'
				&& allTypesIn(children.slice(1), cellBlockNodeTypes)
			);
		case 'tableRow':
			return allTypesAre(children, 'tableCell', 1);
	}
}

function sectionHeadingLevelMatches(
	sectionAttrs: Readonly<Record<string, unknown>> | undefined,
	firstChild: CanonicalJsonValue | undefined,
): boolean {
	const headingAttrs = asRecord(asRecord(firstChild)?.['attrs']);
	return (
		typeof sectionAttrs?.['level'] === 'number'
		&& headingAttrs?.['level'] === sectionAttrs['level']
	);
}

function exactAttrs(
	record: ClosedJsonRecord,
	allowed: readonly string[],
	required: readonly string[],
	path: string,
	validate: (attrs: ClosedJsonRecord) => boolean,
): ManuscriptSchemaResult<Readonly<Record<string, unknown>>> {
	const attrs = readExactRecord(record, allowed, required);
	return attrs !== undefined && validate(attrs)
		? {
			type: 'ok',
			value: Object.freeze({ ...attrs }),
		}
		: schemaError('invalid-node-attributes', path);
}

function readExactRecord(
	value: CanonicalJsonValue | undefined,
	allowed: readonly string[],
	required: readonly string[],
): ClosedJsonRecord | undefined {
	const record = asRecord(value);
	return record !== undefined && hasExactKeys(record, allowed, required)
		? record
		: undefined;
}

function asRecord(value: unknown): ClosedJsonRecord | undefined {
	return (
		value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
	)
		? value as ClosedJsonRecord
		: undefined;
}

function readArray(
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

function parseEntityIdValue(value: unknown): EntityId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseEntityId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function parseNodeIdValue(value: unknown): NodeId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseNodeId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function freezeEntityReferences(
	references: readonly IManuscriptEntityReference[],
): readonly IManuscriptEntityReference[] {
	return Object.freeze(references.map(reference => Object.freeze({
		entityId: reference.entityId,
		path: reference.path,
	})));
}

function allTypesIn(
	types: readonly NodeKind[],
	allowed: ReadonlySet<NodeKind>,
	minimum = 0,
): boolean {
	return types.length >= minimum && types.every(type => allowed.has(type));
}

function allTypesAre(
	types: readonly NodeKind[],
	expected: NodeKind,
	minimum = 0,
): boolean {
	return types.length >= minimum && types.every(type => type === expected);
}

function hasValidTreeLimits(limits: IManuscriptTreeCodecLimits): boolean {
	return (
		isNonnegativeSafeInteger(limits.maximumNodes)
		&& isNonnegativeSafeInteger(limits.maximumDepth)
		&& isNonnegativeSafeInteger(limits.maximumCollectionItems)
	);
}

function isNonnegativeSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function isIntegerInRange(
	value: unknown,
	minimum: number,
	maximum = Number.MAX_SAFE_INTEGER,
): value is number {
	return (
		typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= minimum
		&& value <= maximum
	);
}

function isBoundedString(
	value: unknown,
	minimum: number,
	maximum: number,
): value is string {
	return (
		typeof value === 'string'
		&& value.length >= minimum
		&& value.length <= maximum
		&& isWellFormedUnicodeString(value)
	);
}

function compareUnicodeCodePoints(left: string, right: string): number {
	const leftPoints = Array.from(left, value => value.codePointAt(0) ?? 0);
	const rightPoints = Array.from(right, value => value.codePointAt(0) ?? 0);
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return leftPoints.length - rightPoints.length;
}

function schemaError(
	reason: ManuscriptSchemaFailure,
	path: string,
): Extract<ManuscriptSchemaResult<never>, { readonly type: 'error' }> {
	return Object.freeze({
		type: 'error',
		reason,
		path,
	});
}
