/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentDescriptor, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	IAgentHostActiveAgentCatalogEntry,
	IAgentHostSessionTypeCatalog,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';

/** Product-owned Session type projection for one exact runtime registration. */
export interface ILocalAgentHostSessionTypeCatalogEntry {
	readonly registration: IAgentRuntimeRegistration;
	readonly resolve: (descriptor: IAgentDescriptor) => IAgentHostSessionTypeDescriptor;
}

function registrationKey(registration: IAgentRuntimeRegistration): string {
	return encodeAgentHostProtocolValue(registration);
}

/** Resolves createable Session types from the exact active local runtime catalog. */
export class LocalAgentHostSessionTypeCatalog implements IAgentHostSessionTypeCatalog {
	private readonly entries: ReadonlyMap<string, ILocalAgentHostSessionTypeCatalogEntry>;

	constructor(entries: readonly ILocalAgentHostSessionTypeCatalogEntry[]) {
		const keyed = entries.map(entry => [registrationKey(entry.registration), entry] as const);
		if (new Set(keyed.map(([key]) => key)).size !== keyed.length) {
			throw new Error('Local Agent Host Session type catalog contains a duplicate runtime registration');
		}
		this.entries = new Map(keyed);
	}

	resolve(activeAgents: readonly IAgentHostActiveAgentCatalogEntry[]): readonly IAgentHostSessionTypeDescriptor[] {
		return Object.freeze(activeAgents.map(activeAgent => {
			const entry = this.entries.get(registrationKey(activeAgent.registration));
			if (entry === undefined) {
				throw new Error(`Local Agent Host has no Session type product for runtime '${activeAgent.registration.revision}'`);
			}
			if (
				activeAgent.descriptor.id !== activeAgent.registration.agentId
				|| activeAgent.descriptor.packageId !== activeAgent.registration.packageId
				|| activeAgent.descriptor.revision !== activeAgent.registration.descriptorRevision
				|| activeAgent.descriptor.capabilities.revision !== activeAgent.registration.capabilityRevision
			) {
				throw new Error(`Local Agent Host runtime '${activeAgent.registration.revision}' published a mismatched descriptor`);
			}
			const sessionType = entry.resolve(activeAgent.descriptor);
			if (
				sessionType.agentId !== activeAgent.registration.agentId
				|| sessionType.packageId !== activeAgent.registration.packageId
			) {
				throw new Error(`Local Agent Host runtime '${activeAgent.registration.revision}' resolved a mismatched Session type`);
			}
			return sessionType;
		}));
	}
}
