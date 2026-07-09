/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickTreeItem } from 'cs/platform/quickinput/common/quickInput';

export interface IQuickTreeFilterData {
	readonly labelHighlights?: readonly unknown[];
	readonly descriptionHighlights?: readonly unknown[];
}

export interface QuickInputTreeElement<T extends IQuickTreeItem = IQuickTreeItem> {
	readonly element: T;
	readonly children?: readonly QuickInputTreeElement<T>[];
}

export function getParentNodeState<T extends IQuickTreeItem>(
	item: T,
): 'collapsed' | 'expanded' | 'leaf' {
	if (!item.children || item.children.length === 0) {
		return 'leaf';
	}
	return item.collapsed ? 'collapsed' : 'expanded';
}
