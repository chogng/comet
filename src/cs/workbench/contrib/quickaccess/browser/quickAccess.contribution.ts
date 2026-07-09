/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'cs/nls';
import { quickAccessRegistry } from 'cs/platform/quickinput/common/quickAccess';
import { ShowAllCommandsAction } from 'cs/workbench/browser/actions/commandPaletteActions';
import { CommandsQuickAccessProvider } from 'cs/workbench/contrib/quickaccess/browser/commandsQuickAccess';
import { ViewQuickAccessProvider } from 'cs/workbench/contrib/quickaccess/browser/viewQuickAccess';

quickAccessRegistry.registerQuickAccessProvider({
	ctor: CommandsQuickAccessProvider,
	prefix: CommandsQuickAccessProvider.PREFIX,
	placeholder: localize('commandsQuickAccessPlaceholder', "Type the name of a command to run."),
	helpEntries: [{
		description: localize('commandsQuickAccess', "Show and Run Commands"),
		commandId: ShowAllCommandsAction.ID,
		commandCenterOrder: 20,
	}],
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: ViewQuickAccessProvider,
	prefix: ViewQuickAccessProvider.PREFIX,
	placeholder: localize('viewsQuickAccessPlaceholder', "Type the name of a view to open."),
});
