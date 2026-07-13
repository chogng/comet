/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import {
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from 'cs/platform/agentHost/common/tools';

/** Exposes one renderer Tool executor service to its bound local Host connection. */
export class ClientAgentToolChannel extends Disposable implements IServerChannel<string> {
	private readonly progressEmitter = this._register(new Emitter<IAgentToolProgress>({ onListenerError: onUnexpectedError }));

	constructor(private readonly tools: IAgentToolExecutorEndpoint) {
		super();
	}

	async call<T = unknown>(
		context: string,
		command: string,
		arg: unknown,
		cancellation: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		if (context !== 'main') {
			throw new Error(`Client Tool channel rejected context '${context}'`);
		}
		let result: unknown;
		switch (command) {
			case 'execute':
				assertAgentClientToolInvocation(arg);
				result = await this.tools.execute(
					arg.call,
					arg.target,
					progress => {
						assertAgentToolProgress(progress);
						if (progress.call !== arg.call.id) {
							throw new Error(`Client Tool progress does not address call '${arg.call.id}'`);
						}
						this.progressEmitter.fire(progress);
					},
					cancellation,
				);
				assertAgentToolResult(result);
				if (result.call !== arg.call.id) {
					throw new Error(`Client Tool result does not address call '${arg.call.id}'`);
				}
				break;
			case 'cancel':
				assertAgentToolCall(arg);
				await this.tools.cancel(arg);
				result = null;
				break;
			case 'reconcile':
				assertAgentToolCall(arg);
				result = await this.tools.reconcile(arg);
				assertAgentToolEndpointReconciliation(result);
				break;
			default:
				throw new Error(`Unknown client Tool command '${command}'`);
		}
		return result as T;
	}

	listen<T = unknown>(context: string, event: string, arg: unknown): Event<T> {
		if (context !== 'main') {
			throw new Error(`Client Tool channel rejected context '${context}'`);
		}
		if (event !== 'onDidProgress' || arg !== undefined) {
			throw new Error(`Unknown client Tool event '${event}'`);
		}
		return this.progressEmitter.event as Event<T>;
	}
}
