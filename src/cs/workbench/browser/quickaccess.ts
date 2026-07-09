/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'cs/platform/contextkey/common/contextkey';

export interface IWorkbenchQuickAccessConfiguration {
	readonly workbench: {
		readonly commandPalette: {
			readonly preserveInput: boolean;
		};
	};
}

export const InQuickPickContextKey = new RawContextKey<boolean>('inQuickPick', false);
export const COMMANDS_QUICK_ACCESS_PREFIX = '>';

export class PickerEditorState {
	constructor(readonly activeElement: Element | null = document.activeElement) {
	}

	restore(): void {
		if (this.activeElement instanceof HTMLElement) {
			this.activeElement.focus();
		}
	}
}
