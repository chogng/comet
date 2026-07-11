/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, type Event } from 'cs/base/common/event';
import { Schemas } from 'cs/base/common/network';
import type { URI } from 'cs/base/common/uri';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { BrowserViewGroupRemoteService } from 'cs/platform/browserView/node/browserViewGroupRemoteService';
import { PlaywrightChannel } from 'cs/platform/browserView/node/playwrightChannel';
import type { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import type { ILogService } from 'cs/platform/log/common/log';
import { extractDomainFromUri, isDomainAllowed } from 'cs/platform/networkFilter/common/domainMatcher';
import type { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import { NullTelemetryService } from 'cs/platform/telemetry/common/telemetry';

class SharedProcessLogService implements ILogService {
	declare readonly _serviceBrand: undefined;

	trace(message: string, ...args: unknown[]): void { console.debug(message, ...args); }
	debug(message: string, ...args: unknown[]): void { console.debug(message, ...args); }
	info(message: string, ...args: unknown[]): void { console.info(message, ...args); }
	warn(message: string, ...args: unknown[]): void { console.warn(message, ...args); }
	error(message: string | Error, ...args: unknown[]): void { console.error(message, ...args); }
}

class SharedNetworkFilterService implements IAgentNetworkFilterService {
	declare readonly _serviceBrand: undefined;

	private enabled = false;
	private allowed: string[] = [];
	private denied: string[] = [];
	private readonly onDidChangeEmitter = new EventEmitter<void>();
	readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

	update(enabled: boolean, allowed: readonly string[], denied: readonly string[]): void {
		this.enabled = enabled;
		this.allowed = [...allowed];
		this.denied = [...denied];
		this.onDidChangeEmitter.fire();
	}

	isUriAllowed(uri: URI): boolean {
		if (!this.enabled || uri.scheme === Schemas.file || !uri.authority) {
			return true;
		}
		const domain = extractDomainFromUri(uri);
		return !domain || isDomainAllowed(domain, this.allowed, this.denied);
	}

	formatError(uri: URI): string {
		return `Access to ${uri.authority} is blocked by network domain policy.`;
	}
}

function createNetworkFilterChannel(networkFilter: SharedNetworkFilterService): IServerChannel<string> {
	return {
		call: async <T>(_context: string, command: string, arg: unknown) => {
			if (command !== 'update' || !Array.isArray(arg) || typeof arg[0] !== 'boolean' || !Array.isArray(arg[1]) || !Array.isArray(arg[2])) {
				throw new Error('Invalid shared network filter update.');
			}
			networkFilter.update(arg[0], arg[1], arg[2]);
			return undefined as T;
		},
		listen: () => {
			throw new Error('Shared network filter does not expose events.');
		},
	};
}

export function registerSharedProcessChannels(ipc: MessagePortChannel): void {
	const mainProcessService: IMainProcessService = {
		_serviceBrand: undefined,
		getChannel: channelName => ipc.getChannel(channelName),
		registerChannel: () => {
			throw new Error('The shared process does not register channels on the main process.');
		},
	};
	const networkFilter = new SharedNetworkFilterService();
	const logService = new SharedProcessLogService();
	ipc.registerChannel('playwright', new PlaywrightChannel(
		new BrowserViewGroupRemoteService(mainProcessService),
		logService,
		networkFilter,
		new NullTelemetryService(),
	));
	ipc.registerChannel('networkFilter', createNetworkFilterChannel(networkFilter));
}
