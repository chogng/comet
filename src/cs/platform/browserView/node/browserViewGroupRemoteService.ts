/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'cs/base/common/event';
import { DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { IBrowserViewGroup, IBrowserViewGroupService, IBrowserViewGroupViewEvent, IBrowserViewGroupViewRemovalEvent, ipcBrowserViewGroupChannelName } from 'cs/platform/browserView/common/browserViewGroup';
import { IBrowserViewOwner } from 'cs/platform/browserView/common/browserView';
import { CDPEvent, CDPRequest, CDPResponse } from 'cs/platform/browserView/common/cdp/types';

/**
 * Remote-process service for managing browser view groups.
 *
 * Connects to the main-process {@link BrowserViewGroupMainService} via
 * IPC and provides {@link IBrowserViewGroup} instances for
 * interacting with groups.
 *
 * Usable from the shared process.
 */
export interface IBrowserViewGroupRemoteService {
	/**
	 * Create a new browser view group.
	 * @param owner The owner of the group's lifecycle.
	 */
	createGroup(owner: IBrowserViewOwner): Promise<IBrowserViewGroup>;
}

/**
 * Remote proxy for a browser view group living in the main process.
 */

class RemoteBrowserViewGroup implements IBrowserViewGroup {
	private readonly resources = new DisposableStore();
	private destroyed = false;
	private destroyPromise: Promise<void> | undefined;
	private destroyCompletionFailed = false;
	private destroyCompletionError: unknown;
	private readonly _onDidAddView = this.resources.add(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidAddView = this._onDidAddView.event;
	private readonly _onDidRemoveView = this.resources.add(new Emitter<IBrowserViewGroupViewRemovalEvent>());
	readonly onDidRemoveView = this._onDidRemoveView.event;
	private readonly _onDidDestroy = this.resources.add(new Emitter<void>());
	readonly onDidDestroy = this._onDidDestroy.event;
	private cdpMessageSubscription: IDisposable | undefined;
	private readonly _onCDPMessage = this.resources.add(new Emitter<CDPResponse | CDPEvent>({
		onWillAddFirstListener: () => this.startCDPMessageForwarding(),
		onDidRemoveLastListener: () => this.stopCDPMessageForwarding(),
	}));
	readonly onCDPMessage = this._onCDPMessage.event;

	constructor(
		readonly id: string,
		private readonly groupService: IBrowserViewGroupService,
		private readonly onDestroyed: () => void,
	) {
		this.resources.add(groupService.onDynamicDidAddView(this.id)(event => {
			this._onDidAddView.fire(event);
		}));
		this.resources.add(groupService.onDynamicDidRemoveView(this.id)(event => {
			this._onDidRemoveView.fire(event);
		}));
		this.resources.add(groupService.onDynamicDidDestroy(this.id)(() => {
			this.completeDestroy();
		}));
	}

	private startCDPMessageForwarding(): void {
		this.assertActive();
		if (this.cdpMessageSubscription) {
			throw new Error(`CDP message forwarding for Browser view group ${this.id} is already active.`);
		}
		this.cdpMessageSubscription = this.groupService.onDynamicCDPMessage(this.id)(event => {
			this._onCDPMessage.fire(event);
		});
	}

	private stopCDPMessageForwarding(): void {
		this.cdpMessageSubscription?.dispose();
		this.cdpMessageSubscription = undefined;
	}

	async addView(viewId: string): Promise<IBrowserViewGroupViewEvent> {
		this.assertActive();
		return this.groupService.addViewToGroup(this.id, viewId);
	}

	async removeView(viewId: string): Promise<void> {
		this.assertActive();
		return this.groupService.removeViewFromGroup(this.id, viewId);
	}

	async sendCDPMessage(msg: CDPRequest): Promise<void> {
		this.assertActive();
		return this.groupService.sendCDPMessage(this.id, msg);
	}

	destroy(): Promise<void> {
		if (this.destroyPromise) {
			return this.destroyPromise;
		}
		if (this.destroyed) {
			this.destroyPromise = this.destroyCompletionFailed
				? Promise.reject(this.destroyCompletionError)
				: Promise.resolve();
			return this.destroyPromise;
		}
		this.destroyPromise = Promise.resolve()
			.then(() => this.groupService.destroyGroup(this.id))
			.then(
				() => this.completeDestroy(),
				error => {
					try {
						this.completeDestroy();
					} catch (cleanupError) {
						throw new AggregateError([error, cleanupError], `Failed to destroy remote Browser view group ${this.id}.`);
					}
					throw error;
				},
			);
		return this.destroyPromise;
	}

	private completeDestroy(): void {
		if (this.destroyed) {
			if (this.destroyCompletionFailed) {
				throw this.destroyCompletionError;
			}
			return;
		}
		this.destroyed = true;
		const errors: unknown[] = [];
		try {
			this._onDidDestroy.fire();
		} catch (error) {
			errors.push(error);
		}
		try {
			this.resources.dispose();
		} catch (error) {
			errors.push(error);
		}
		try {
			this.onDestroyed();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			this.destroyCompletionFailed = true;
			this.destroyCompletionError = errors[0];
			throw errors[0];
		}
		if (errors.length > 1) {
			this.destroyCompletionFailed = true;
			this.destroyCompletionError = new AggregateError(errors, `Failed to complete remote Browser view group ${this.id} destruction.`);
			throw this.destroyCompletionError;
		}
	}

	private assertActive(): void {
		if (this.destroyed || this.destroyPromise) {
			throw new Error(`Browser view group ${this.id} is being destroyed.`);
		}
	}
}

export class BrowserViewGroupRemoteService implements IBrowserViewGroupRemoteService {
	private readonly _groupService: IBrowserViewGroupService;
	private readonly _groups = new Map<string, IBrowserViewGroup>();

	constructor(
		mainProcessService: IMainProcessService,
	) {
		const channel = mainProcessService.getChannel(ipcBrowserViewGroupChannelName);
		this._groupService = ProxyChannel.toService<IBrowserViewGroupService>(channel);
	}

	async createGroup(owner: IBrowserViewOwner): Promise<IBrowserViewGroup> {
		const id = await this._groupService.createGroup(owner);
		return this._wrap(id);
	}

	private _wrap(id: string): IBrowserViewGroup {
		const group = new RemoteBrowserViewGroup(id, this._groupService, () => {
			if (this._groups.get(id) === group) {
				this._groups.delete(id);
			}
		});
		this._groups.set(id, group);

		return group;
	}
}
