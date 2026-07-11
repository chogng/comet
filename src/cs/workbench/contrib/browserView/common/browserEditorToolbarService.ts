/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface BrowserEditorToolbarActions {
	onOpenSources(): void;
	onArchiveCurrentPage(): void | Promise<void>;
	onExportDocx(): void | Promise<void>;
	onCopyCurrentUrl(): void | Promise<void>;
	onClearBrowsingHistory(): void;
	onClearCookies(): void | Promise<void>;
	onClearCache(): void | Promise<void>;
}

export const IBrowserEditorToolbarService = createDecorator<IBrowserEditorToolbarService>('browserEditorToolbarService');

export interface IBrowserEditorToolbarService {
	readonly _serviceBrand: undefined;
	readonly actions: BrowserEditorToolbarActions;
	setActions(actions: BrowserEditorToolbarActions | null): void;
}
