/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	parseNodeId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import type { DocumentIndex } from 'cs/editor/common/model/documentIndex';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type ManuscriptNode,
	type Mark,
	type NodeKind,
	type TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	decodeMarksV1,
	encodeMarksV1,
	maximumManuscriptTextUtf16Length,
} from 'cs/editor/common/model/manuscriptSchema';
import type { PositionMapFragment } from 'cs/editor/common/model/positionMap';

export interface IManuscriptNormalizationInstrumentation {
	readonly onVisitNode?: (nodeId: NodeId) => void;
	readonly onScheduleRehash?: (nodeId: NodeId) => void;

	/**
	 * Reports every shallow child-array copy or construction. The count is the
	 * number of child slots copied into that array, not a subtree node count.
	 */
	readonly onCopyChildSlots?: (parentNodeId: NodeId, count: number) => void;
}

export interface IManuscriptNormalizationOptions {
	readonly root: ManuscriptNode;
	readonly index: DocumentIndex;
	readonly touchedParentNodeIds: readonly NodeId[];
	readonly touchedNodeIds: readonly NodeId[];

	/**
	 * Maximum remove/join entries that can later compile into ordinary inverse
	 * Operations. The kernel derives this from its Transaction operation budget.
	 */
	readonly maximumDeltaEntries: number;
	readonly instrumentation?: IManuscriptNormalizationInstrumentation;
}

export interface IRemoveEmptyTextNormalizationDelta {
	readonly kind: 'remove-empty-text';
	readonly parentNodeId: NodeId;
	readonly childIndexBeforeRemoval: number;
	readonly removedTextNode: TextNode;
}

export interface IJoinAdjacentTextNormalizationDelta {
	readonly kind: 'join-adjacent-text';
	readonly parentNodeId: NodeId;
	readonly leftChildIndexBeforeJoin: number;
	readonly leftTextNode: TextNode;
	readonly rightTextNode: TextNode;
	readonly joinedTextNode: TextNode;
}

export type ManuscriptNormalizationDeltaEntry =
	| IRemoveEmptyTextNormalizationDelta
	| IJoinAdjacentTextNormalizationDelta;

/**
 * One linear restoration checkpoint per changed direct-child neighborhood.
 *
 * The arrays are normalization-owned and frozen. Their nodes are already
 * immutable Snapshot-owned values, so retaining those values preserves exact
 * structural sharing without traversing or cloning their subtrees.
 */
export interface IManuscriptNormalizationParentDelta {
	readonly parentNodeId: NodeId;
	readonly previousChildren: readonly DocumentNode[];
	readonly normalizedChildren: readonly DocumentNode[];
}

export interface IManuscriptNormalizationDelta {
	readonly entries: readonly ManuscriptNormalizationDeltaEntry[];
	readonly parents: readonly IManuscriptNormalizationParentDelta[];
}

export interface IManuscriptNormalizationValue {
	readonly root: ManuscriptNode;
	readonly fragments: readonly PositionMapFragment[];
	readonly delta: IManuscriptNormalizationDelta;

	/**
	 * Changed nodes in descendant-to-root order. An incremental Snapshot hasher
	 * can consume this sequence without discovering paths by traversing the tree.
	 */
	readonly rehashNodeIds: readonly NodeId[];
}

export type ManuscriptNormalizationFailure =
	| {
		readonly reason: 'invalid-options';
	}
	| {
		readonly reason: 'inspection-failed';
	}
	| {
		readonly reason: 'invalid-normalization-budget';
	}
	| {
		readonly reason: 'normalization-budget-exceeded';
		readonly nodeId: NodeId;
		readonly maximumDeltaEntries: number;
	}
	| {
		readonly reason: 'index-root-mismatch';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'unknown-touched-parent';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'touched-parent-has-no-children';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'unknown-touched-node';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'invalid-text-parent';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'invalid-marks';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'incompatible-script-marks';
		readonly nodeId: NodeId;
	}
	| {
		readonly reason: 'text-utf16-limit-exceeded';
		readonly nodeId: NodeId;
		readonly maximumUtf16Length: number;
	}
	| {
		readonly reason: 'untrusted-normalization-delta';
	}
	| {
		readonly reason: 'normalization-delta-mismatch';
		readonly nodeId: NodeId;
	};

export type ManuscriptNormalizationResult<TValue = IManuscriptNormalizationValue> =
	| {
		readonly type: 'ok';
		readonly value: TValue;
	}
	| {
		readonly type: 'error';
		readonly error: ManuscriptNormalizationFailure;
	};

export interface IRestoreManuscriptNormalizationOptions {
	readonly root: ManuscriptNode;
	readonly index: DocumentIndex;
	readonly delta: IManuscriptNormalizationDelta;
	readonly instrumentation?: IManuscriptNormalizationInstrumentation;
}

interface INormalizedParent {
	readonly node: DocumentNode;
	readonly delta?: IManuscriptNormalizationParentDelta;
}

interface IRebuildResult {
	readonly root: ManuscriptNode;
	readonly rehashNodeIds: readonly NodeId[];
}

const maximumCanonicalMarkCount = 8;
const maximumNormalizationTouchedNodeIds = 100_000;
const trustedNormalizationDeltas = new WeakSet<object>();

/**
 * These are the only V1 schema nodes whose direct children may be Text nodes.
 * Every one permits an empty children collection, so an empty Text child is
 * removable without synthesizing a replacement node.
 */
const removableEmptyTextParentTypes: ReadonlySet<NodeKind> = new Set([
	'codeBlock',
	'figureCaption',
	'heading',
	'paragraph',
	'tableCaption',
]);

/**
 * Returns true only for a delta created in this module by a successful
 * normalization call in the current runtime.
 */
export function isTrustedManuscriptNormalizationDelta(
	value: unknown,
): value is IManuscriptNormalizationDelta {
	return (
		typeof value === 'object'
		&& value !== null
		&& trustedNormalizationDeltas.has(value)
	);
}

/**
 * Validates and normalizes only explicitly touched text neighborhoods.
 *
 * The supplied index must belong to `root`. It provides topology lookup so the
 * normalizer never searches unrelated subtrees. Marks are already canonical at
 * every production codec boundary; this stage rejects non-canonical Marks and
 * never sorts, deduplicates, or otherwise repairs them.
 */
export function normalizeManuscriptRoot(
	options: IManuscriptNormalizationOptions,
): ManuscriptNormalizationResult {
	const capturedOptions = captureNormalizationOptions(options);
	if (capturedOptions.type === 'error') {
		return capturedOptions;
	}
	options = capturedOptions.value;
	if (
		!Number.isSafeInteger(options.maximumDeltaEntries)
		|| options.maximumDeltaEntries < 0
	) {
		return errorResult({
			reason: 'invalid-normalization-budget',
		});
	}
	const ownershipFailure = validateIndexOwnership(options.root, options.index);
	if (ownershipFailure !== undefined) {
		return errorResult(ownershipFailure);
	}

	const parentNodeIds = collectTouchedParentNodeIds(options);
	if (parentNodeIds.type === 'error') {
		return parentNodeIds;
	}

	const fragments: PositionMapFragment[] = [];
	const deltaEntries: ManuscriptNormalizationDeltaEntry[] = [];
	const parentDeltas: IManuscriptNormalizationParentDelta[] = [];
	const replacements = new Map<NodeId, DocumentNode>();
	const visitedNodeIds = new Set<NodeId>();
	for (const parentNodeId of parentNodeIds.value) {
		const parent = options.index.getNode(parentNodeId);
		if (parent === undefined) {
			return errorResult({
				reason: 'unknown-touched-parent',
				nodeId: parentNodeId,
			});
		}
		visitNode(parent.id, visitedNodeIds, options.instrumentation);
		if (!removableEmptyTextParentTypes.has(parent.type)) {
			continue;
		}

		const normalized = normalizeTextParent(
			parent,
			fragments,
			deltaEntries,
			options.maximumDeltaEntries,
			visitedNodeIds,
			options.instrumentation,
		);
		if (normalized.type === 'error') {
			return normalized;
		}
		if (normalized.value.delta !== undefined) {
			replacements.set(parentNodeId, normalized.value.node);
			parentDeltas.push(normalized.value.delta);
		}
	}

	const rebuilt = rebuildChangedPaths(
		options.root,
		options.index,
		replacements,
		options.instrumentation,
	);
	const delta = createTrustedDelta(deltaEntries, parentDeltas);
	return okResult(Object.freeze({
		root: rebuilt.root,
		fragments: Object.freeze([...fragments]),
		delta,
		rehashNodeIds: rebuilt.rehashNodeIds,
	}));
}

/**
 * Restores each changed direct-child neighborhood with one linear validation
 * and one linear replacement. Delta entries are not replayed one by one.
 */
export function restoreManuscriptNormalization(
	options: IRestoreManuscriptNormalizationOptions,
): ManuscriptNormalizationResult<{
	readonly root: ManuscriptNode;
	readonly rehashNodeIds: readonly NodeId[];
}> {
	const capturedOptions = captureRestoreOptions(options);
	if (capturedOptions.type === 'error') {
		return capturedOptions;
	}
	options = capturedOptions.value;
	if (!isTrustedManuscriptNormalizationDelta(options.delta)) {
		return errorResult({
			reason: 'untrusted-normalization-delta',
		});
	}
	const ownershipFailure = validateIndexOwnership(options.root, options.index);
	if (ownershipFailure !== undefined) {
		return errorResult(ownershipFailure);
	}

	const replacements = new Map<NodeId, DocumentNode>();
	const visitedNodeIds = new Set<NodeId>();
	for (const parentDelta of options.delta.parents) {
		const parent = options.index.getNode(parentDelta.parentNodeId);
		if (
			parent === undefined
			|| !Object.hasOwn(parent, 'children')
		) {
			return deltaMismatch(parentDelta.parentNodeId);
		}
		visitNode(parent.id, visitedNodeIds, options.instrumentation);
		const currentChildren = getDocumentNodeChildren(parent);
		if (!sameChildReferences(currentChildren, parentDelta.normalizedChildren)) {
			return deltaMismatch(parentDelta.parentNodeId);
		}

		const previousChildren = Object.freeze([...parentDelta.previousChildren]);
		copyChildSlots(
			parent.id,
			previousChildren.length,
			options.instrumentation,
		);
		replacements.set(
			parent.id,
			cloneNodeWithChildren(parent, previousChildren),
		);
	}

	const rebuilt = rebuildChangedPaths(
		options.root,
		options.index,
		replacements,
		options.instrumentation,
	);
	return okResult(Object.freeze({
		root: rebuilt.root,
		rehashNodeIds: rebuilt.rehashNodeIds,
	}));
}

function collectTouchedParentNodeIds(
	options: IManuscriptNormalizationOptions,
): ManuscriptNormalizationResult<readonly NodeId[]> {
	const parentNodeIds = new Set<NodeId>();
	for (const parentNodeId of options.touchedParentNodeIds) {
		const parent = options.index.getNode(parentNodeId);
		if (parent === undefined) {
			return errorResult({
				reason: 'unknown-touched-parent',
				nodeId: parentNodeId,
			});
		}
		if (!Object.hasOwn(parent, 'children')) {
			return errorResult({
				reason: 'touched-parent-has-no-children',
				nodeId: parentNodeId,
			});
		}
		parentNodeIds.add(parentNodeId);
	}

	for (const touchedNodeId of options.touchedNodeIds) {
		const node = options.index.getNode(touchedNodeId);
		if (node === undefined) {
			return errorResult({
				reason: 'unknown-touched-node',
				nodeId: touchedNodeId,
			});
		}
		if (node.type === 'text') {
			const parent = options.index.getParentLocation(node.id);
			if (parent === undefined) {
				return errorResult({
					reason: 'invalid-text-parent',
					nodeId: node.id,
				});
			}
			const parentNode = options.index.getNode(parent.parentNodeId);
			if (
				parentNode === undefined
				|| !removableEmptyTextParentTypes.has(parentNode.type)
			) {
				return errorResult({
					reason: 'invalid-text-parent',
					nodeId: node.id,
				});
			}
			parentNodeIds.add(parent.parentNodeId);
		} else if (removableEmptyTextParentTypes.has(node.type)) {
			parentNodeIds.add(node.id);
		}
	}

	return okResult(Object.freeze([...parentNodeIds].sort()));
}

function captureNormalizationOptions(
	value: unknown,
): ManuscriptNormalizationResult<IManuscriptNormalizationOptions> {
	const captured = captureExactDataOptions(
		value,
		[
			'root',
			'index',
			'touchedParentNodeIds',
			'touchedNodeIds',
			'maximumDeltaEntries',
		],
		['instrumentation'],
	);
	if (captured.type === 'error') {
		return captured;
	}

	const root = captured.value.get('root');
	const index = captured.value.get('index');
	const touchedParentNodeIds = captured.value.get('touchedParentNodeIds');
	const touchedNodeIds = captured.value.get('touchedNodeIds');
	const maximumDeltaEntries = captured.value.get('maximumDeltaEntries');
	const instrumentation = captured.value.get('instrumentation');
	if (
		!isObjectValue(root)
		|| !isObjectValue(index)
		|| typeof maximumDeltaEntries !== 'number'
		|| (
			instrumentation !== undefined
			&& !isObjectValue(instrumentation)
		)
	) {
		return errorResult({
			reason: 'invalid-options',
		});
	}
	const capturedParentNodeIds = captureNodeIdArray(touchedParentNodeIds);
	if (capturedParentNodeIds.type === 'error') {
		return capturedParentNodeIds;
	}
	const capturedTouchedNodeIds = captureNodeIdArray(touchedNodeIds);
	if (capturedTouchedNodeIds.type === 'error') {
		return capturedTouchedNodeIds;
	}

	return okResult(Object.freeze({
		root: root as ManuscriptNode,
		index: index as DocumentIndex,
		touchedParentNodeIds: capturedParentNodeIds.value,
		touchedNodeIds: capturedTouchedNodeIds.value,
		maximumDeltaEntries,
		...(instrumentation === undefined
			? {}
			: {
				instrumentation:
					instrumentation as IManuscriptNormalizationInstrumentation,
			}),
	}));
}

function captureRestoreOptions(
	value: unknown,
): ManuscriptNormalizationResult<IRestoreManuscriptNormalizationOptions> {
	const captured = captureExactDataOptions(
		value,
		['root', 'index', 'delta'],
		['instrumentation'],
	);
	if (captured.type === 'error') {
		return captured;
	}

	const root = captured.value.get('root');
	const index = captured.value.get('index');
	const delta = captured.value.get('delta');
	const instrumentation = captured.value.get('instrumentation');
	if (
		!isObjectValue(root)
		|| !isObjectValue(index)
		|| !isObjectValue(delta)
		|| (
			instrumentation !== undefined
			&& !isObjectValue(instrumentation)
		)
	) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	return okResult(Object.freeze({
		root: root as ManuscriptNode,
		index: index as DocumentIndex,
		delta: delta as IManuscriptNormalizationDelta,
		...(instrumentation === undefined
			? {}
			: {
				instrumentation:
					instrumentation as IManuscriptNormalizationInstrumentation,
			}),
	}));
}

function captureExactDataOptions(
	value: unknown,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
): ManuscriptNormalizationResult<ReadonlyMap<string, unknown>> {
	if (!isObjectValue(value)) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	let prototype: object | null;
	let descriptors: PropertyDescriptorMap;
	let keys: readonly PropertyKey[];
	try {
		prototype = Object.getPrototypeOf(value);
		descriptors = Object.getOwnPropertyDescriptors(value);
		keys = Reflect.ownKeys(value);
	} catch {
		return errorResult({
			reason: 'inspection-failed',
		});
	}
	if (prototype !== Object.prototype && prototype !== null) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
	if (
		keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))
		|| requiredKeys.some(key => !Object.hasOwn(descriptors, key))
	) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	const captured = new Map<string, unknown>();
	for (const key of keys) {
		if (typeof key !== 'string') {
			return errorResult({
				reason: 'invalid-options',
			});
		}
		const descriptor = descriptors[key];
		if (
			descriptor === undefined
			|| !('value' in descriptor)
			|| descriptor.enumerable !== true
		) {
			return errorResult({
				reason: 'invalid-options',
			});
		}
		captured.set(key, descriptor.value);
	}
	return okResult(captured);
}

function captureNodeIdArray(
	value: unknown,
): ManuscriptNormalizationResult<readonly NodeId[]> {
	let isArray: boolean;
	let prototype: object | null;
	let descriptors: Readonly<Record<string, PropertyDescriptor>>;
	let keys: readonly PropertyKey[];
	try {
		isArray = Array.isArray(value);
		if (!isArray) {
			return errorResult({
				reason: 'invalid-options',
			});
		}
		const arrayValue = value as readonly unknown[];
		prototype = Object.getPrototypeOf(arrayValue);
		descriptors = Object.getOwnPropertyDescriptors(arrayValue);
		keys = Reflect.ownKeys(arrayValue);
	} catch {
		return errorResult({
			reason: 'inspection-failed',
		});
	}
	if (prototype !== Array.prototype) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	const lengthDescriptor = descriptors['length'];
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| lengthDescriptor.value < 0
		|| lengthDescriptor.value > maximumNormalizationTouchedNodeIds
	) {
		return errorResult({
			reason: 'invalid-options',
		});
	}
	const length = lengthDescriptor.value as number;
	if (
		keys.length !== length + 1
		|| keys.some(key => key !== 'length' && !isArrayIndexKey(key, length))
	) {
		return errorResult({
			reason: 'invalid-options',
		});
	}

	const nodeIds: NodeId[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (
			descriptor === undefined
			|| !('value' in descriptor)
			|| descriptor.enumerable !== true
			|| typeof descriptor.value !== 'string'
		) {
			return errorResult({
				reason: 'invalid-options',
			});
		}
		const parsed = parseNodeId(descriptor.value);
		if (parsed.type === 'invalid') {
			return errorResult({
				reason: 'invalid-options',
			});
		}
		nodeIds.push(parsed.value);
	}
	return okResult(Object.freeze(nodeIds));
}

function isArrayIndexKey(key: PropertyKey, length: number): boolean {
	if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)) {
		return false;
	}
	const index = Number(key);
	return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isObjectValue(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}

function normalizeTextParent(
	parent: DocumentNode,
	fragments: PositionMapFragment[],
	deltaEntries: ManuscriptNormalizationDeltaEntry[],
	maximumDeltaEntries: number,
	visitedNodeIds: Set<NodeId>,
	instrumentation: IManuscriptNormalizationInstrumentation | undefined,
): ManuscriptNormalizationResult<INormalizedParent> {
	const children = getDocumentNodeChildren(parent);
	let output: DocumentNode[] | undefined;
	let leftText: TextNode | undefined;

	const ensureOutput = (sourceIndex: number): DocumentNode[] => {
		if (output === undefined) {
			output = children.slice(0, sourceIndex);
			copyChildSlots(parent.id, sourceIndex, instrumentation);
		}
		return output;
	};

	for (let sourceIndex = 0; sourceIndex < children.length; sourceIndex += 1) {
		const child = children[sourceIndex];
		if (child === undefined) {
			throw new Error('A manuscript children collection became sparse.');
		}
		visitNode(child.id, visitedNodeIds, instrumentation);
		if (child.type !== 'text') {
			if (output !== undefined) {
				output.push(child);
				copyChildSlots(parent.id, 1, instrumentation);
			}
			leftText = undefined;
			continue;
		}

		const canonicalMarks = validateCanonicalMarks(child);
		if (canonicalMarks !== undefined) {
			return errorResult(canonicalMarks);
		}
		if (child.value.length > maximumManuscriptTextUtf16Length) {
			return textLimitExceeded(child.id);
		}

		if (child.value.length === 0) {
			const budgetFailure = requireDeltaBudget(
				deltaEntries.length,
				maximumDeltaEntries,
				child.id,
			);
			if (budgetFailure !== undefined) {
				return errorResult(budgetFailure);
			}
			const currentOutput = ensureOutput(sourceIndex);
			const childIndexBeforeRemoval = currentOutput.length;
			const deletedNodeIds = Object.freeze([child.id]) as readonly [NodeId, ...NodeId[]];
			fragments.push(
				Object.freeze({
					kind: 'child-delete',
					parentNodeId: parent.id,
					childIndex: childIndexBeforeRemoval,
					deletedChildCount: 1,
					deletedNodeIds,
				}),
				Object.freeze({
					kind: 'node-tombstone',
					nodeId: child.id,
				}),
			);
			deltaEntries.push(Object.freeze({
				kind: 'remove-empty-text',
				parentNodeId: parent.id,
				childIndexBeforeRemoval,
				removedTextNode: cloneTextNode(child),
			}));
			continue;
		}

		if (leftText === undefined || !marksEqual(leftText.marks, child.marks)) {
			if (output !== undefined) {
				output.push(child);
				copyChildSlots(parent.id, 1, instrumentation);
			}
			leftText = child;
			continue;
		}

		const budgetFailure = requireDeltaBudget(
			deltaEntries.length,
			maximumDeltaEntries,
			child.id,
		);
		if (budgetFailure !== undefined) {
			return errorResult(budgetFailure);
		}
		if (
			child.value.length
			> maximumManuscriptTextUtf16Length - leftText.value.length
		) {
			return textLimitExceeded(leftText.id);
		}

		const currentOutput = ensureOutput(sourceIndex);
		const leftChildIndexBeforeJoin = currentOutput.length - 1;
		const joined = Object.freeze({
			id: leftText.id,
			type: 'text',
			value: leftText.value + child.value,
			marks: leftText.marks,
		}) satisfies TextNode;
		currentOutput[leftChildIndexBeforeJoin] = joined;
		fragments.push(
			Object.freeze({
				kind: 'text-join',
				parentNodeId: parent.id,
				leftChildIndex: leftChildIndexBeforeJoin,
				leftTextNodeId: leftText.id,
				rightTextNodeId: child.id,
				leftUtf16Length: leftText.value.length,
			}),
			Object.freeze({
				kind: 'node-alias',
				sourceNodeId: child.id,
				targetNodeId: leftText.id,
			}),
		);
		deltaEntries.push(Object.freeze({
			kind: 'join-adjacent-text',
			parentNodeId: parent.id,
			leftChildIndexBeforeJoin,
			leftTextNode: cloneTextNode(leftText),
			rightTextNode: cloneTextNode(child),
			joinedTextNode: cloneTextNode(joined),
		}));
		leftText = joined;
	}

	if (output === undefined) {
		return okResult(Object.freeze({
			node: parent,
		}));
	}

	const previousChildren = Object.freeze([...children]);
	const normalizedChildren = Object.freeze(output);
	copyChildSlots(parent.id, previousChildren.length, instrumentation);
	const parentDelta = Object.freeze({
		parentNodeId: parent.id,
		previousChildren,
		normalizedChildren,
	});
	return okResult(Object.freeze({
		node: cloneNodeWithChildren(parent, normalizedChildren),
		delta: parentDelta,
	}));
}

function validateCanonicalMarks(
	text: TextNode,
): ManuscriptNormalizationFailure | undefined {
	if (!Array.isArray(text.marks)) {
		return {
			reason: 'invalid-marks',
			nodeId: text.id,
		};
	}
	let hasSubscript = false;
	let hasSuperscript = false;
	for (const mark of text.marks) {
		hasSubscript = mark?.type === 'subscript' || hasSubscript;
		hasSuperscript = mark?.type === 'superscript' || hasSuperscript;
	}
	if (hasSubscript && hasSuperscript) {
		return {
			reason: 'incompatible-script-marks',
			nodeId: text.id,
		};
	}
	return encodeMarksV1(text.marks, maximumCanonicalMarkCount).type === 'ok'
		? undefined
		: {
			reason: 'invalid-marks',
			nodeId: text.id,
		};
}

function rebuildChangedPaths(
	root: ManuscriptNode,
	index: DocumentIndex,
	initialReplacements: ReadonlyMap<NodeId, DocumentNode>,
	instrumentation: IManuscriptNormalizationInstrumentation | undefined,
): IRebuildResult {
	if (initialReplacements.size === 0) {
		return Object.freeze({
			root,
			rehashNodeIds: Object.freeze([]),
		});
	}

	const replacements = new Map(initialReplacements);
	const depthByNodeId = new Map<NodeId, number>();
	for (const changedNodeId of initialReplacements.keys()) {
		const path = index.iteratePath(changedNodeId);
		if (path === undefined) {
			throw new Error('A changed normalization parent is absent from its source index.');
		}
		let depth = 0;
		for (const nodeId of path) {
			const knownDepth = depthByNodeId.get(nodeId);
			if (knownDepth === undefined || depth > knownDepth) {
				depthByNodeId.set(nodeId, depth);
			}
			depth += 1;
		}
	}

	const rebuildOrder = [...depthByNodeId].sort(compareNodeDepthDescending);
	const childReplacements = new Map<NodeId, Map<number, DocumentNode>>();
	const rehashNodeIds: NodeId[] = [];
	const scheduledNodeIds = new Set<NodeId>();
	for (const [nodeId] of rebuildOrder) {
		let replacement = replacements.get(nodeId) ?? index.getNode(nodeId);
		if (replacement === undefined) {
			throw new Error('A normalization ancestor is absent from its source index.');
		}

		const childChanges = childReplacements.get(nodeId);
		if (childChanges !== undefined) {
			const sourceChildren = getDocumentNodeChildren(replacement);
			const nextChildren = sourceChildren.slice();
			copyChildSlots(nodeId, nextChildren.length, instrumentation);
			for (const [childIndex, child] of childChanges) {
				if (childIndex < 0 || childIndex >= nextChildren.length) {
					throw new Error('A normalization child replacement left its indexed parent.');
				}
				nextChildren[childIndex] = child;
			}
			replacement = cloneNodeWithChildren(
				replacement,
				Object.freeze(nextChildren),
			);
			replacements.set(nodeId, replacement);
		}

		scheduleRehash(nodeId, scheduledNodeIds, rehashNodeIds, instrumentation);
		const parent = index.getParentLocation(nodeId);
		if (parent !== undefined) {
			let changes = childReplacements.get(parent.parentNodeId);
			if (changes === undefined) {
				changes = new Map();
				childReplacements.set(parent.parentNodeId, changes);
			}
			changes.set(parent.childIndex, replacement);
		}
	}

	const rebuiltRoot = replacements.get(root.id);
	if (rebuiltRoot?.type !== 'manuscript') {
		throw new Error('Normalization did not rebuild a Manuscript root.');
	}
	return Object.freeze({
		root: rebuiltRoot,
		rehashNodeIds: Object.freeze(rehashNodeIds),
	});
}

function compareNodeDepthDescending(
	left: readonly [NodeId, number],
	right: readonly [NodeId, number],
): number {
	const depthOrder = right[1] - left[1];
	if (depthOrder !== 0) {
		return depthOrder;
	}
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

function createTrustedDelta(
	entries: readonly ManuscriptNormalizationDeltaEntry[],
	parents: readonly IManuscriptNormalizationParentDelta[],
): IManuscriptNormalizationDelta {
	const delta = Object.freeze({
		entries: Object.freeze([...entries]),
		parents: Object.freeze([...parents]),
	});
	trustedNormalizationDeltas.add(delta);
	return delta;
}

function cloneNodeWithChildren(
	node: DocumentNode,
	children: readonly DocumentNode[],
): DocumentNode {
	if (!Object.hasOwn(node, 'children')) {
		throw new Error('Cannot install children on a leaf manuscript node.');
	}
	return Object.freeze({
		...node,
		children,
	}) as DocumentNode;
}

function cloneTextNode(node: TextNode): TextNode {
	return Object.freeze({
		id: node.id,
		type: 'text',
		value: node.value,
		marks: cloneCanonicalMarks(node.marks),
	});
}

function cloneCanonicalMarks(marks: readonly Mark[]): readonly Mark[] {
	const encoded = encodeMarksV1(marks, maximumCanonicalMarkCount);
	if (encoded.type === 'error') {
		throw new Error('A normalization delta contains non-canonical Marks.');
	}
	const decoded = decodeMarksV1(encoded.value, maximumCanonicalMarkCount);
	if (decoded.type === 'error') {
		throw new Error('A normalization delta contains non-canonical Marks.');
	}
	return decoded.value;
}

function marksEqual(left: readonly Mark[], right: readonly Mark[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		const leftMark = left[index];
		const rightMark = right[index];
		if (leftMark?.type !== rightMark?.type) {
			return false;
		}
		if (leftMark?.type === 'link' && rightMark?.type === 'link') {
			if (
				leftMark.href.toString() !== rightMark.href.toString()
				|| leftMark.title !== rightMark.title
				|| Object.hasOwn(leftMark, 'title') !== Object.hasOwn(rightMark, 'title')
			) {
				return false;
			}
		}
	}
	return true;
}

function sameChildReferences(
	left: readonly DocumentNode[],
	right: readonly DocumentNode[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function requireDeltaBudget(
	currentEntryCount: number,
	maximumDeltaEntries: number,
	nodeId: NodeId,
): Extract<
	ManuscriptNormalizationFailure,
	{ readonly reason: 'normalization-budget-exceeded' }
> | undefined {
	return currentEntryCount < maximumDeltaEntries
		? undefined
		: {
			reason: 'normalization-budget-exceeded',
			nodeId,
			maximumDeltaEntries,
		};
}

function textLimitExceeded(
	nodeId: NodeId,
): ManuscriptNormalizationResult<never> {
	return errorResult({
		reason: 'text-utf16-limit-exceeded',
		nodeId,
		maximumUtf16Length: maximumManuscriptTextUtf16Length,
	});
}

function validateIndexOwnership(
	root: ManuscriptNode,
	index: DocumentIndex,
): ManuscriptNormalizationFailure | undefined {
	return index.rootNodeId === root.id && index.getNode(root.id) === root
		? undefined
		: {
			reason: 'index-root-mismatch',
			nodeId: root.id,
		};
}

function visitNode(
	nodeId: NodeId,
	visitedNodeIds: Set<NodeId>,
	instrumentation: IManuscriptNormalizationInstrumentation | undefined,
): void {
	if (visitedNodeIds.has(nodeId)) {
		return;
	}
	visitedNodeIds.add(nodeId);
	instrumentation?.onVisitNode?.(nodeId);
}

function scheduleRehash(
	nodeId: NodeId,
	scheduledNodeIds: Set<NodeId>,
	output: NodeId[],
	instrumentation: IManuscriptNormalizationInstrumentation | undefined,
): void {
	if (scheduledNodeIds.has(nodeId)) {
		return;
	}
	scheduledNodeIds.add(nodeId);
	output.push(nodeId);
	instrumentation?.onScheduleRehash?.(nodeId);
}

function copyChildSlots(
	parentNodeId: NodeId,
	count: number,
	instrumentation: IManuscriptNormalizationInstrumentation | undefined,
): void {
	instrumentation?.onCopyChildSlots?.(parentNodeId, count);
}

function deltaMismatch<TValue = never>(
	nodeId: NodeId,
): ManuscriptNormalizationResult<TValue> {
	return errorResult({
		reason: 'normalization-delta-mismatch',
		nodeId,
	});
}

function okResult<TValue>(
	value: TValue,
): ManuscriptNormalizationResult<TValue> {
	return Object.freeze({
		type: 'ok',
		value,
	});
}

function errorResult<TValue = never>(
	error: ManuscriptNormalizationFailure,
): ManuscriptNormalizationResult<TValue> {
	return Object.freeze({
		type: 'error',
		error: Object.freeze(error),
	});
}
