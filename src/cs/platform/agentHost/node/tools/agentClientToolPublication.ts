/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import type { AgentHostClientConnectionId } from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	type IAgentClientToolPublicationSnapshot,
	type IAgentToolExecutorEndpoint,
	validateAndFreezeAgentClientToolPublicationSnapshot,
} from 'cs/platform/agentHost/common/tools';
import { AgentToolEndpointRegistry } from './agentToolExecution.js';
import { AgentToolRegistry } from './agentToolRegistry.js';

/** Owns one logical connected client's exact registration and endpoint publication. */
export class AgentClientToolPublication extends Disposable {
	private snapshotRevision = 0;
	private canonicalSnapshot: string | undefined;

	constructor(
		private readonly connection: AgentHostClientConnectionId,
		private readonly registrations: AgentToolRegistry,
		private readonly endpoints: AgentToolEndpointRegistry,
		private readonly endpoint: IAgentToolExecutorEndpoint,
	) {
		super();
	}

	synchronize(snapshot: IAgentClientToolPublicationSnapshot): void {
		if (this._store.isDisposed) {
			throw new Error(`Client Tool publication '${this.connection}' is disposed`);
		}
		const frozen = validateAndFreezeAgentClientToolPublicationSnapshot(snapshot);
		if (frozen.connection !== this.connection) {
			throw new Error(`Client Tool snapshot addresses another logical connection '${frozen.connection}'`);
		}
		const canonical = encodeAgentHostProtocolValue(frozen);
		if (frozen.revision === this.snapshotRevision) {
			if (canonical !== this.canonicalSnapshot) {
				throw new Error(`Client Tool publication revision '${frozen.revision}' conflicts with recorded content`);
			}
			return;
		}
		if (frozen.revision !== this.snapshotRevision + 1) {
			throw new Error(`Client Tool publication expected revision '${this.snapshotRevision + 1}'`);
		}
		const references = frozen.registrations.map(registration => registration.executor);
		this.endpoints.assertClientReplacement(this.connection, references, this.endpoint);
		this.registrations.replaceClient(this.connection, frozen.registrations);
		this.endpoints.replaceClient(this.connection, references, this.endpoint);
		this.snapshotRevision = frozen.revision;
		this.canonicalSnapshot = canonical;
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		this.endpoints.removeClient(this.connection);
		this.registrations.removeClient(this.connection);
		super.dispose();
	}
}
