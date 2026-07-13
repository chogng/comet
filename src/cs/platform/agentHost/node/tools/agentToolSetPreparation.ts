/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import type {
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentModelDescriptor,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	AgentHostAuthorityId,
	AgentSubmissionId,
	AgentToolSetRevision,
	createAgentHostAuthorityId,
	createAgentToolSetRevision,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostToolPolicy } from 'cs/platform/agentHost/common/protocol';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentToolExecutorReference,
	IAgentToolRegistration,
	IAgentToolSet,
	agentToolRegistrationAcceptsTarget,
} from 'cs/platform/agentHost/common/tools';
import { AgentToolRegistry, agentToolExecutorKey } from './agentToolRegistry.js';

export interface IAgentToolAvailabilityPort {
	isAvailable(reference: AgentToolExecutorReference): boolean;
}

export interface IAgentToolSetPreparationRequest {
	readonly submission: AgentSubmissionId;
	readonly agent: IAgentDescriptor;
	readonly runtimeRegistration: IAgentRuntimeRegistration;
	readonly model: IAgentModelDescriptor;
	readonly profile: IAgentExecutionProfile;
	readonly targets: readonly IAgentHostInteractionTarget[];
	readonly policy: AgentHostToolPolicy;
}

export interface IAgentToolSetPreparationPort {
	prepare(request: IAgentToolSetPreparationRequest): Promise<IAgentToolSet>;
}

export interface IPreparedAgentToolSet {
	readonly authority: AgentHostAuthorityId;
	readonly submission: AgentSubmissionId;
	readonly agent: IAgentDescriptor;
	readonly runtimeRegistration: IAgentRuntimeRegistration;
	readonly model: IAgentModelDescriptor;
	readonly profile: IAgentExecutionProfile;
	readonly targets: readonly IAgentHostInteractionTarget[];
	readonly policy: AgentHostToolPolicy;
	readonly toolSet: IAgentToolSet;
}

export interface IAgentToolSetResolver {
	resolve(revision: AgentToolSetRevision): IPreparedAgentToolSet | undefined;
}

function resolveRegistrationForTargets(
	tool: string,
	candidates: readonly IAgentToolRegistration[],
	targets: readonly IAgentHostInteractionTarget[],
): IAgentToolRegistration | undefined {
	const matches = candidates.filter(registration => (
		registration.descriptor.targetTypes.length === 0
		|| targets.some(target => agentToolRegistrationAcceptsTarget(registration, target))
	));
	if (matches.length > 1) {
		throw new Error(`Tool '${tool}' resolves to multiple exact target executors`);
	}
	return matches[0];
}

function immutableTarget(target: IAgentHostInteractionTarget): IAgentHostInteractionTarget {
	return Object.freeze({
		...target,
		authority: Object.freeze({ ...target.authority }),
		display: Object.freeze({ ...target.display }),
	});
}

/** Resolves one immutable, exact Tool-set revision without name or endpoint fallback. */
export class AgentToolSetPreparationService implements IAgentToolSetPreparationPort, IAgentToolSetResolver {
	private readonly prepared = new Map<AgentToolSetRevision, IPreparedAgentToolSet>();

	constructor(
		private readonly authority: AgentHostAuthorityId,
		private readonly registry: AgentToolRegistry,
		private readonly availability: IAgentToolAvailabilityPort,
		private readonly maximumPreparedToolSets: number,
	) {
		createAgentHostAuthorityId(authority);
		if (!Number.isSafeInteger(maximumPreparedToolSets) || maximumPreparedToolSets < 1) {
			throw new Error('Tool-set preparation capacity must be a positive integer');
		}
	}

	async prepare(request: IAgentToolSetPreparationRequest): Promise<IAgentToolSet> {
		this.validateBinding(request);
		if (new Set(request.runtimeRegistration.supportedToolSchemaProfiles).size !== request.runtimeRegistration.supportedToolSchemaProfiles.length
			|| new Set(request.model.toolSchemaProfiles).size !== request.model.toolSchemaProfiles.length) {
			throw new Error('Tool schema profile declarations contain duplicates');
		}
		const schemaProfiles = request.runtimeRegistration.supportedToolSchemaProfiles.filter(profile => request.model.toolSchemaProfiles.includes(profile));
		if (schemaProfiles.length !== 1) {
			throw new Error('Tool schema profile intersection must contain exactly one profile');
		}
		const schemaProfile = schemaProfiles[0];
		const registrations = this.selectRegistrations(request, schemaProfile);
		const frozenTargets = Object.freeze(request.targets.map(immutableTarget));
		const frozenPolicy: AgentHostToolPolicy = request.policy.kind === 'selected'
			? Object.freeze({ kind: 'selected', tools: Object.freeze([...request.policy.tools]) })
			: Object.freeze({ kind: 'all' });
		const revisionValue = {
			authority: this.authority,
			submission: request.submission,
			agent: request.agent.id,
			agentDescriptor: request.agent.revision,
			runtimeRegistration: request.runtimeRegistration.revision,
			model: request.model.id,
			modelDescriptor: request.model.revision,
			executionProfile: request.profile.revision,
			schemaProfile,
			targets: frozenTargets,
			policy: frozenPolicy,
			registrations,
		};
		const digest = createHash('sha256').update(encodeAgentHostProtocolValue(revisionValue)).digest('hex');
		const revision = createAgentToolSetRevision(`sha256:${digest}`);
		const toolSet: IAgentToolSet = Object.freeze({
			revision,
			schemaProfile,
			runtimeRegistration: request.runtimeRegistration.revision,
			agentDescriptor: request.agent.revision,
			modelDescriptor: request.model.revision,
			registrations,
		});
		const record: IPreparedAgentToolSet = Object.freeze({
			authority: this.authority,
			submission: request.submission,
			agent: request.agent,
			runtimeRegistration: request.runtimeRegistration,
			model: request.model,
			profile: request.profile,
			targets: frozenTargets,
			policy: frozenPolicy,
			toolSet,
		});
		const existing = this.prepared.get(revision);
		if (existing !== undefined) {
			if (encodeAgentHostProtocolValue(existing.toolSet) !== encodeAgentHostProtocolValue(toolSet)
				|| existing.submission !== request.submission) {
				throw new Error(`Tool-set revision collision '${revision}'`);
			}
			return existing.toolSet;
		}
		if (this.prepared.size >= this.maximumPreparedToolSets) {
			throw new Error('Tool-set preparation capacity is exhausted');
		}
		this.prepared.set(revision, record);
		return toolSet;
	}

	resolve(revision: AgentToolSetRevision): IPreparedAgentToolSet | undefined {
		return this.prepared.get(revision);
	}

	release(revision: AgentToolSetRevision): void {
		this.prepared.delete(revision);
	}

	private validateBinding(request: IAgentToolSetPreparationRequest): void {
		if (
			request.runtimeRegistration.agentId !== request.agent.id
			|| request.runtimeRegistration.packageId !== request.agent.packageId
			|| request.runtimeRegistration.descriptorRevision !== request.agent.revision
			|| request.runtimeRegistration.capabilityRevision !== request.agent.capabilities.revision
			|| request.profile.agentDescriptor !== request.agent.revision
			|| request.profile.modelDescriptor !== request.model.revision
			|| !request.agent.models.some(model => model.id === request.model.id && model.revision === request.model.revision)
		) {
			throw new Error('Tool-set preparation binding is not exact');
		}
		const targetIds = new Set(request.targets.map(target => target.id));
		if (targetIds.size !== request.targets.length) {
			throw new Error('Tool-set preparation contains duplicate targets');
		}
		for (const target of request.targets) {
			assertAgentHostInteractionTarget(target);
		}
	}

	private selectRegistrations(
		request: IAgentToolSetPreparationRequest,
		schemaProfile: IAgentToolSet['schemaProfile'],
	): readonly IAgentToolRegistration[] {
		const catalog = this.registry.snapshot();
		const candidatesByTool = new Map<string, IAgentToolRegistration[]>();
		for (const registration of catalog) {
			const candidates = candidatesByTool.get(registration.descriptor.id);
			if (candidates === undefined) {
				candidatesByTool.set(registration.descriptor.id, [registration]);
			} else {
				candidates.push(registration);
			}
		}
		let selected: readonly IAgentToolRegistration[];
		if (request.policy.kind === 'selected') {
			const requested = new Set(request.policy.tools);
			if (requested.size !== request.policy.tools.length) {
				throw new Error('Selected Tool policy contains duplicate identities');
			}
			selected = request.policy.tools.map(tool => {
				const candidates = candidatesByTool.get(tool);
				if (candidates === undefined) {
					throw new Error(`Selected Tool '${tool}' is not registered`);
				}
				const registration = resolveRegistrationForTargets(
					tool,
					candidates,
					request.targets,
				);
				if (registration === undefined) {
					throw new Error(`Selected Tool '${tool}' has no exact compatible target`);
				}
				return registration;
			});
		} else if (request.policy.kind === 'all') {
			selected = [...candidatesByTool].flatMap(([tool, candidates]) => {
				const registration = resolveRegistrationForTargets(tool, candidates, request.targets);
				return registration === undefined ? [] : [registration];
			});
		} else {
			throw new Error('Unknown Tool policy kind');
		}
		for (const registration of selected) {
			if (registration.descriptor.inputSchema.profile !== schemaProfile
				|| registration.descriptor.outputSchema.profile !== schemaProfile) {
				throw new Error(`Tool '${registration.descriptor.id}' does not preserve the exact schema profile`);
			}
			if (!this.availability.isAvailable(registration.executor)) {
				throw new Error(`Tool executor '${agentToolExecutorKey(registration.executor)}' is unavailable`);
			}
		}
		return Object.freeze([...selected]);
	}
}
