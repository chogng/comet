/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { Disposable, DisposableMap } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IBrowserViewOwner } from 'cs/platform/browserView/common/browserView';
import type { IBrowserViewGroupService, IBrowserViewGroupViewEvent } from 'cs/platform/browserView/common/browserViewGroup';
import type { CDPEvent, CDPRequest, CDPResponse } from 'cs/platform/browserView/common/cdp/types';
import { BrowserViewGroup } from 'cs/platform/browserView/electron-main/browserViewGroup';
import { BrowserViewMainService } from 'cs/platform/browserView/electron-main/browserViewMainService';
import { getWindowById } from 'cs/platform/windows/electron-main/windows';

/** Main-process owner for browser view CDP groups. */
export class BrowserViewGroupMainService extends Disposable implements IBrowserViewGroupService {
	private readonly groups = this._register(new DisposableMap<string, BrowserViewGroup>());

	constructor(private readonly browserViewMainService: BrowserViewMainService) {
		super();
	}

	async createGroup(owner: IBrowserViewOwner): Promise<string> {
		const ownerWindow = getWindowById(owner.mainWindowId);
		if (!ownerWindow) {
			throw new Error(`Owner window ${owner.mainWindowId} not found`);
		}

		const id = generateUuid();
		const group = new BrowserViewGroup(id, owner, this.browserViewMainService);
		this.groups.set(id, group);

		const closeListener = () => group.dispose();
		ownerWindow.once('closed', closeListener);
		Event.once(group.onDidDestroy)(() => {
			ownerWindow.removeListener('closed', closeListener);
			this.groups.deleteAndLeak(id);
		});
		return id;
	}

	async destroyGroup(groupId: string): Promise<void> {
		this.groups.deleteAndDispose(groupId);
	}

	async addViewToGroup(groupId: string, viewId: string): Promise<void> {
		await this.getGroup(groupId).addView(viewId);
	}

	async removeViewFromGroup(groupId: string, viewId: string): Promise<void> {
		await this.getGroup(groupId).removeView(viewId);
	}

	async sendCDPMessage(groupId: string, message: CDPRequest): Promise<void> {
		await this.getGroup(groupId).sendCDPMessage(message);
	}

	onDynamicDidAddView(groupId: string): Event<IBrowserViewGroupViewEvent> {
		return this.getGroup(groupId).onDidAddView;
	}

	onDynamicDidRemoveView(groupId: string): Event<IBrowserViewGroupViewEvent> {
		return this.getGroup(groupId).onDidRemoveView;
	}

	onDynamicDidDestroy(groupId: string): Event<void> {
		return this.getGroup(groupId).onDidDestroy;
	}

	onDynamicCDPMessage(groupId: string): Event<CDPResponse | CDPEvent> {
		return this.getGroup(groupId).onCDPMessage;
	}

	private getGroup(groupId: string): BrowserViewGroup {
		const group = this.groups.get(groupId);
		if (!group) {
			throw new Error(`Browser view group ${groupId} not found`);
		}
		return group;
	}
}
