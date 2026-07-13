/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	type AgentHostClientConnectionId,
	type AgentToolCallId,
	createAgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentClientToolPublicationSnapshot,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
	validateAndFreezeAgentClientToolPublicationSnapshot,
	validateAndFreezeAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';

export const IClientAgentToolService = createDecorator<IClientAgentToolService>('clientAgentToolService');

export interface IClientAgentToolService {
	readonly _serviceBrand: undefined;
	readonly connection: AgentHostClientConnectionId;
	publish(registration: IAgentToolRegistration, endpoint: IAgentToolExecutorEndpoint): IDisposable;
}

export interface IClientAgentToolServiceOptions {
	readonly maximumCallRecords: number;
	synchronize(snapshot: IAgentClientToolPublicationSnapshot): Promise<void>;
}

interface IClientAgentToolRecord {
	readonly registration: IAgentToolRegistration;
	readonly endpoint: IAgentToolExecutorEndpoint;
}

interface IClientAgentToolCallRecord {
	readonly canonicalCall: string;
	readonly tool: IClientAgentToolRecord;
	readonly call: IAgentToolCall;
	readonly target: IAgentHostInteractionTarget | undefined;
	promise?: Promise<AgentToolResult>;
	lastProgressSequence: number;
	terminal: boolean;
	cancelled: boolean;
}

function assertEndpoint(endpoint: IAgentToolExecutorEndpoint): void {
	if (typeof endpoint.execute !== 'function'
		|| typeof endpoint.cancel !== 'function'
		|| typeof endpoint.reconcile !== 'function') {
		throw new Error('Invalid client Tool executor endpoint');
	}
}

/** Owns exact renderer Feature Tool registrations and canonical execution for one logical connection. */
export class ClientAgentToolService extends Disposable implements IClientAgentToolService {
	declare readonly _serviceBrand: undefined;
	private readonly tools = new Map<string, IClientAgentToolRecord>();
	private readonly toolIds = new Set<string>();
	private readonly functionNames = new Set<string>();
	private readonly executorIds = new Set<string>();
	private readonly calls = new Map<AgentToolCallId, IClientAgentToolCallRecord>();
	private revision = 0;
	private synchronization = Promise.resolve();

	constructor(
		readonly connection: AgentHostClientConnectionId,
		private readonly options: IClientAgentToolServiceOptions,
	) {
		super();
		createAgentHostClientConnectionId(connection);
		if (!Number.isSafeInteger(options.maximumCallRecords) || options.maximumCallRecords < 1) {
			throw new Error('Client Tool call record capacity must be a positive integer');
		}
	}

	publish(registration: IAgentToolRegistration, endpoint: IAgentToolExecutorEndpoint): IDisposable {
		if (this._store.isDisposed) {
			throw new Error('Client Tool service is disposed');
		}
		const frozen = validateAndFreezeAgentToolRegistration(registration);
		assertEndpoint(endpoint);
		if (frozen.executor.kind !== 'client' || frozen.executor.connection !== this.connection) {
			throw new Error(`Tool registration '${frozen.id}' does not address this logical client connection`);
		}
		const executor = frozen.executor;
		if (this.tools.has(frozen.id)
			|| this.toolIds.has(frozen.descriptor.id)
			|| this.functionNames.has(frozen.descriptor.functionName)
			|| this.executorIds.has(executor.executor)) {
			throw new Error(`Duplicate client Tool registration '${frozen.id}'`);
		}
		const record = Object.freeze({ registration: frozen, endpoint });
		this.tools.set(frozen.id, record);
		this.toolIds.add(frozen.descriptor.id);
		this.functionNames.add(frozen.descriptor.functionName);
		this.executorIds.add(executor.executor);
		this.publishSnapshot();
		let published = true;
		return toDisposable(() => {
			if (!published) {
				return;
			}
			published = false;
			if (this.tools.get(frozen.id) !== record) {
				return;
			}
			this.tools.delete(frozen.id);
			this.toolIds.delete(frozen.descriptor.id);
			this.functionNames.delete(frozen.descriptor.functionName);
			this.executorIds.delete(executor.executor);
			if (!this._store.isDisposed) {
				this.publishSnapshot();
			}
		});
	}

	/** Waits until every publication snapshot issued before this call is acknowledged. */
	synchronize(): Promise<void> {
		return this.synchronization;
	}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		assertAgentToolCall(call);
		const canonicalCall = encodeAgentHostProtocolValue(call);
		const existing = this.calls.get(call.id);
		if (existing !== undefined) {
			if (existing.canonicalCall !== canonicalCall || existing.promise === undefined) {
				throw new Error(`Client Tool call '${call.id}' is already bound to different content`);
			}
			return existing.promise;
		}
		if (this.calls.size >= this.options.maximumCallRecords) {
			throw new Error('Client Tool call record capacity is exhausted');
		}
		const tool = this.requireTool(call);
		const exactTarget = this.validateTarget(call, target, tool.registration);
		const record: IClientAgentToolCallRecord = {
			canonicalCall,
			tool,
			call,
			target: exactTarget,
			lastProgressSequence: 0,
			terminal: false,
			cancelled: false,
		};
		this.calls.set(call.id, record);
		record.promise = Promise.resolve().then(async () => {
			try {
				const result = await tool.endpoint.execute(
					call,
					exactTarget,
					progress => this.acceptProgress(record, progress, reportProgress),
					cancellation,
				);
				assertAgentToolResult(result);
				if (result.call !== call.id) {
					throw new Error(`Client Tool result does not address call '${call.id}'`);
				}
				return result;
			} finally {
				record.terminal = true;
			}
		});
		return record.promise;
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		assertAgentToolCall(call);
		const record = this.requireCall(call);
		if (record.cancelled || record.terminal) {
			return;
		}
		record.cancelled = true;
		await record.tool.endpoint.cancel(record.call);
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		assertAgentToolCall(call);
		const record = this.requireCall(call);
		const reconciliation = await record.tool.endpoint.reconcile(record.call);
		assertAgentToolEndpointReconciliation(reconciliation);
		if (reconciliation.kind === 'terminal' && reconciliation.result.call !== call.id) {
			throw new Error(`Client Tool reconciliation does not address call '${call.id}'`);
		}
		return reconciliation;
	}

	private publishSnapshot(): void {
		this.revision += 1;
		const snapshot = validateAndFreezeAgentClientToolPublicationSnapshot({
			connection: this.connection,
			revision: this.revision,
			registrations: Object.freeze([...this.tools.values()].map(record => record.registration)),
		});
		this.synchronization = this.synchronization.then(() => this.options.synchronize(snapshot));
		void this.synchronization.catch(onUnexpectedError);
	}

	private requireTool(call: IAgentToolCall): IClientAgentToolRecord {
		const tool = this.tools.get(call.registrationId);
		if (tool === undefined) {
			throw new Error(`Client Tool registration '${call.registrationId}' is unavailable`);
		}
		const registration = tool.registration;
		if (registration.revision !== call.registrationRevision
			|| registration.descriptor.id !== call.tool
			|| registration.descriptor.revision !== call.descriptor
			|| registration.executor.kind !== 'client'
			|| registration.executor.connection !== this.connection) {
			throw new Error(`Client Tool call '${call.id}' does not match its exact registration`);
		}
		return tool;
	}

	private validateTarget(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		registration: IAgentToolRegistration,
	): IAgentHostInteractionTarget | undefined {
		if (registration.descriptor.targetTypes.length === 0) {
			if (call.target !== undefined || target !== undefined) {
				throw new Error(`Target-free client Tool call '${call.id}' received a target`);
			}
			return undefined;
		}
		if (call.target === undefined || target === undefined) {
			throw new Error(`Targeted client Tool call '${call.id}' is missing its accepted target`);
		}
		assertAgentHostInteractionTarget(target);
		if (target.id !== call.target
			|| !registration.descriptor.targetTypes.includes(target.type)
			|| target.authority.kind !== 'client'
			|| target.authority.connection !== this.connection) {
			throw new Error(`Client Tool call '${call.id}' target is not exact`);
		}
		return target;
	}

	private acceptProgress(
		record: IClientAgentToolCallRecord,
		progress: IAgentToolProgress,
		reportProgress: (progress: IAgentToolProgress) => void,
	): void {
		if (record.terminal) {
			throw new Error(`Client Tool call '${record.call.id}' emitted progress after completion`);
		}
		assertAgentToolProgress(progress);
		if (progress.call !== record.call.id || progress.sequence !== record.lastProgressSequence + 1) {
			throw new Error(`Client Tool call '${record.call.id}' emitted non-contiguous progress`);
		}
		record.lastProgressSequence = progress.sequence;
		reportProgress(progress);
	}

	private requireCall(call: IAgentToolCall): IClientAgentToolCallRecord {
		const record = this.calls.get(call.id);
		if (record === undefined || record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Client Tool call '${call.id}' is unavailable or conflicts with its recorded identity`);
		}
		return record;
	}
}
