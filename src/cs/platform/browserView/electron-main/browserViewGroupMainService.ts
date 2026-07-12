/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IBrowserViewOwner } from 'cs/platform/browserView/common/browserView';
import type { IBrowserViewGroupService, IBrowserViewGroupViewEvent, IBrowserViewGroupViewRemovalEvent } from 'cs/platform/browserView/common/browserViewGroup';
import type { CDPEvent, CDPRequest, CDPResponse } from 'cs/platform/browserView/common/cdp/types';
import { BrowserViewGroup } from 'cs/platform/browserView/electron-main/browserViewGroup';
import { BrowserViewMainService } from 'cs/platform/browserView/electron-main/browserViewMainService';
import { getWindowById } from 'cs/platform/windows/electron-main/windows';

/** Main-process owner for browser view CDP groups. */
export class BrowserViewGroupMainService extends Disposable implements IBrowserViewGroupService {
	private readonly groups = new Map<string, BrowserViewGroup>();
	private readonly closingWindows = new Set<number>();
	private readonly windowShutdowns = new Map<number, Promise<void>>();
	private shutdownRequested = false;
	private shutdownPromise: Promise<void> | undefined;

	constructor(private readonly browserViewMainService: BrowserViewMainService) {
		super();
	}

	async createGroup(owner: IBrowserViewOwner): Promise<string> {
		if (this.shutdownRequested || this.closingWindows.has(owner.mainWindowId)) {
			throw new Error(`Browser view groups for window ${owner.mainWindowId} are shutting down.`);
		}
		const ownerWindow = getWindowById(owner.mainWindowId);
		if (!ownerWindow) {
			throw new Error(`Owner window ${owner.mainWindowId} not found`);
		}

		const id = generateUuid();
		const group = new BrowserViewGroup(id, owner, this.browserViewMainService);
		this.groups.set(id, group);

		const closeListener = () => {
			void this.destroyGroup(id).catch(error => {
				console.error(`Failed to destroy Browser view group ${id} while closing window ${owner.mainWindowId}.`, error);
			});
		};
		ownerWindow.once('closed', closeListener);
		Event.once(group.onDidDestroy)(() => {
			ownerWindow.removeListener('closed', closeListener);
			this.groups.delete(id);
		});
		return id;
	}

	async destroyGroup(groupId: string): Promise<void> {
		const group = this.groups.get(groupId);
		if (!group) {
			return;
		}
		await group.destroy();
	}

	shutdownWindow(windowId: number): Promise<void> {
		const existing = this.windowShutdowns.get(windowId);
		if (existing) {
			return existing;
		}
		this.closingWindows.add(windowId);
		const shutdown = this.destroyGroups(
			[...this.groups.values()].filter(group => group.owner.mainWindowId === windowId),
			`Failed to destroy Browser view groups for window ${windowId}.`,
		);
		this.windowShutdowns.set(windowId, shutdown);
		return shutdown;
	}

	finalizeWindow(windowId: number): void {
		this.closingWindows.delete(windowId);
		this.windowShutdowns.delete(windowId);
	}

	shutdown(): Promise<void> {
		if (!this.shutdownPromise) {
			this.shutdownRequested = true;
			for (const group of this.groups.values()) {
				this.closingWindows.add(group.owner.mainWindowId);
			}
			const windowsAlreadyShuttingDown = new Set(this.windowShutdowns.keys());
			const shutdowns = [
				...this.windowShutdowns.values(),
				...[...this.groups.values()]
					.filter(group => !windowsAlreadyShuttingDown.has(group.owner.mainWindowId))
					.map(group => group.destroy()),
			];
			this.shutdownPromise = this.waitForShutdowns(shutdowns, 'Failed to destroy Browser view groups.');
		}
		return this.shutdownPromise;
	}

	async addViewToGroup(groupId: string, viewId: string): Promise<IBrowserViewGroupViewEvent> {
		return this.getGroup(groupId).addView(viewId);
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

	onDynamicDidRemoveView(groupId: string): Event<IBrowserViewGroupViewRemovalEvent> {
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

	private async destroyGroups(groups: readonly BrowserViewGroup[], message: string): Promise<void> {
		await this.waitForShutdowns(groups.map(group => group.destroy()), message);
	}

	private async waitForShutdowns(shutdowns: readonly Promise<void>[], message: string): Promise<void> {
		const results = await Promise.allSettled(shutdowns);
		const errors = results
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map(result => result.reason);
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, message);
		}
	}
}
