/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IAgent } from 'cs/platform/agentHost/common/agent';
import type { AgentId, AgentPackageId } from 'cs/platform/agentHost/common/identities';
import type { IAgentHostBuiltInAgentAvailability } from 'cs/platform/agentHost/common/protocol';
import type {
	IAgentHostBuiltInAgentRegistry,
	IPreparedBuiltInAgent,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';

export interface IBuiltInAgentDefinition {
	readonly availability: Omit<IAgentHostBuiltInAgentAvailability, 'state'>;
	create(): Promise<{
		readonly agent: IAgent;
		readonly lifetime: IDisposable;
	}>;
}

interface IActiveBuiltInAgent {
	readonly agent: IAgent;
	readonly lifetime: IDisposable;
}

function builtInKey(packageId: AgentPackageId | string, agentId: AgentId): string {
	return `${packageId}\u0000${agentId}`;
}

/** Owns cold product Agent construction and publishes only explicitly committed runtimes. */
export class BuiltInAgentRegistry extends Disposable implements IAgentHostBuiltInAgentRegistry {
	readonly availability: readonly Omit<IAgentHostBuiltInAgentAvailability, 'state'>[];
	private readonly definitions: ReadonlyMap<AgentId, IBuiltInAgentDefinition>;
	private readonly ownership: ReadonlySet<string>;
	private readonly active = new Map<AgentId, IActiveBuiltInAgent>();

	constructor(definitions: readonly IBuiltInAgentDefinition[]) {
		super();
		const byAgent = new Map<AgentId, IBuiltInAgentDefinition>();
		const ownership = new Set<string>();
		for (const definition of definitions) {
			const { availability } = definition;
			const key = builtInKey(availability.packageId, availability.agentId);
			if (
				availability.sessionType.packageId !== availability.packageId
				|| availability.sessionType.agentId !== availability.agentId
				|| byAgent.has(availability.agentId)
				|| ownership.has(key)
			) {
				throw new Error(`Invalid built-in Agent definition '${availability.agentId}'.`);
			}
			byAgent.set(availability.agentId, definition);
			ownership.add(key);
		}
		this.definitions = byAgent;
		this.ownership = ownership;
		this.availability = Object.freeze(definitions.map(definition => Object.freeze({
			...definition.availability,
			sessionType: Object.freeze({ ...definition.availability.sessionType }),
		})));
		this._register({
			dispose: () => {
				for (const active of this.active.values()) {
					active.lifetime.dispose();
				}
				this.active.clear();
			},
		});
	}

	owns(packageId: string, agent: AgentId): boolean {
		return this.ownership.has(builtInKey(packageId, agent));
	}

	async prepare(agentId: AgentId): Promise<IPreparedBuiltInAgent> {
		if (this.active.has(agentId)) {
			throw new Error(`Built-in Agent '${agentId}' is already prepared.`);
		}
		const definition = this.definitions.get(agentId);
		if (definition === undefined) {
			throw new Error(`Built-in Agent '${agentId}' is not available.`);
		}
		const created = await definition.create();
		if (
			created.agent.id !== agentId
			|| !this.owns(created.agent.registration.packageId, created.agent.id)
		) {
			created.lifetime.dispose();
			throw new Error(`Built-in Agent '${agentId}' factory returned mismatched ownership.`);
		}
		let settled = false;
		return Object.freeze({
			agent: created.agent,
			commit: () => {
				if (settled || this.active.has(agentId)) {
					throw new Error(`Built-in Agent '${agentId}' preparation is already settled.`);
				}
				settled = true;
				this.active.set(agentId, created);
			},
			rollback: () => {
				if (settled) {
					throw new Error(`Built-in Agent '${agentId}' preparation is already settled.`);
				}
				settled = true;
				created.lifetime.dispose();
			},
		});
	}
}
