/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { PlaywrightChannelClient } from 'cs/platform/browserView/common/playwrightChannelClient';

export class PlaywrightWorkbenchService extends PlaywrightChannelClient {
	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super(mainProcessService.getChannel('playwright'));
	}
}
