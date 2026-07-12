/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
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
	private readonly instances = new Map<number, PlaywrightService>();
	private readonly disposedWindows = new Set<number>();
	private readonly windowShutdowns = new Map<number, Promise<void>>();
	private shutdownRequested = false;
	private shutdownPromise: Promise<void> | undefined;

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
		if (command === 'shutdown') {
			return this.shutdown().then(() => undefined as T);
		}
		const [windowId, payload] = parseWindowRequest(arg);
		if (command === 'disposeWindow') {
			return this.disposeWindow(windowId).then(() => undefined as T);
		}
		const instance = this.getOrCreate(windowId);
		const target = (instance as unknown as Record<string, unknown>)[command];
		if (typeof target !== 'function') {
			throw new Error(`Method not found: ${command}`);
		}
		const methodArgs = Array.isArray(payload) ? [...payload] : [];
		if (command === 'captureSnapshot' || command === 'navigatePage') {
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

	private disposeWindow(windowId: number): Promise<void> {
		const existing = this.windowShutdowns.get(windowId);
		if (existing) {
			return existing;
		}
		if (this.shutdownPromise) {
			return this.shutdownPromise;
		}
		this.disposedWindows.add(windowId);
		const instance = this.instances.get(windowId);
		this.instances.delete(windowId);
		const shutdown = instance
			? Promise.resolve().then(() => instance.shutdown())
			: Promise.resolve();
		const finalizedShutdown = shutdown.finally(() => {
			if (this.windowShutdowns.get(windowId) === finalizedShutdown) {
				this.windowShutdowns.delete(windowId);
			}
			this.disposedWindows.delete(windowId);
		});
		this.windowShutdowns.set(windowId, finalizedShutdown);
		return finalizedShutdown;
	}

	private shutdown(): Promise<void> {
		if (!this.shutdownPromise) {
			this.shutdownRequested = true;
			const instances = [...this.instances.entries()];
			this.instances.clear();
			for (const [windowId] of instances) {
				this.disposedWindows.add(windowId);
			}
			const shutdowns = new Set<Promise<void>>([
				...this.windowShutdowns.values(),
				...instances.map(([, instance]) => Promise.resolve().then(() => instance.shutdown())),
			]);
			this.shutdownPromise = Promise.allSettled(shutdowns).then(results => {
				const errors = results
					.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
					.map(result => result.reason);
				if (errors.length === 1) {
					throw errors[0];
				}
				if (errors.length > 1) {
					throw new AggregateError(errors, 'Failed to shut down Playwright services.');
				}
			}).finally(() => {
				this.windowShutdowns.clear();
				this.disposedWindows.clear();
			});
		}
		return this.shutdownPromise;
	}

	private getOrCreate(windowId: number): PlaywrightService {
		if (this.shutdownRequested) {
			throw new Error('Playwright channel is shutting down.');
		}
		if (this.disposedWindows.has(windowId)) {
			throw new Error(`Playwright service for window ${windowId} has been disposed.`);
		}
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
