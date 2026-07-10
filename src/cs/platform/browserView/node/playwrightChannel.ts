/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { DisposableMap } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import type { ILogService } from 'cs/platform/log/common/log';
import type { ITelemetryService } from 'cs/platform/telemetry/common/telemetry';
import { BrowserViewGroupRemoteService } from 'cs/platform/browserView/node/browserViewGroupRemoteService';
import { PlaywrightService } from 'cs/platform/browserView/node/playwrightService';

type WindowRequest = readonly [number, unknown];

function parseWindowRequest(value: unknown): WindowRequest {
	if (!Array.isArray(value) || typeof value[0] !== 'number') {
		throw new Error('Shared process request did not include a window ID.');
	}
	return value as unknown as WindowRequest;
}

/** Hosts one Playwright service per workbench window in the shared process. */
export class PlaywrightChannel implements IServerChannel<string> {
	private readonly instances = new DisposableMap<number, PlaywrightService>();

	constructor(
		private readonly browserViewGroupRemoteService: BrowserViewGroupRemoteService,
		private readonly logService: ILogService,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		private readonly telemetryService: ITelemetryService,
	) {}

	call<T>(
		_context: string,
		command: string,
		arg: unknown,
		cancellationToken: CancellationToken,
	): Promise<T> {
		const [windowId, payload] = parseWindowRequest(arg);
		if (command === 'disposeWindow') {
			this.instances.deleteAndDispose(windowId);
			return Promise.resolve(undefined as T);
		}
		const instance = this.getOrCreate(windowId);
		const target = (instance as unknown as Record<string, unknown>)[command];
		if (typeof target !== 'function') {
			throw new Error(`Method not found: ${command}`);
		}
		const methodArgs = Array.isArray(payload) ? [...payload] : [];
		if (command === 'captureSnapshot') {
			methodArgs.push(cancellationToken);
		}
		return Promise.resolve(target.apply(instance, methodArgs)) as Promise<T>;
	}

	listen<T>(_context: string, event: string, arg: unknown): Event<T> {
		const [windowId] = parseWindowRequest(arg);
		const source = (this.getOrCreate(windowId) as unknown as Record<string, unknown>)[event];
		if (typeof source !== 'function') {
			throw new Error(`Event not found: ${event}`);
		}
		return source as Event<T>;
	}

	dispose(): void {
		this.instances.dispose();
	}

	private getOrCreate(windowId: number): PlaywrightService {
		let instance = this.instances.get(windowId);
		if (!instance) {
			instance = new PlaywrightService(
				windowId,
				this.browserViewGroupRemoteService,
				this.logService,
				this.agentNetworkFilterService,
				this.telemetryService,
			);
			this.instances.set(windowId, instance);
		}
		return instance;
	}
}
