/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { localize2 } from 'cs/nls';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';
import { COMMANDS_QUICK_ACCESS_PREFIX } from 'cs/workbench/browser/quickaccess';

export class ShowAllCommandsAction extends Action2 {
	static readonly ID = 'workbench.action.showCommands';

	constructor() {
		super({
			id: ShowAllCommandsAction.ID,
			title: localize2('showAllCommands', "Show All Commands"),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP,
				secondary: [KeyCode.F1],
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IQuickInputService).quickAccess.show(COMMANDS_QUICK_ACCESS_PREFIX);
	}
}

registerAction2(ShowAllCommandsAction);
