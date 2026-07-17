/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import {
	parseNodeId,
	parseRevisionId,
	type NodeId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { validateManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type INodeBoundaryPosition,
	type ITextPosition,
	type SemanticPosition,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';

export type MappingResult<TValue> =
	| {
		readonly status: 'mapped';
		readonly value: TValue;
	}
	| {
		readonly status: 'deleted';
		readonly nearest?: TValue;
	}
	| {
		readonly status: 'ambiguous';
		readonly candidates: readonly [TValue, ...TValue[]];
	}
	| {
		readonly status: 'orphaned';
	};

export interface IPositionMap {
	readonly resource: URI;
	readonly fromRevisionId: RevisionId;
	readonly toRevisionId: RevisionId;

	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition>;
	mapNodeId(nodeId: NodeId): MappingResult<NodeId>;
	compose(next: IPositionMap): IPositionMap;
}

export interface ITextReplacePositionMapFragment {
	readonly kind: 'text-replace';
	readonly textNodeId: NodeId;
	readonly startUtf16Offset: Utf16Offset;
	readonly endUtf16Offset: Utf16Offset;
	readonly replacementUtf16Length: number;
}

export interface IChildInsertPositionMapFragment {
	readonly kind: 'child-insert';
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
	readonly insertedChildCount: number;
	readonly insertedNodeIds: readonly [NodeId, ...NodeId[]];
}

export interface IChildDeletePositionMapFragment {
	readonly kind: 'child-delete';
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
	readonly deletedChildCount: number;
	readonly deletedNodeIds: readonly [NodeId, ...NodeId[]];
}

export interface IChildMovePositionMapFragment {
	readonly kind: 'child-move';
	readonly sourceParentNodeId: NodeId;
	readonly sourceChildIndex: number;
	readonly destinationParentNodeId: NodeId;
	readonly destinationChildIndexAfterRemoval: number;
	readonly movedChildCount: number;
	readonly movedNodeIds: readonly [NodeId, ...NodeId[]];
}

export interface ITextSplitPositionMapFragment {
	readonly kind: 'text-split';
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
	readonly leftTextNodeId: NodeId;
	readonly rightTextNodeId: NodeId;
	readonly splitUtf16Offset: Utf16Offset;
}

export interface ITextJoinPositionMapFragment {
	readonly kind: 'text-join';
	readonly parentNodeId: NodeId;
	readonly leftChildIndex: number;
	readonly leftTextNodeId: NodeId;
	readonly rightTextNodeId: NodeId;
	readonly leftUtf16Length: number;
}

export interface INodeAliasPositionMapFragment {
	readonly kind: 'node-alias';
	readonly sourceNodeId: NodeId;
	readonly targetNodeId: NodeId;
}

export interface INodeTombstonePositionMapFragment {
	readonly kind: 'node-tombstone';
	readonly nodeId: NodeId;
	readonly nearest?: SemanticPosition;
}

export type PositionMapFragment =
	| ITextReplacePositionMapFragment
	| IChildInsertPositionMapFragment
	| IChildDeletePositionMapFragment
	| IChildMovePositionMapFragment
	| ITextSplitPositionMapFragment
	| ITextJoinPositionMapFragment
	| INodeAliasPositionMapFragment
	| INodeTombstonePositionMapFragment;

export interface IPositionMapOptions {
	readonly resource: URI;
	readonly fromRevisionId: RevisionId;
	readonly toRevisionId: RevisionId;
	readonly fragments: readonly PositionMapFragment[];
}

interface IFragmentMappingStep {
	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition>;
	mapNodeId(nodeId: NodeId): MappingResult<NodeId>;
}

type DeletedMappingResult<TValue> = Extract<MappingResult<TValue>, { readonly status: 'deleted' }>;

const orphanedMappingResult = Object.freeze({
	status: 'orphaned',
}) as MappingResult<never>;

export function createPositionMap(options: IPositionMapOptions): IPositionMap {
	const data = inspectClosedDataRecord(options, 'Position map options');
	requireExactProperties(
		data,
		['resource', 'fromRevisionId', 'toRevisionId', 'fragments'],
		'Position map options',
	);
	const resource = data.resource;
	const fromRevisionId = data.fromRevisionId;
	const toRevisionId = data.toRevisionId;
	const validatedResource = validateManuscriptResource(resource as URI);
	if (validatedResource.type === 'invalid') {
		throw new TypeError('Position map resource must be a canonical manuscript URI.');
	}
	if (typeof fromRevisionId !== 'string'
		|| typeof toRevisionId !== 'string'
		|| parseRevisionId(fromRevisionId).type === 'invalid'
		|| parseRevisionId(toRevisionId).type === 'invalid') {
		throw new TypeError('Position map revisions must be canonical UUIDv7 values.');
	}
	if (fromRevisionId === toRevisionId) {
		throw new TypeError('Position map must advance to a distinct Revision.');
	}

	const fragments = cloneFragmentList(data.fragments);
	return new FragmentPositionMap(
		validatedResource.resource,
		fromRevisionId as RevisionId,
		toRevisionId as RevisionId,
		fragments,
	);
}

class FragmentPositionMap implements IPositionMap {
	private readonly steps: readonly IFragmentMappingStep[];

	constructor(
		readonly resource: URI,
		readonly fromRevisionId: RevisionId,
		readonly toRevisionId: RevisionId,
		fragments: readonly PositionMapFragment[],
	) {
		this.steps = Object.freeze(fragments.map(fragment => new FragmentMappingStep(fragment)));
	}

	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition> {
		if (!isSemanticPosition(position)) {
			return orphanedResult();
		}

		let result = mappedResult<SemanticPosition>(position);
		for (const step of this.steps) {
			result = mapResultThrough(result, value => step.mapPosition(value), semanticPositionKey);
		}
		return result;
	}

	mapNodeId(nodeId: NodeId): MappingResult<NodeId> {
		if (!isNodeId(nodeId)) {
			return orphanedResult();
		}

		let result = mappedResult(nodeId);
		for (const step of this.steps) {
			result = mapResultThrough(result, value => step.mapNodeId(value), value => value);
		}
		return result;
	}

	compose(next: IPositionMap): IPositionMap {
		validateComposition(this, next);
		return new IterativePositionMapSequence(this, next);
	}
}

class IterativePositionMapSequence implements IPositionMap {
	readonly resource: URI;
	readonly fromRevisionId: RevisionId;
	readonly toRevisionId: RevisionId;

	constructor(
		readonly first: IPositionMap,
		readonly next: IPositionMap,
	) {
		this.resource = first.resource;
		this.fromRevisionId = first.fromRevisionId;
		this.toRevisionId = next.toRevisionId;
	}

	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition> {
		if (!isSemanticPosition(position)) {
			return orphanedResult();
		}
		return this.mapIteratively(
			position,
			(map, value) => map.mapPosition(value),
			semanticPositionKey,
		);
	}

	mapNodeId(nodeId: NodeId): MappingResult<NodeId> {
		if (!isNodeId(nodeId)) {
			return orphanedResult();
		}
		return this.mapIteratively(
			nodeId,
			(map, value) => map.mapNodeId(value),
			value => value,
		);
	}

	compose(next: IPositionMap): IPositionMap {
		validateComposition(this, next);
		return new IterativePositionMapSequence(this, next);
	}

	private mapIteratively<TValue>(
		value: TValue,
		mapper: (map: IPositionMap, value: TValue) => MappingResult<TValue>,
		key: (value: TValue) => string,
	): MappingResult<TValue> {
		let result = mappedResult(value);
		const pending: IPositionMap[] = [this];
		while (pending.length > 0) {
			const map = pending.pop()!;
			if (map instanceof IterativePositionMapSequence) {
				pending.push(map.next, map.first);
				continue;
			}
			result = mapResultThrough(result, candidate => mapper(map, candidate), key);
		}
		return result;
	}
}

class FragmentMappingStep implements IFragmentMappingStep {
	private readonly nodeIds: ReadonlySet<NodeId> | undefined;

	constructor(private readonly fragment: PositionMapFragment) {
		switch (fragment.kind) {
			case 'child-insert':
				this.nodeIds = new Set(fragment.insertedNodeIds);
				break;
			case 'child-delete':
				this.nodeIds = new Set(fragment.deletedNodeIds);
				break;
			case 'child-move':
				this.nodeIds = new Set(fragment.movedNodeIds);
				break;
			default:
				this.nodeIds = undefined;
		}
	}

	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition> {
		switch (this.fragment.kind) {
			case 'text-replace':
				return this.mapTextReplacePosition(position, this.fragment);
			case 'child-insert':
				return this.mapChildInsertPosition(position, this.fragment);
			case 'child-delete':
				return this.mapChildDeletePosition(position, this.fragment);
			case 'child-move':
				return this.mapChildMovePosition(position, this.fragment);
			case 'text-split':
				return this.mapTextSplitPosition(position, this.fragment);
			case 'text-join':
				return this.mapTextJoinPosition(position, this.fragment);
			case 'node-alias':
				return mapAliasPosition(position, this.fragment);
			case 'node-tombstone':
				return mapTombstonePosition(position, this.fragment);
		}
	}

	mapNodeId(nodeId: NodeId): MappingResult<NodeId> {
		switch (this.fragment.kind) {
			case 'child-insert':
				return this.nodeIds!.has(nodeId) ? orphanedResult() : mappedResult(nodeId);
			case 'child-delete':
				return this.nodeIds!.has(nodeId) ? deletedResult() : mappedResult(nodeId);
			case 'text-split':
				return nodeId === this.fragment.rightTextNodeId
					? orphanedResult()
					: mappedResult(nodeId);
			case 'text-join':
				return mappedResult(
					nodeId === this.fragment.rightTextNodeId
						? this.fragment.leftTextNodeId
						: nodeId,
				);
			case 'node-alias':
				return mappedResult(
					nodeId === this.fragment.sourceNodeId ? this.fragment.targetNodeId : nodeId,
				);
			case 'node-tombstone':
				return nodeId === this.fragment.nodeId ? deletedResult() : mappedResult(nodeId);
			default:
				return mappedResult(nodeId);
		}
	}

	private mapTextReplacePosition(
		position: SemanticPosition,
		fragment: ITextReplacePositionMapFragment,
	): MappingResult<SemanticPosition> {
		if (position.kind !== 'text' || position.textNodeId !== fragment.textNodeId) {
			return mappedResult(position);
		}

		const offset = position.utf16Offset;
		const start = fragment.startUtf16Offset;
		const end = fragment.endUtf16Offset;
		const replacementEnd = start + fragment.replacementUtf16Length;
		if (start === end) {
			if (offset < start) {
				return mappedResult(position);
			}
			if (offset === start) {
				return mapTextPositionAt(
					position,
					position.textNodeId,
					position.affinity === 'before' ? start : replacementEnd,
				);
			}
			return mapTextPositionAt(
				position,
				position.textNodeId,
				offset + fragment.replacementUtf16Length,
			);
		}

		if (offset < start) {
			return mappedResult(position);
		}
		if (offset === start || offset === end) {
			return mapTextPositionAt(
				position,
				position.textNodeId,
				position.affinity === 'before' ? start : replacementEnd,
			);
		}
		if (offset > end) {
			return mapTextPositionAt(
				position,
				position.textNodeId,
				offset + fragment.replacementUtf16Length - (end - start),
			);
		}
		return deletedResult(
			textPositionAt(
				position,
				position.textNodeId,
				position.affinity === 'before' ? start : replacementEnd,
			),
		);
	}

	private mapChildInsertPosition(
		position: SemanticPosition,
		fragment: IChildInsertPositionMapFragment,
	): MappingResult<SemanticPosition> {
		if (this.nodeIds!.has(positionNodeId(position))) {
			return orphanedResult();
		}
		if (position.kind !== 'node-boundary'
			|| position.parentNodeId !== fragment.parentNodeId
			|| position.childIndex < fragment.childIndex) {
			return mappedResult(position);
		}
		if (position.childIndex === fragment.childIndex && position.affinity === 'before') {
			return mappedResult(position);
		}
		return mapNodeBoundaryAt(
			position,
			position.parentNodeId,
			position.childIndex + fragment.insertedChildCount,
		);
	}

	private mapChildDeletePosition(
		position: SemanticPosition,
		fragment: IChildDeletePositionMapFragment,
	): MappingResult<SemanticPosition> {
		const nearest = (): SemanticPosition => nodeBoundaryPosition(
			fragment.parentNodeId,
			fragment.childIndex,
			position.affinity,
		);
		if (this.nodeIds!.has(positionNodeId(position))) {
			return deletedResult(nearest());
		}
		if (position.kind !== 'node-boundary'
			|| position.parentNodeId !== fragment.parentNodeId) {
			return mappedResult(position);
		}

		const end = fragment.childIndex + fragment.deletedChildCount;
		if (position.childIndex < fragment.childIndex) {
			return mappedResult(position);
		}
		if (position.childIndex === fragment.childIndex || position.childIndex === end) {
			return mapNodeBoundaryAt(
				position,
				position.parentNodeId,
				fragment.childIndex,
			);
		}
		if (position.childIndex > end) {
			return mapNodeBoundaryAt(
				position,
				position.parentNodeId,
				position.childIndex - fragment.deletedChildCount,
			);
		}
		return deletedResult(nearest());
	}

	private mapChildMovePosition(
		position: SemanticPosition,
		fragment: IChildMovePositionMapFragment,
	): MappingResult<SemanticPosition> {
		if (this.nodeIds!.has(positionNodeId(position)) || position.kind !== 'node-boundary') {
			return mappedResult(position);
		}

		const sourceStart = fragment.sourceChildIndex;
		const sourceEnd = sourceStart + fragment.movedChildCount;
		if (position.parentNodeId === fragment.sourceParentNodeId) {
			const movesWithContent =
				(position.childIndex > sourceStart && position.childIndex < sourceEnd)
				|| (position.childIndex === sourceStart && position.affinity === 'after')
				|| (position.childIndex === sourceEnd && position.affinity === 'before');
			if (movesWithContent) {
				return mapNodeBoundaryAt(
					position,
					fragment.destinationParentNodeId,
					fragment.destinationChildIndexAfterRemoval
						+ position.childIndex
						- sourceStart,
				);
			}
		}

		let parentNodeId = position.parentNodeId;
		let childIndex = position.childIndex;
		if (parentNodeId === fragment.sourceParentNodeId) {
			if (childIndex > sourceEnd) {
				childIndex -= fragment.movedChildCount;
			} else if (childIndex >= sourceStart) {
				childIndex = sourceStart;
			}
		}
		if (parentNodeId === fragment.destinationParentNodeId) {
			if (childIndex > fragment.destinationChildIndexAfterRemoval
				|| (childIndex === fragment.destinationChildIndexAfterRemoval
					&& position.affinity === 'after')) {
				childIndex += fragment.movedChildCount;
			}
		}
		return mapNodeBoundaryAt(position, parentNodeId, childIndex);
	}

	private mapTextSplitPosition(
		position: SemanticPosition,
		fragment: ITextSplitPositionMapFragment,
	): MappingResult<SemanticPosition> {
		if (positionNodeId(position) === fragment.rightTextNodeId) {
			return orphanedResult();
		}
		if (position.kind === 'text' && position.textNodeId === fragment.leftTextNodeId) {
			if (position.utf16Offset < fragment.splitUtf16Offset
				|| (position.utf16Offset === fragment.splitUtf16Offset
					&& position.affinity === 'before')) {
				return mappedResult(position);
			}
			return mapTextPositionAt(
				position,
				fragment.rightTextNodeId,
				position.utf16Offset - fragment.splitUtf16Offset,
			);
		}
		if (position.kind === 'node-boundary'
			&& position.parentNodeId === fragment.parentNodeId
			&& position.childIndex > fragment.childIndex) {
			return mapNodeBoundaryAt(
				position,
				position.parentNodeId,
				position.childIndex + 1,
			);
		}
		return mappedResult(position);
	}

	private mapTextJoinPosition(
		position: SemanticPosition,
		fragment: ITextJoinPositionMapFragment,
	): MappingResult<SemanticPosition> {
		if (position.kind === 'text' && position.textNodeId === fragment.rightTextNodeId) {
			return mapTextPositionAt(
				position,
				fragment.leftTextNodeId,
				fragment.leftUtf16Length + position.utf16Offset,
			);
		}
		if (position.kind === 'node-boundary'
			&& position.parentNodeId === fragment.rightTextNodeId) {
			return mapNodeBoundaryAt(
				position,
				fragment.leftTextNodeId,
				position.childIndex,
			);
		}
		if (position.kind !== 'node-boundary'
			|| position.parentNodeId !== fragment.parentNodeId) {
			return mappedResult(position);
		}

		const joinBoundary = fragment.leftChildIndex + 1;
		if (position.childIndex === joinBoundary) {
			return mappedResult(textPosition(
				fragment.leftTextNodeId,
				fragment.leftUtf16Length,
				position.affinity,
			));
		}
		if (position.childIndex > joinBoundary) {
			return mapNodeBoundaryAt(
				position,
				position.parentNodeId,
				position.childIndex - 1,
			);
		}
		return mappedResult(position);
	}
}

function mapAliasPosition(
	position: SemanticPosition,
	fragment: INodeAliasPositionMapFragment,
): MappingResult<SemanticPosition> {
	if (position.kind === 'text' && position.textNodeId === fragment.sourceNodeId) {
		return mapTextPositionAt(
			position,
			fragment.targetNodeId,
			position.utf16Offset,
		);
	}
	if (position.kind === 'node-boundary' && position.parentNodeId === fragment.sourceNodeId) {
		return mapNodeBoundaryAt(
			position,
			fragment.targetNodeId,
			position.childIndex,
		);
	}
	return mappedResult(position);
}

function mapTombstonePosition(
	position: SemanticPosition,
	fragment: INodeTombstonePositionMapFragment,
): MappingResult<SemanticPosition> {
	return positionNodeId(position) === fragment.nodeId
		? deletedResult(fragment.nearest)
		: mappedResult(position);
}

function mapResultThrough<TValue>(
	result: MappingResult<TValue>,
	mapper: (value: TValue) => MappingResult<TValue>,
	key: (value: TValue) => string,
): MappingResult<TValue> {
	switch (result.status) {
		case 'mapped':
			return mapper(result.value);
		case 'orphaned':
			return orphanedResult();
		case 'deleted': {
			if (result.nearest === undefined) {
				return deletedResult();
			}
			const mappedNearest = mapper(result.nearest);
			if (mappedNearest.status === 'mapped') {
				return deletedResult(mappedNearest.value);
			}
			if (mappedNearest.status === 'deleted' && mappedNearest.nearest !== undefined) {
				return deletedResult(mappedNearest.nearest);
			}
			return deletedResult();
		}
		case 'ambiguous':
			return mapAmbiguousResult(result.candidates, mapper, key);
	}
}

function mapAmbiguousResult<TValue>(
	candidates: readonly [TValue, ...TValue[]],
	mapper: (value: TValue) => MappingResult<TValue>,
	key: (value: TValue) => string,
): MappingResult<TValue> {
	const outputCandidates: TValue[] = [];
	const deleted: DeletedMappingResult<TValue>[] = [];
	let survivorCount = 0;
	let allExact = true;
	let anyOrphaned = false;

	for (const candidate of candidates) {
		const mapped = mapper(candidate);
		switch (mapped.status) {
			case 'mapped':
				outputCandidates.push(mapped.value);
				survivorCount += 1;
				break;
			case 'ambiguous':
				allExact = false;
				outputCandidates.push(...mapped.candidates);
				survivorCount += mapped.candidates.length;
				break;
			case 'deleted':
				allExact = false;
				deleted.push(mapped);
				if (mapped.nearest !== undefined) {
					outputCandidates.push(mapped.nearest);
				}
				break;
			case 'orphaned':
				allExact = false;
				anyOrphaned = true;
				break;
		}
	}

	if (survivorCount === 0) {
		if (deleted.length === candidates.length) {
			const nearest = commonDeletedNearest(deleted, key);
			return nearest === undefined ? deletedResult() : deletedResult(nearest);
		}
		return anyOrphaned ? orphanedResult() : deletedResult();
	}

	const unique = deduplicate(outputCandidates, key);
	if (allExact && unique.length === 1) {
		return mappedResult(unique[0]!);
	}
	return ambiguousResult(unique);
}

function commonDeletedNearest<TValue>(
	results: readonly DeletedMappingResult<TValue>[],
	key: (value: TValue) => string,
): TValue | undefined {
	const first = results[0]?.nearest;
	if (first === undefined) {
		return undefined;
	}
	const firstKey = key(first);
	return results.every(result =>
		result.nearest !== undefined && key(result.nearest) === firstKey)
		? first
		: undefined;
}

function deduplicate<TValue>(
	values: readonly TValue[],
	key: (value: TValue) => string,
): [TValue, ...TValue[]] {
	const keys = new Set<string>();
	const unique: TValue[] = [];
	for (const value of values) {
		const valueKey = key(value);
		if (!keys.has(valueKey)) {
			keys.add(valueKey);
			unique.push(value);
		}
	}
	return unique as [TValue, ...TValue[]];
}

function mappedResult<TValue>(value: TValue): MappingResult<TValue> {
	return Object.freeze({
		status: 'mapped',
		value,
	});
}

function deletedResult<TValue>(nearest?: TValue): MappingResult<TValue> {
	return nearest === undefined
		? Object.freeze({ status: 'deleted' })
		: Object.freeze({ status: 'deleted', nearest });
}

function ambiguousResult<TValue>(
	candidates: readonly [TValue, ...TValue[]],
): MappingResult<TValue> {
	return Object.freeze({
		status: 'ambiguous',
		candidates: Object.freeze([...candidates]) as readonly [TValue, ...TValue[]],
	});
}

function orphanedResult<TValue>(): MappingResult<TValue> {
	return orphanedMappingResult as MappingResult<TValue>;
}

function mapTextPositionAt(
	source: ITextPosition,
	textNodeId: NodeId,
	utf16Offset: number,
): MappingResult<SemanticPosition> {
	const position = tryTextPositionAt(source, textNodeId, utf16Offset);
	return position === undefined ? orphanedResult() : mappedResult(position);
}

function tryTextPositionAt(
	source: ITextPosition,
	textNodeId: NodeId,
	utf16Offset: number,
): SemanticPosition | undefined {
	const parsed = parseUtf16Offset(utf16Offset);
	if (parsed.type === 'invalid') {
		return undefined;
	}
	if (source.textNodeId === textNodeId && source.utf16Offset === parsed.value) {
		return source;
	}
	return textPosition(textNodeId, parsed.value, source.affinity);
}

function textPositionAt(
	source: ITextPosition,
	textNodeId: NodeId,
	utf16Offset: number,
): SemanticPosition | undefined {
	return tryTextPositionAt(source, textNodeId, utf16Offset);
}

function textPosition(
	textNodeId: NodeId,
	utf16Offset: number,
	affinity: ITextPosition['affinity'],
): ITextPosition {
	const parsed = parseUtf16Offset(utf16Offset);
	if (parsed.type === 'invalid') {
		throw new RangeError('Mapped UTF-16 offset must be a non-negative safe integer.');
	}
	return Object.freeze({
		kind: 'text',
		textNodeId,
		utf16Offset: parsed.value,
		affinity,
	});
}

function mapNodeBoundaryAt(
	source: INodeBoundaryPosition,
	parentNodeId: NodeId,
	childIndex: number,
): MappingResult<SemanticPosition> {
	if (!isNonNegativeSafeInteger(childIndex)) {
		return orphanedResult();
	}
	if (source.parentNodeId === parentNodeId && source.childIndex === childIndex) {
		return mappedResult(source);
	}
	return mappedResult(nodeBoundaryPosition(parentNodeId, childIndex, source.affinity));
}

function nodeBoundaryPosition(
	parentNodeId: NodeId,
	childIndex: number,
	affinity: INodeBoundaryPosition['affinity'],
): INodeBoundaryPosition {
	return Object.freeze({
		kind: 'node-boundary',
		parentNodeId,
		childIndex,
		affinity,
	});
}

function cloneFragment(fragment: unknown): PositionMapFragment {
	const data = inspectClosedDataRecord(fragment, 'Position map fragment');
	const kind = data.kind;
	let cloned: PositionMapFragment;
	switch (kind) {
		case 'text-replace': {
			requireExactProperties(
				data,
				[
					'kind',
					'textNodeId',
					'startUtf16Offset',
					'endUtf16Offset',
					'replacementUtf16Length',
				],
				'Text replacement fragment',
			);
			const textNodeId = requireNodeId(data.textNodeId, 'Text replacement node identity');
			const startUtf16Offset = requireUtf16Offset(
				data.startUtf16Offset,
				'Text replacement start offset',
			);
			const endUtf16Offset = requireUtf16Offset(
				data.endUtf16Offset,
				'Text replacement end offset',
			);
			if (startUtf16Offset > endUtf16Offset) {
				throw new RangeError('Text replacement start offset must not exceed its end offset.');
			}
			const replacementUtf16Length = requireNonNegativeSafeInteger(
				data.replacementUtf16Length,
				'Text replacement length',
			);
			requireSafeSum(
				startUtf16Offset,
				replacementUtf16Length,
				'Text replacement end',
			);
			cloned = Object.freeze({
				kind,
				textNodeId,
				startUtf16Offset,
				endUtf16Offset,
				replacementUtf16Length,
			});
			break;
		}
		case 'child-insert': {
			requireExactProperties(
				data,
				['kind', 'parentNodeId', 'childIndex', 'insertedChildCount', 'insertedNodeIds'],
				'Child insertion fragment',
			);
			const parentNodeId = requireNodeId(data.parentNodeId, 'Child insertion parent');
			const childIndex = requireNonNegativeSafeInteger(
				data.childIndex,
				'Child insertion index',
			);
			const insertedChildCount = requirePositiveSafeInteger(
				data.insertedChildCount,
				'Inserted child count',
			);
			requireSafeSum(childIndex, insertedChildCount, 'Child insertion range end');
			const insertedNodeIds = cloneNodeIdList(
				data.insertedNodeIds,
				'Inserted node identities',
			);
			requireCountCovered(insertedChildCount, insertedNodeIds, 'Inserted child count');
			requireListExcludes(
				insertedNodeIds,
				[parentNodeId],
				'Inserted node identities must not include their parent',
			);
			cloned = Object.freeze({
				kind,
				parentNodeId,
				childIndex,
				insertedChildCount,
				insertedNodeIds,
			});
			break;
		}
		case 'child-delete': {
			requireExactProperties(
				data,
				['kind', 'parentNodeId', 'childIndex', 'deletedChildCount', 'deletedNodeIds'],
				'Child deletion fragment',
			);
			const parentNodeId = requireNodeId(data.parentNodeId, 'Child deletion parent');
			const childIndex = requireNonNegativeSafeInteger(
				data.childIndex,
				'Child deletion index',
			);
			const deletedChildCount = requirePositiveSafeInteger(
				data.deletedChildCount,
				'Deleted child count',
			);
			requireSafeSum(childIndex, deletedChildCount, 'Child deletion range end');
			const deletedNodeIds = cloneNodeIdList(
				data.deletedNodeIds,
				'Deleted node identities',
			);
			requireCountCovered(deletedChildCount, deletedNodeIds, 'Deleted child count');
			requireListExcludes(
				deletedNodeIds,
				[parentNodeId],
				'Deleted node identities must not include their parent',
			);
			cloned = Object.freeze({
				kind,
				parentNodeId,
				childIndex,
				deletedChildCount,
				deletedNodeIds,
			});
			break;
		}
		case 'child-move': {
			requireExactProperties(
				data,
				[
					'kind',
					'sourceParentNodeId',
					'sourceChildIndex',
					'destinationParentNodeId',
					'destinationChildIndexAfterRemoval',
					'movedChildCount',
					'movedNodeIds',
				],
				'Child move fragment',
			);
			const sourceParentNodeId = requireNodeId(
				data.sourceParentNodeId,
				'Child move source parent',
			);
			const destinationParentNodeId = requireNodeId(
				data.destinationParentNodeId,
				'Child move destination parent',
			);
			const sourceChildIndex = requireNonNegativeSafeInteger(
				data.sourceChildIndex,
				'Child move source index',
			);
			const destinationChildIndexAfterRemoval = requireNonNegativeSafeInteger(
				data.destinationChildIndexAfterRemoval,
				'Child move destination index',
			);
			const movedChildCount = requirePositiveSafeInteger(
				data.movedChildCount,
				'Moved child count',
			);
			requireSafeSum(sourceChildIndex, movedChildCount, 'Child move source range end');
			requireSafeSum(
				destinationChildIndexAfterRemoval,
				movedChildCount,
				'Child move destination range end',
			);
			const movedNodeIds = cloneNodeIdList(
				data.movedNodeIds,
				'Moved node identities',
			);
			requireCountCovered(movedChildCount, movedNodeIds, 'Moved child count');
			requireListExcludes(
				movedNodeIds,
				[sourceParentNodeId, destinationParentNodeId],
				'Moved node identities must not include a source or destination parent',
			);
			cloned = Object.freeze({
				kind,
				sourceParentNodeId,
				sourceChildIndex,
				destinationParentNodeId,
				destinationChildIndexAfterRemoval,
				movedChildCount,
				movedNodeIds,
			});
			break;
		}
		case 'text-split': {
			requireExactProperties(
				data,
				[
					'kind',
					'parentNodeId',
					'childIndex',
					'leftTextNodeId',
					'rightTextNodeId',
					'splitUtf16Offset',
				],
				'Text split fragment',
			);
			const parentNodeId = requireNodeId(data.parentNodeId, 'Text split parent');
			const leftTextNodeId = requireNodeId(data.leftTextNodeId, 'Text split left node');
			const rightTextNodeId = requireNodeId(data.rightTextNodeId, 'Text split right node');
			requireDistinctNodeIds(
				[parentNodeId, leftTextNodeId, rightTextNodeId],
				'Text split identities must be distinct',
			);
			const childIndex = requireNonNegativeSafeInteger(
				data.childIndex,
				'Text split child index',
			);
			requireSafeSum(childIndex, 1, 'Text split following child index');
			const splitUtf16Offset = requireUtf16Offset(
				data.splitUtf16Offset,
				'Text split UTF-16 offset',
			);
			cloned = Object.freeze({
				kind,
				parentNodeId,
				childIndex,
				leftTextNodeId,
				rightTextNodeId,
				splitUtf16Offset,
			});
			break;
		}
		case 'text-join': {
			requireExactProperties(
				data,
				[
					'kind',
					'parentNodeId',
					'leftChildIndex',
					'leftTextNodeId',
					'rightTextNodeId',
					'leftUtf16Length',
				],
				'Text join fragment',
			);
			const parentNodeId = requireNodeId(data.parentNodeId, 'Text join parent');
			const leftTextNodeId = requireNodeId(data.leftTextNodeId, 'Text join left node');
			const rightTextNodeId = requireNodeId(data.rightTextNodeId, 'Text join right node');
			requireDistinctNodeIds(
				[parentNodeId, leftTextNodeId, rightTextNodeId],
				'Text join identities must be distinct',
			);
			const leftChildIndex = requireNonNegativeSafeInteger(
				data.leftChildIndex,
				'Text join left child index',
			);
			requireSafeSum(leftChildIndex, 1, 'Text join boundary index');
			const leftUtf16Length = requireNonNegativeSafeInteger(
				data.leftUtf16Length,
				'Text join left UTF-16 length',
			);
			cloned = Object.freeze({
				kind,
				parentNodeId,
				leftChildIndex,
				leftTextNodeId,
				rightTextNodeId,
				leftUtf16Length,
			});
			break;
		}
		case 'node-alias': {
			requireExactProperties(
				data,
				['kind', 'sourceNodeId', 'targetNodeId'],
				'Node alias fragment',
			);
			const sourceNodeId = requireNodeId(data.sourceNodeId, 'Node alias source');
			const targetNodeId = requireNodeId(data.targetNodeId, 'Node alias target');
			requireDistinctNodeIds(
				[sourceNodeId, targetNodeId],
				'Node alias identities must be distinct',
			);
			cloned = Object.freeze({
				kind,
				sourceNodeId,
				targetNodeId,
			});
			break;
		}
		case 'node-tombstone': {
			const hasNearest = Object.hasOwn(data, 'nearest');
			requireExactProperties(
				data,
				hasNearest ? ['kind', 'nodeId', 'nearest'] : ['kind', 'nodeId'],
				'Node tombstone fragment',
			);
			const nodeId = requireNodeId(data.nodeId, 'Node tombstone identity');
			const nearest = data.nearest === undefined
				? undefined
				: cloneSemanticPosition(data.nearest, 'Node tombstone nearest position');
			if (nearest !== undefined && positionNodeId(nearest) === nodeId) {
				throw new TypeError(
					'Node tombstone nearest position must not reference the tombstoned node.',
				);
			}
			cloned = nearest === undefined
				? Object.freeze({ kind, nodeId })
				: Object.freeze({ kind, nodeId, nearest });
			break;
		}
		default:
			throw new TypeError('Unknown position map fragment kind.');
	}
	assertNoProxyGraph(fragment, 'Position map fragment');
	return cloned;
}

function cloneFragmentList(value: unknown): readonly PositionMapFragment[] {
	const values = inspectDenseDataArray(value, 'Position map fragments');
	const cloned: PositionMapFragment[] = [];
	for (const fragment of values) {
		cloned.push(cloneFragment(fragment));
	}
	assertNoProxyGraph(value, 'Position map fragments');
	return Object.freeze(cloned);
}

function cloneNodeIdList(
	value: unknown,
	label: string,
): readonly [NodeId, ...NodeId[]] {
	const values = inspectDenseDataArray(value, label);
	if (values.length === 0) {
		throw new TypeError(`${label} must contain at least one node identity.`);
	}
	const cloned: NodeId[] = [];
	for (const nodeId of values) {
		cloned.push(requireNodeId(nodeId, label));
	}
	requireDistinctNodeIds(cloned, `${label} must not contain duplicates`);
	assertNoProxyGraph(value, label);
	return Object.freeze(cloned) as readonly [NodeId, ...NodeId[]];
}

function cloneSemanticPosition(value: unknown, label: string): SemanticPosition {
	const data = inspectClosedDataRecord(value, label);
	let cloned: SemanticPosition;
	if (data.kind === 'text') {
		requireExactProperties(
			data,
			['kind', 'textNodeId', 'utf16Offset', 'affinity'],
			label,
		);
		const textNodeId = requireNodeId(data.textNodeId, `${label} text node identity`);
		const utf16Offset = requireUtf16Offset(data.utf16Offset, `${label} UTF-16 offset`);
		const affinity = requireAffinity(data.affinity, label);
		cloned = textPosition(textNodeId, utf16Offset, affinity);
	} else if (data.kind === 'node-boundary') {
		requireExactProperties(
			data,
			['kind', 'parentNodeId', 'childIndex', 'affinity'],
			label,
		);
		const parentNodeId = requireNodeId(data.parentNodeId, `${label} parent node identity`);
		const childIndex = requireNonNegativeSafeInteger(data.childIndex, `${label} child index`);
		const affinity = requireAffinity(data.affinity, label);
		cloned = nodeBoundaryPosition(parentNodeId, childIndex, affinity);
	} else {
		throw new TypeError(`${label} must be a structurally valid semantic position.`);
	}
	assertNoProxyGraph(value, label);
	return cloned;
}

function inspectClosedDataRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError(`${label} must be an inspectable closed-data object.`);
	}
	let prototype: object | null;
	let descriptors: Record<PropertyKey, PropertyDescriptor>;
	try {
		prototype = Object.getPrototypeOf(value);
		descriptors = Object.getOwnPropertyDescriptors(value) as Record<
			PropertyKey,
			PropertyDescriptor
		>;
	} catch {
		throw new TypeError(`${label} must be an inspectable closed-data object.`);
	}
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain closed-data object.`);
	}

	const data = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key === 'symbol') {
			throw new TypeError(`${label} must not contain symbol properties.`);
		}
		const descriptor = descriptors[key]!;
		if (!('value' in descriptor) || !descriptor.enumerable) {
			throw new TypeError(`${label} properties must be enumerable data properties.`);
		}
		data[key] = descriptor.value;
	}
	return data;
}

function inspectDenseDataArray(value: unknown, label: string): readonly unknown[] {
	let isArray: boolean;
	let prototype: object | null;
	let descriptors: Record<PropertyKey, PropertyDescriptor>;
	try {
		isArray = Array.isArray(value);
		if (!isArray) {
			throw new TypeError();
		}
		prototype = Object.getPrototypeOf(value);
		descriptors = Object.getOwnPropertyDescriptors(value) as Record<
			PropertyKey,
			PropertyDescriptor
		>;
	} catch {
		throw new TypeError(`${label} must be an inspectable dense data array.`);
	}
	if (prototype !== Array.prototype) {
		throw new TypeError(`${label} must be a plain dense data array.`);
	}
	const descriptorKeys = Reflect.ownKeys(descriptors);
	if (descriptorKeys.some(key => typeof key === 'symbol')) {
		throw new TypeError(`${label} must not contain symbol properties.`);
	}
	const lengthDescriptor = descriptors.length;
	if (lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| lengthDescriptor.enumerable
		|| !isNonNegativeSafeInteger(lengthDescriptor.value)) {
		throw new TypeError(`${label} must have a closed data-array length.`);
	}
	const length = lengthDescriptor.value;
	if (descriptorKeys.length !== length + 1) {
		throw new TypeError(`${label} must be dense and contain no extra properties.`);
	}

	const copied: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
			throw new TypeError(`${label} must contain only dense data elements.`);
		}
		copied.push(descriptor.value);
	}
	return copied;
}

function requireExactProperties(
	data: Readonly<Record<string, unknown>>,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(data);
	if (actual.length !== expected.length
		|| expected.some(key => !Object.hasOwn(data, key))) {
		throw new TypeError(`${label} must contain exactly the declared properties.`);
	}
}

function assertNoProxyGraph(value: unknown, label: string): void {
	try {
		structuredClone(value);
	} catch {
		throw new TypeError(`${label} must not contain a Proxy.`);
	}
}

function requireAffinity(
	value: unknown,
	label: string,
): ITextPosition['affinity'] {
	if (value !== 'before' && value !== 'after') {
		throw new TypeError(`${label} affinity must be before or after.`);
	}
	return value;
}

function requireNodeId(value: unknown, label: string): NodeId {
	if (!isNodeId(value)) {
		throw new TypeError(`${label} must be a canonical UUIDv7 node identity.`);
	}
	return value;
}

function requireUtf16Offset(value: unknown, label: string): Utf16Offset {
	if (typeof value !== 'number') {
		throw new RangeError(`${label} must be a non-negative safe UTF-16 offset.`);
	}
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new RangeError(`${label} must be a non-negative safe UTF-16 offset.`);
	}
	return parsed.value;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
	if (!isNonNegativeSafeInteger(value)) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${label} must be a positive safe integer.`);
	}
	return value;
}

function requireSafeSum(left: number, right: number, label: string): void {
	if (!Number.isSafeInteger(left + right)) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
}

function requireCountCovered(
	count: number,
	nodeIds: readonly NodeId[],
	label: string,
): void {
	if (count > nodeIds.length) {
		throw new RangeError(`${label} must not exceed the listed subtree identity count.`);
	}
}

function requireListExcludes(
	values: readonly NodeId[],
	excluded: readonly NodeId[],
	message: string,
): void {
	const excludedSet = new Set(excluded);
	if (values.some(value => excludedSet.has(value))) {
		throw new TypeError(`${message}.`);
	}
}

function requireDistinctNodeIds(values: readonly NodeId[], message: string): void {
	if (new Set(values).size !== values.length) {
		throw new TypeError(`${message}.`);
	}
}

function validateComposition(first: IPositionMap, next: IPositionMap): void {
	if (!isEqual(first.resource, next.resource)) {
		throw new TypeError('Cannot compose position maps for different resources.');
	}
	if (first.toRevisionId !== next.fromRevisionId) {
		throw new TypeError('Cannot compose position maps with non-adjacent revisions.');
	}
}

function isSemanticPosition(value: unknown): value is SemanticPosition {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<SemanticPosition>;
	if (candidate.affinity !== 'before' && candidate.affinity !== 'after') {
		return false;
	}
	if (candidate.kind === 'text') {
		return isNodeId(candidate.textNodeId)
			&& parseUtf16Offset(candidate.utf16Offset as number).type === 'valid';
	}
	if (candidate.kind === 'node-boundary') {
		return isNodeId(candidate.parentNodeId)
			&& isNonNegativeSafeInteger(candidate.childIndex);
	}
	return false;
}

function isNodeId(value: unknown): value is NodeId {
	return typeof value === 'string' && parseNodeId(value).type === 'valid';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positionNodeId(position: SemanticPosition): NodeId {
	return position.kind === 'text' ? position.textNodeId : position.parentNodeId;
}

function semanticPositionKey(position: SemanticPosition): string {
	return position.kind === 'text'
		? `text:${position.textNodeId}:${position.utf16Offset}:${position.affinity}`
		: `node-boundary:${position.parentNodeId}:${position.childIndex}:${position.affinity}`;
}
