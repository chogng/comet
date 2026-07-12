/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import {
	ISettingsController,
	type SettingsController,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

class SettingsControllerContribution {
	constructor(@ISettingsController settingsController: SettingsController) {
		settingsController.start();
	}
}

registerWorkbenchContribution(() => {
	getWorkbenchInstantiationService().createInstance(SettingsControllerContribution);
});
