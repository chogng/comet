/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import {
	type IAgentContentBlobReadRequest,
	type IAgentContentBlobReadResult,
	type IAgentContentResourceLease,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentResourceReaderPort,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePage,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResultShape,
	assertAgentContentResourceLease,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import {
	type AgentContentLeaseId,
	createAgentContentLeaseId,
} from 'cs/platform/agentHost/common/identities';

/** Calls one renderer-published content reader through Electron reverse IPC. */
export class ClientContentResourceChannelClient implements IAgentContentResourceReaderPort {
	constructor(private readonly channel: IChannel) {}

	async open(
		request: IAgentContentResourceReaderOpenRequest,
		token: CancellationToken,
	): Promise<IAgentContentResourceLease> {
		assertAgentContentResourceReaderOpenRequest(request);
		const result = await this.channel.call<unknown>('open', request, token);
		assertAgentContentResourceLease(result, request);
		return result;
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentBlobReadRequest(request);
		const result = await this.channel.call<unknown>('readBlob', request, token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async readTreePage(
		request: IAgentContentTreePageRequest,
		token: CancellationToken,
	): Promise<IAgentContentTreePage> {
		assertAgentContentTreePageRequest(request);
		const result = await this.channel.call<unknown>('readTreePage', request, token);
		assertAgentContentTreePage(result, request);
		return result;
	}

	async readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentTreeEntryReadRequest(request);
		const result = await this.channel.call<unknown>('readTreeEntry', request, token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		createAgentContentLeaseId(lease);
		const result = await this.channel.call<unknown>('release', lease, token);
		if (result !== null) {
			throw new TypeError('Client content-resource release returned a non-null result.');
		}
	}
}
