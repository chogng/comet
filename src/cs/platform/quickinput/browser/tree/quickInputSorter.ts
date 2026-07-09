/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickTreeItem } from 'cs/platform/quickinput/common/quickInput';

export class QuickInputTreeSorter<T extends IQuickTreeItem = IQuickTreeItem> {
	compare(left: T, right: T): number {
		return left.label.localeCompare(right.label);
	}
}
