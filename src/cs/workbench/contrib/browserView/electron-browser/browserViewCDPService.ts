/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { CDPEvent, CDPRequest, CDPResponse } from 'cs/platform/browserView/common/cdp/types';
import { IBrowserViewGroupService, ipcBrowserViewGroupChannelName } from 'cs/platform/browserView/common/browserViewGroup';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { IBrowserViewCDPService } from 'cs/workbench/contrib/browserView/common/browserView';
import { mainWindow } from 'cs/base/browser/window';

export class BrowserViewCDPService extends Disposable implements IBrowserViewCDPService {
	declare readonly _serviceBrand: undefined;

	private readonly _groupService: IBrowserViewGroupService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		const channel = mainProcessService.getChannel(ipcBrowserViewGroupChannelName);
		this._groupService = ProxyChannel.toService<IBrowserViewGroupService>(channel);
	}

	async createSessionGroup(browserId: string): Promise<string> {
		const groupId = await this._groupService.createGroup({ mainWindowId: mainWindow.vscodeWindowId });
		await this._groupService.addViewToGroup(groupId, browserId);
		return groupId;
	}

	async destroySessionGroup(groupId: string): Promise<void> {
		await this._groupService.destroyGroup(groupId);
	}

	async sendCDPMessage(groupId: string, message: CDPRequest): Promise<void> {
		await this._groupService.sendCDPMessage(groupId, message);
	}

	onCDPMessage(groupId: string): Event<CDPResponse | CDPEvent> {
		return this._groupService.onDynamicCDPMessage(groupId);
	}

	onDidDestroy(groupId: string): Event<void> {
		return this._groupService.onDynamicDidDestroy(groupId);
	}
}
