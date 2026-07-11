/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	IBrowserEditorToolbarService,
	type BrowserEditorToolbarActions,
} from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';

export class BrowserEditorToolbarService implements IBrowserEditorToolbarService {
	declare readonly _serviceBrand: undefined;
	private configuredActions: BrowserEditorToolbarActions | null = null;

	get actions(): BrowserEditorToolbarActions {
		if (!this.configuredActions) {
			throw new Error('Browser editor toolbar actions have not been configured.');
		}
		return this.configuredActions;
	}

	setActions(actions: BrowserEditorToolbarActions | null): void {
		this.configuredActions = actions;
	}
}

registerSingleton(
	IBrowserEditorToolbarService,
	BrowserEditorToolbarService,
	InstantiationType.Delayed,
);
