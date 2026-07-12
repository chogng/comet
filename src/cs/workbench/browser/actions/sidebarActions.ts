/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from 'cs/nls';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IWorkbenchSidebarEntryService } from 'cs/workbench/services/sidebar/common/sidebarEntryService';

export class ActivateHomeSidebarEntryAction extends Action2 {
	static readonly ID = 'workbench.action.activateHomeSidebarEntry';

	constructor() {
		super({
			id: ActivateHomeSidebarEntryAction.ID,
			title: localize2('activateHomeSidebarEntry', "Open Home"),
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchSidebarEntryService).activateEntry('home');
	}
}

export class ActivateCodeSidebarEntryAction extends Action2 {
	static readonly ID = 'workbench.action.activateCodeSidebarEntry';

	constructor() {
		super({
			id: ActivateCodeSidebarEntryAction.ID,
			title: localize2('activateCodeSidebarEntry', "Open Code"),
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchSidebarEntryService).activateEntry('code');
	}
}

registerAction2(ActivateHomeSidebarEntryAction);
registerAction2(ActivateCodeSidebarEntryAction);
