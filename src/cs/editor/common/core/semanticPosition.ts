/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NodeId } from 'cs/editor/common/core/identifiers';

declare const utf16OffsetBrand: unique symbol;

export type Utf16Offset = number & {
	readonly [utf16OffsetBrand]: true;
};

export type Utf16OffsetParseResult =
	| {
		readonly type: 'valid';
		readonly value: Utf16Offset;
	}
	| {
		readonly type: 'invalid';
		readonly reason: 'not-a-nonnegative-safe-integer';
	};

export interface ITextPosition {
	readonly kind: 'text';
	readonly textNodeId: NodeId;
	readonly utf16Offset: Utf16Offset;
	readonly affinity: 'before' | 'after';
}

export interface INodeBoundaryPosition {
	readonly kind: 'node-boundary';
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
	readonly affinity: 'before' | 'after';
}

export type SemanticPosition = ITextPosition | INodeBoundaryPosition;

export function parseUtf16Offset(value: number): Utf16OffsetParseResult {
	if (!Number.isSafeInteger(value) || value < 0) {
		return {
			type: 'invalid',
			reason: 'not-a-nonnegative-safe-integer',
		};
	}

	return {
		type: 'valid',
		value: value as Utf16Offset,
	};
}

export function isUtf16ScalarBoundary(value: string, offset: number): boolean {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) {
		return false;
	}

	if (offset === 0 || offset === value.length) {
		return true;
	}

	const previous = value.charCodeAt(offset - 1);
	const current = value.charCodeAt(offset);
	return !(
		previous >= 0xd800
		&& previous <= 0xdbff
		&& current >= 0xdc00
		&& current <= 0xdfff
	);
}
