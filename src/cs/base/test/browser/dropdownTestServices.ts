/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';

export async function createDropdownTestServices(): Promise<DropdownContextServices & {
	contextMenuService: IContextMenuService;
	contextViewProvider: IContextViewService;
	dispose(): void;
}> {
	const [{ PlatformContextMenuService }, { PlatformContextViewService }] = await Promise.all([
		import('cs/platform/contextview/browser/contextMenuService'),
		import('cs/platform/contextview/browser/contextViewService'),
	]);
	const contextViewProvider = new PlatformContextViewService();
	const contextMenuService = new PlatformContextMenuService(contextViewProvider);
	return {
		contextMenuService,
		contextViewProvider,
		dispose: () => {
			contextMenuService.dispose();
			contextViewProvider.dispose();
		},
	};
}
