/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { IClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import {
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResultShape,
	assertAgentContentResourceLease,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import { createAgentContentLeaseId } from 'cs/platform/agentHost/common/identities';

/** Publishes renderer-owned immutable content reads to Electron main. */
export class ClientContentResourceChannel implements IServerChannel<string> {
	constructor(private readonly resources: IClientContentResourceService) {}

	async call<T = unknown>(
		context: string,
		command: string,
		arg: unknown,
		token: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		if (context !== 'main') {
			throw new Error(`Client content-resource channel rejected context '${context}'.`);
		}
		let result: unknown;
		switch (command) {
			case 'open':
				assertAgentContentResourceReaderOpenRequest(arg);
				result = await this.resources.open(arg, token);
				assertAgentContentResourceLease(result, arg);
				break;
			case 'readBlob':
				assertAgentContentBlobReadRequest(arg);
				result = await this.resources.readBlob(arg, token);
				assertAgentContentBlobReadResultShape(result, arg);
				break;
			case 'readTreePage':
				assertAgentContentTreePageRequest(arg);
				result = await this.resources.readTreePage(arg, token);
				assertAgentContentTreePage(result, arg);
				break;
			case 'readTreeEntry':
				assertAgentContentTreeEntryReadRequest(arg);
				result = await this.resources.readTreeEntry(arg, token);
				assertAgentContentBlobReadResultShape(result, arg);
				break;
			case 'release':
				await this.resources.release(createAgentContentLeaseId(this.requireString(arg, 'release')), token);
				result = null;
				break;
			default:
				throw new Error(`Unknown client content-resource command '${command}'.`);
		}
		return result as T;
	}

	listen<T = unknown>(_context: string, event: string): Event<T> {
		throw new Error(`Client content-resource channel does not expose event '${event}'.`);
	}

	private requireString(value: unknown, field: string): string {
		if (typeof value !== 'string') {
			throw new TypeError(`Client content-resource ${field} must be a string.`);
		}
		return value;
	}

}
