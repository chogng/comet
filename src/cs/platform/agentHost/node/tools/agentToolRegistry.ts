/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { AgentHostClientConnectionId } from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentToolExecutorReference,
	IAgentToolRegistration,
	validateAndFreezeAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';

export function agentToolExecutorKey(reference: AgentToolExecutorReference): string {
	switch (reference.kind) {
		case 'client': return `client\u0000${reference.connection}\u0000${reference.executor}`;
		case 'host': return `host\u0000${reference.executor}`;
		case 'agent': return `agent\u0000${reference.agent}\u0000${reference.registration}\u0000${reference.executor}`;
		case 'mcp': return `mcp\u0000${reference.server}\u0000${reference.tool}`;
		default: throw new Error('Unknown Tool executor kind');
	}
}

function agentToolRegistrationKey(registration: IAgentToolRegistration): string {
	return `${agentToolExecutorKey(registration.executor)}\u0000${registration.id}`;
}

function cloneIndex(index: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
	return new Map([...index].map(([identity, keys]) => [identity, new Set(keys)]));
}

function addToIndex(index: Map<string, Set<string>>, identity: string, key: string): void {
	const keys = index.get(identity);
	if (keys === undefined) {
		index.set(identity, new Set([key]));
	} else {
		keys.add(key);
	}
}

function removeFromIndex(index: Map<string, Set<string>>, identity: string, key: string): void {
	const keys = index.get(identity);
	if (keys === undefined || !keys.delete(key)) {
		throw new Error(`Tool registry index '${identity}' lost registration '${key}'`);
	}
	if (keys.size === 0) {
		index.delete(identity);
	}
}

function equivalentConnectedClientRegistration(
	left: IAgentToolRegistration,
	right: IAgentToolRegistration,
): boolean {
	return left.descriptor.targetTypes.length !== 0
		&& left.executor.kind === 'client'
		&& right.executor.kind === 'client'
		&& left.executor.connection !== right.executor.connection
		&& encodeAgentHostProtocolValue(left.descriptor) === encodeAgentHostProtocolValue(right.descriptor);
}

function assertCompatibleIndex(
	registrations: ReadonlyMap<string, IAgentToolRegistration>,
	index: ReadonlyMap<string, ReadonlySet<string>>,
	identity: string,
	candidate: IAgentToolRegistration,
	message: string,
): void {
	const keys = index.get(identity);
	if (keys === undefined) {
		return;
	}
	for (const key of keys) {
		const existing = registrations.get(key);
		if (existing === undefined) {
			throw new Error(`Tool registry index '${identity}' addresses a missing registration`);
		}
		if (!equivalentConnectedClientRegistration(existing, candidate)) {
			throw new Error(message);
		}
	}
}

function assertCanAddRegistration(
	registrations: ReadonlyMap<string, IAgentToolRegistration>,
	registrationIds: ReadonlyMap<string, ReadonlySet<string>>,
	tools: ReadonlyMap<string, ReadonlySet<string>>,
	functions: ReadonlyMap<string, ReadonlySet<string>>,
	candidate: IAgentToolRegistration,
): void {
	assertCompatibleIndex(
		registrations,
		registrationIds,
		candidate.id,
		candidate,
		`Duplicate Tool registration '${candidate.id}'`,
	);
	assertCompatibleIndex(
		registrations,
		tools,
		candidate.descriptor.id,
		candidate,
		`Ambiguous Tool identity '${candidate.descriptor.id}'`,
	);
	assertCompatibleIndex(
		registrations,
		functions,
		candidate.descriptor.functionName,
		candidate,
		`Ambiguous Tool function '${candidate.descriptor.functionName}'`,
	);
}

function addRegistration(
	registrations: Map<string, IAgentToolRegistration>,
	registrationIds: Map<string, Set<string>>,
	tools: Map<string, Set<string>>,
	functions: Map<string, Set<string>>,
	registration: IAgentToolRegistration,
): string {
	assertCanAddRegistration(registrations, registrationIds, tools, functions, registration);
	const key = agentToolRegistrationKey(registration);
	if (registrations.has(key)) {
		throw new Error(`Duplicate Tool registration '${registration.id}'`);
	}
	registrations.set(key, registration);
	addToIndex(registrationIds, registration.id, key);
	addToIndex(tools, registration.descriptor.id, key);
	addToIndex(functions, registration.descriptor.functionName, key);
	return key;
}

function removeRegistration(
	registrations: Map<string, IAgentToolRegistration>,
	registrationIds: Map<string, Set<string>>,
	tools: Map<string, Set<string>>,
	functions: Map<string, Set<string>>,
	key: string,
): IAgentToolRegistration {
	const registration = registrations.get(key);
	if (registration === undefined) {
		throw new Error(`Tool registry lost registration '${key}'`);
	}
	registrations.delete(key);
	removeFromIndex(registrationIds, registration.id, key);
	removeFromIndex(tools, registration.descriptor.id, key);
	removeFromIndex(functions, registration.descriptor.functionName, key);
	return registration;
}

/** Owns canonical registrations only; endpoint availability is intentionally separate. */
export class AgentToolRegistry {
	private registrations = new Map<string, IAgentToolRegistration>();
	private registrationIds = new Map<string, Set<string>>();
	private tools = new Map<string, Set<string>>();
	private functions = new Map<string, Set<string>>();
	private readonly clientRegistrations = new Map<AgentHostClientConnectionId, ReadonlySet<string>>();

	publish(registration: IAgentToolRegistration): IDisposable {
		const frozen = validateAndFreezeAgentToolRegistration(registration);
		const key = addRegistration(
			this.registrations,
			this.registrationIds,
			this.tools,
			this.functions,
			frozen,
		);
		let published = true;
		return toDisposable(() => {
			if (!published) { return; }
			published = false;
			if (this.registrations.get(key) === frozen) {
				removeRegistration(
					this.registrations,
					this.registrationIds,
					this.tools,
					this.functions,
					key,
				);
			}
		});
	}

	replaceClient(
		connection: AgentHostClientConnectionId,
		registrations: readonly IAgentToolRegistration[],
	): void {
		const frozen = registrations.map(validateAndFreezeAgentToolRegistration);
		const nextRegistrations = new Map(this.registrations);
		const nextRegistrationIds = cloneIndex(this.registrationIds);
		const nextTools = cloneIndex(this.tools);
		const nextFunctions = cloneIndex(this.functions);
		const currentRegistrationKeys = this.clientRegistrations.get(connection);
		if (currentRegistrationKeys !== undefined) {
			for (const registrationKey of currentRegistrationKeys) {
				const registration = nextRegistrations.get(registrationKey);
				if (registration === undefined
					|| registration.executor.kind !== 'client'
					|| registration.executor.connection !== connection) {
					throw new Error(`Client Tool publication '${connection}' lost registration ownership`);
				}
				removeRegistration(
					nextRegistrations,
					nextRegistrationIds,
					nextTools,
					nextFunctions,
					registrationKey,
				);
			}
		}
		const keys = new Set<string>();
		for (const registration of frozen) {
			if (registration.executor.kind !== 'client' || registration.executor.connection !== connection) {
				throw new Error(`Tool registration '${registration.id}' does not belong to client '${connection}'`);
			}
			keys.add(addRegistration(
				nextRegistrations,
				nextRegistrationIds,
				nextTools,
				nextFunctions,
				registration,
			));
		}
		this.registrations = nextRegistrations;
		this.registrationIds = nextRegistrationIds;
		this.tools = nextTools;
		this.functions = nextFunctions;
		if (keys.size === 0) {
			this.clientRegistrations.delete(connection);
		} else {
			this.clientRegistrations.set(connection, keys);
		}
	}

	removeClient(connection: AgentHostClientConnectionId): void {
		this.replaceClient(connection, Object.freeze([]));
	}

	snapshot(): readonly IAgentToolRegistration[] {
		return Object.freeze([...this.registrations.values()]);
	}
}
