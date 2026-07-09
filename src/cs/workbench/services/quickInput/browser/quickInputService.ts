/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { QuickInputService as BaseQuickInputService } from 'cs/platform/quickinput/browser/quickInputService';
import { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';

export class QuickInputService extends BaseQuickInputService {
}

registerSingleton(IQuickInputService, QuickInputService, InstantiationType.Delayed);
