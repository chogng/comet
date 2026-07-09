/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { localize } from 'cs/nls';
import { IWorkbenchSidebarEntryService, type WorkbenchSidebarEntry } from 'cs/workbench/services/sidebar/common/sidebarEntryService';
import { PickerQuickAccessProvider, type IPickerQuickAccessItem, type Picks } from 'cs/platform/quickinput/browser/pickerQuickAccess';

interface ViewQuickPick extends IPickerQuickAccessItem {
	readonly entry: WorkbenchSidebarEntry;
}

export class ViewQuickAccessProvider extends PickerQuickAccessProvider<ViewQuickPick> {
	static readonly PREFIX = 'view ';

	constructor(
		@IWorkbenchSidebarEntryService private readonly sidebarEntryService: IWorkbenchSidebarEntryService,
	) {
		super(ViewQuickAccessProvider.PREFIX, {
			noResultsPick: () => ({
				label: localize('noViewResults', "No matching views"),
				entry: 'home',
			}),
		});
	}

	protected getPicks(_filter: string, _token: CancellationToken): Picks<ViewQuickPick> {
		return [
			{
				label: localize('homeView', "Home"),
				entry: 'home',
				accept: () => this.sidebarEntryService.activateEntry('home'),
			},
			{
				label: localize('codeView', "Code"),
				entry: 'code',
				accept: () => this.sidebarEntryService.activateEntry('code'),
			},
		];
	}
}
