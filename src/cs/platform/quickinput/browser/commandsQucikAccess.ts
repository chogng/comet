/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';

export interface ICommandQuickPick extends IQuickPickItem {
	readonly commandId: string;
	accept(): void;
}

export class CommandsHistory {
	private readonly entries: string[] = [];

	push(commandId: string): void {
		const existingIndex = this.entries.indexOf(commandId);
		if (existingIndex >= 0) {
			this.entries.splice(existingIndex, 1);
		}
		this.entries.unshift(commandId);
	}

	get(): readonly string[] {
		return [...this.entries];
	}

	clear(): void {
		this.entries.splice(0);
	}
}
