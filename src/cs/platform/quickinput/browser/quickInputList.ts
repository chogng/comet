/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickPickItem, QuickPickInput } from 'cs/platform/quickinput/common/quickInput';

export class QuickInputList<T extends IQuickPickItem> {
	private itemsValue: readonly QuickPickInput<T>[] = [];

	setElements(items: readonly QuickPickInput<T>[]): void {
		this.itemsValue = items;
	}

	getElements(): readonly QuickPickInput<T>[] {
		return this.itemsValue;
	}

	layout(): void {
	}

	dispose(): void {
		this.itemsValue = [];
	}
}
