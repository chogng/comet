/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import {
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentClientToolInvocation,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from 'cs/platform/agentHost/common/tools';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';

/** Invokes one renderer-published canonical Tool executor through Electron reverse IPC. */
export class ClientAgentToolChannelClient extends Disposable implements IAgentToolExecutorEndpoint {
	private readonly activeProgress = new Map<string, (progress: IAgentToolProgress) => void>();

	constructor(private readonly channel: IChannel) {
		super();
		this._register(channel.listen<unknown>('onDidProgress')(progress => {
			try {
				assertAgentToolProgress(progress);
				const reporter = this.activeProgress.get(progress.call);
				if (reporter === undefined) {
					throw new Error(`Client Tool progress addresses inactive call '${progress.call}'`);
				}
				reporter(progress);
			} catch (error) {
				onUnexpectedError(error);
			}
		}));
	}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		assertAgentToolCall(call);
		const invocation: IAgentClientToolInvocation = Object.freeze({
			call,
			...(target === undefined ? {} : { target }),
		});
		assertAgentClientToolInvocation(invocation);
		if (this.activeProgress.has(call.id)) {
			throw new Error(`Client Tool call '${call.id}' is already active`);
		}
		this.activeProgress.set(call.id, reportProgress);
		try {
			const result = await this.channel.call<unknown>('execute', invocation, cancellation);
			assertAgentToolResult(result);
			if (result.call !== call.id) {
				throw new Error(`Client Tool result does not address call '${call.id}'`);
			}
			return result;
		} finally {
			this.activeProgress.delete(call.id);
		}
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		assertAgentToolCall(call);
		const result = await this.channel.call<unknown>('cancel', call);
		if (result !== null) {
			throw new Error(`Client Tool cancellation for '${call.id}' returned a non-null result`);
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		assertAgentToolCall(call);
		const reconciliation = await this.channel.call<unknown>('reconcile', call);
		assertAgentToolEndpointReconciliation(reconciliation);
		if (reconciliation.kind === 'terminal' && reconciliation.result.call !== call.id) {
			throw new Error(`Client Tool reconciliation does not address call '${call.id}'`);
		}
		return reconciliation;
	}

	override dispose(): void {
		this.activeProgress.clear();
		super.dispose();
	}
}
