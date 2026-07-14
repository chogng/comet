/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { Disposable, DisposableMap, type IDisposable } from 'cs/base/common/lifecycle';
import type {
	IAgent,
	IAgentBackingIdentity,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import type {
	IAgentRuntimeConnection,
	IAgentRuntimeTransportLimits,
} from 'cs/platform/agentHost/common/connections';
import type { IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import {
	AgentId,
	AgentPackageId,
	AgentPackageOperationId,
	AgentRuntimeProtocolVersion,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	AgentPackagePersistedOperation,
	IAgentPackageOffering,
	IAgentPackagePersistedState,
	IAgentPackageRuntimeTransition,
	IAgentPackageRuntimeTransitionSide,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import type { IAgentHostRuntimeResolver } from 'cs/platform/agentHost/node/host/agentHostAuthority';
import {
	connectAgentRuntime,
	type IConnectedAgentRuntime,
	type IConnectedAgentRuntimeOptions,
} from 'cs/platform/agentHost/node/runtime/connectedAgentRuntime';
import type { IAgentPackageRuntimePort } from './agentPackageLifecycle.js';

/** Identifies whether a connected process is launched for restoration or one package operation. */
export type AgentRuntimeConnectionLaunchContext =
	| { readonly kind: 'restore' }
	| { readonly kind: 'activation'; readonly operationId: AgentPackageOperationId };

/** Creates the exact external runtime connection authorized for one installed package revision. */
export interface IAgentRuntimeConnectionFactory {
	create(
		installedPackage: IInstalledAgentPackage,
		context: AgentRuntimeConnectionLaunchContext,
	): Promise<IAgentRuntimeConnection>;
}

/** Binds one product-authorized embedded runtime to exact bundled package offerings. */
export interface IEmbeddedAgentPackageRuntime {
	readonly offerings: readonly IAgentPackageOffering[];
	readonly agents: readonly IAgent[];
	readonly lifetime: IDisposable;
}

/** Supplies the runtime boundaries shared by every package activation in one Host. */
export interface IAgentPackageRuntimeRegistryOptions {
	readonly embeddedRuntimes: readonly IEmbeddedAgentPackageRuntime[];
	readonly connectionFactory: IAgentRuntimeConnectionFactory;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly contentResources: IAgentContentResourcePort;
	readonly credentialResolver: IAgentCredentialResolver;
	readonly protocolVersions: readonly AgentRuntimeProtocolVersion[];
	readonly transportLimits: IAgentRuntimeTransportLimits;
	readonly implementation: IConnectedAgentRuntimeOptions['implementation'];
}

interface IAgentRuntimeEndpoint {
	readonly registration: IAgentRuntimeRegistration;
	readonly agent: IAgent;
}

interface IAgentPackageRuntimeActivation {
	readonly key: string;
	readonly installedPackage: IInstalledAgentPackage;
	readonly registrations: readonly IAgentRuntimeRegistration[];
	readonly endpoints: ReadonlyMap<AgentId, IAgentRuntimeEndpoint>;
	readonly connectedRuntimeKey?: number;
	published: boolean;
}

type AgentPackageRuntimeOperationState = 'prepared' | 'committed' | 'retired' | 'rolledBack';

interface IAgentPackageRuntimeOperation {
	readonly transition: string;
	previous?: IAgentPackageRuntimeActivation;
	next?: IAgentPackageRuntimeActivation;
	state: AgentPackageRuntimeOperationState;
}

interface IResolvedRuntimeEndpoint extends IAgentRuntimeEndpoint {
	readonly activation: IAgentPackageRuntimeActivation;
}

type AgentPackageUnresolvedPersistedOperation =
	| Extract<AgentPackagePersistedOperation, { readonly status: 'pending' }>
	| Extract<AgentPackagePersistedOperation, { readonly status: 'failed' }>;

function offeringKey(offering: IAgentPackageOffering): string {
	return [
		offering.packageId,
		offering.revision,
		offering.contentDigest,
		offering.source,
		offering.distribution,
	].join('\u0000');
}

function installedPackageOffering(installedPackage: IInstalledAgentPackage): IAgentPackageOffering {
	return {
		packageId: installedPackage.packageId,
		revision: installedPackage.revision,
		contentDigest: installedPackage.contentDigest,
		source: installedPackage.source,
		distribution: installedPackage.distribution,
	};
}

function registrationKey(registration: IAgentRuntimeRegistration): string {
	return [registration.packageId, registration.agentId, registration.revision].join('\u0000');
}

function exactRegistration(
	left: IAgentRuntimeRegistration,
	right: IAgentRuntimeRegistration,
): boolean {
	return encodeAgentHostProtocolValue(left) === encodeAgentHostProtocolValue(right);
}

function transitionKey(transition: IAgentPackageRuntimeTransition): string {
	return encodeAgentHostProtocolValue(transition);
}

function sideKey(side: IAgentPackageRuntimeTransitionSide): string {
	return encodeAgentHostProtocolValue(side);
}

function exactSide(
	left: IAgentPackageRuntimeTransitionSide | null,
	right: IAgentPackageRuntimeTransitionSide | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return sideKey(left) === sideKey(right);
}

function unresolvedOperation(
	operation: AgentPackagePersistedOperation,
): operation is AgentPackageUnresolvedPersistedOperation {
	return operation.status === 'pending'
		|| (
			operation.status === 'failed'
			&& operation.failure.reconciliation === 'sameOperationRequired'
		);
}

function operationIdentity(
	kind: string,
	operation: AgentPackageOperationId,
	backing: IAgentBackingIdentity,
): { readonly operation: ReturnType<typeof createAgentHostOperationId>; readonly payloadDigest: ReturnType<typeof createAgentHostPayloadDigest> } {
	const digest = createHash('sha256')
		.update(JSON.stringify({ kind, operation, backing }))
		.digest('hex');
	return Object.freeze({
		operation: createAgentHostOperationId(`package:${digest}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digest}`),
	});
}

/** Owns exact embedded and connected package activations for one Agent Host authority. */
export class AgentPackageRuntimeRegistry extends Disposable implements IAgentPackageRuntimePort, IAgentHostRuntimeResolver {
	private readonly embeddedRuntimes: ReadonlyMap<string, IEmbeddedAgentPackageRuntime>;
	private readonly connectedRuntimes: DisposableMap<number, IConnectedAgentRuntime>;
	private readonly activeByPackage = new Map<AgentPackageId, IAgentPackageRuntimeActivation>();
	private readonly resolvedEndpoints = new Map<string, IResolvedRuntimeEndpoint>();
	private readonly stagedEndpoints = new Map<string, IResolvedRuntimeEndpoint & { readonly operation: AgentPackageOperationId }>();
	private readonly operations = new Map<AgentPackageOperationId, IAgentPackageRuntimeOperation>();
	private restoreState: 'notStarted' | 'restoring' | 'restored' | 'failed' = 'notStarted';
	private nextConnectedRuntimeKey = 0;
	private disposed = false;

	constructor(private readonly options: IAgentPackageRuntimeRegistryOptions) {
		super();
		const embeddedRuntimes = new Map<string, IEmbeddedAgentPackageRuntime>();
		const embeddedLifetimes = new Set<IDisposable>();
		for (const runtime of options.embeddedRuntimes) {
			if (runtime.offerings.length === 0 || runtime.agents.length === 0) {
				throw new AgentPackageError(
					AgentPackageErrorCode.RegistrationInvalid,
					'Invalid embedded Agent package runtime registration',
				);
			}
			for (const offering of runtime.offerings) {
				const key = offeringKey(offering);
				if (offering.distribution !== 'bundled' || embeddedRuntimes.has(key)) {
					throw new AgentPackageError(
						AgentPackageErrorCode.RegistrationInvalid,
						'Invalid embedded Agent package runtime registration',
						{ packageId: offering.packageId },
					);
				}
				embeddedRuntimes.set(key, runtime);
			}
			embeddedLifetimes.add(runtime.lifetime);
		}
		this.embeddedRuntimes = embeddedRuntimes;
		for (const lifetime of embeddedLifetimes) {
			this._register(lifetime);
		}
		this.connectedRuntimes = this._register(new DisposableMap<number, IConnectedAgentRuntime>());
	}

	async restoreRuntimeState(state: IAgentPackagePersistedState): Promise<void> {
		if (this.restoreState !== 'notStarted') {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Agent package runtime state restoration already started',
			);
		}
		this.assertNotDisposed();
		this.restoreState = 'restoring';
		const createdActivations: IAgentPackageRuntimeActivation[] = [];
		const activationsBySide = new Map<string, IAgentPackageRuntimeActivation>();
		const activationForSide = async (
			side: IAgentPackageRuntimeTransitionSide,
			context: AgentRuntimeConnectionLaunchContext,
		): Promise<IAgentPackageRuntimeActivation> => {
			const key = sideKey(side);
			const existing = activationsBySide.get(key);
			if (existing !== undefined) {
				return existing;
			}
			const activation = await this.createActivation(
				side.installedPackage,
				context,
				side.registrations,
			);
			try {
				this.assertNotDisposed();
			} catch (error) {
				this.disposeActivation(activation);
				throw error;
			}
			activationsBySide.set(key, activation);
			createdActivations.push(activation);
			return activation;
		};

		try {
			for (const installedPackage of state.installedPackages) {
				const side = this.stateSide(state, installedPackage.packageId);
				if (side === null) {
					throw this.stateConflict(
						'Installed Agent package has no active runtime registrations',
						installedPackage.packageId,
					);
				}
				const activation = await activationForSide(side, Object.freeze({ kind: 'restore' }));
				this.publishActivation(activation);
				this.activeByPackage.set(installedPackage.packageId, activation);
			}

			for (const operation of state.operations) {
				if (!unresolvedOperation(operation) || operation.phase === 'recorded') {
					continue;
				}
				const transition = operation.runtimeTransition;
				const current = this.stateSide(state, operation.packageId);
				if (operation.phase === 'catalogCommitted') {
					this.assertExactStateSide(current, transition.next, operation.packageId);
					const next = transition.next === null
						? undefined
						: await activationForSide(transition.next, Object.freeze({ kind: 'restore' }));
					this.operations.set(operation.operation, {
						transition: transitionKey(transition),
						next,
						state: 'committed',
					});
					if (next !== undefined) {
						this.stageActivation(operation.operation, next);
					}
					continue;
				}

				this.assertExactStateSide(current, transition.previous, operation.packageId);
				const previous = transition.previous === null
					? undefined
					: await activationForSide(transition.previous, Object.freeze({ kind: 'restore' }));
				const next = transition.next === null
					? undefined
					: await activationForSide(transition.next, Object.freeze({
						kind: 'activation',
						operationId: operation.operation,
					}));
				const restoredOperation: IAgentPackageRuntimeOperation = {
					transition: transitionKey(transition),
					previous,
					next,
					state: operation.phase === 'runtimePrepared' ? 'prepared' : 'committed',
				};
				this.operations.set(operation.operation, restoredOperation);
				if (next !== undefined) {
					this.stageActivation(operation.operation, next);
					if (restoredOperation.state === 'committed') {
						this.replacePublishedActivation(previous, next);
					}
				}
			}
			this.restoreState = 'restored';
		} catch (error) {
			this.restoreState = 'failed';
			this.operations.clear();
			this.stagedEndpoints.clear();
			this.resolvedEndpoints.clear();
			this.activeByPackage.clear();
			for (const activation of createdActivations.reverse()) {
				this.disposeActivation(activation);
			}
			throw error;
		}
	}

	async prepareActivation(
		installedPackage: IInstalledAgentPackage | null,
		previous: IAgentPackageRuntimeTransition['previous'],
		operationId: AgentPackageOperationId,
	): Promise<readonly IAgentRuntimeRegistration[]> {
		this.assertReady();
		const packageId = installedPackage?.packageId ?? previous?.installedPackage.packageId;
		if (packageId === undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Agent package activation has neither a previous nor next runtime',
				{ operationId },
			);
		}
		this.assertExactStateSide(this.activeSide(packageId), previous, packageId);
		const existing = this.operations.get(operationId);
		if (existing !== undefined) {
			if (existing.state !== 'prepared') {
				throw this.operationStateConflict(operationId);
			}
			const expectedNextPackage = existing.next?.installedPackage ?? null;
			if (
				(installedPackage === null) !== (expectedNextPackage === null)
				|| (
					installedPackage !== null
					&& encodeAgentHostProtocolValue(installedPackage)
						!== encodeAgentHostProtocolValue(expectedNextPackage!)
				)
			) {
				throw this.operationStateConflict(operationId);
			}
			return existing.next?.registrations ?? Object.freeze([]);
		}

		let next: IAgentPackageRuntimeActivation | undefined;
		try {
			if (installedPackage !== null) {
				next = await this.createActivation(
					installedPackage,
					Object.freeze({ kind: 'activation', operationId }),
				);
				this.assertNotDisposed();
				this.stageActivation(operationId, next);
			}
			const transition: IAgentPackageRuntimeTransition = Object.freeze({
				previous,
				next: next === undefined ? null : this.activationSide(next),
			});
			this.operations.set(operationId, {
				transition: transitionKey(transition),
				previous: previous === null ? undefined : this.activeByPackage.get(packageId),
				next,
				state: 'prepared',
			});
			return next?.registrations ?? Object.freeze([]);
		} catch (error) {
			if (next !== undefined) {
				this.clearStagedActivation(operationId, next);
				this.disposeActivation(next);
			}
			throw error;
		}
	}

	async commitActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void> {
		this.assertReady();
		const operation = this.requireOperation(operationId, transition);
		if (operation.state === 'committed') {
			return;
		}
		if (operation.state !== 'prepared') {
			throw this.operationStateConflict(operationId);
		}
		if (operation.next !== undefined) {
			this.replacePublishedActivation(operation.previous, operation.next);
		}
		operation.state = 'committed';
	}

	async retirePreviousActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void> {
		this.assertReady();
		const operation = this.requireOperation(operationId, transition);
		if (operation.state === 'retired') {
			return;
		}
		if (operation.state !== 'committed') {
			throw this.operationStateConflict(operationId);
		}

		const packageId = transition.next?.installedPackage.packageId
			?? transition.previous?.installedPackage.packageId;
		if (packageId === undefined) {
			throw this.operationStateConflict(operationId);
		}
		if (operation.previous !== undefined && operation.previous !== operation.next) {
			this.disposeActivation(operation.previous);
		}
		if (operation.next === undefined) {
			this.activeByPackage.delete(packageId);
		} else {
			this.activeByPackage.set(packageId, operation.next);
		}
		if (operation.next !== undefined) {
			this.clearStagedActivation(operationId, operation.next);
		}
		operation.previous = undefined;
		operation.next = undefined;
		operation.state = 'retired';
	}

	async rollbackActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void> {
		this.assertReady();
		const operation = this.requireOperation(operationId, transition);
		if (operation.state === 'rolledBack') {
			return;
		}
		if (operation.state !== 'prepared' && operation.state !== 'committed') {
			throw this.operationStateConflict(operationId);
		}
		if (operation.next !== undefined && operation.next !== operation.previous) {
			this.clearStagedActivation(operationId, operation.next);
			this.disposeActivation(operation.next);
		}
		if (operation.previous !== undefined) {
			this.publishActivation(operation.previous);
		}
		operation.previous = undefined;
		operation.next = undefined;
		operation.state = 'rolledBack';
	}

	async acknowledgeActivationOperation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void> {
		this.assertReady();
		const operation = this.operations.get(operationId);
		if (operation === undefined) {
			return;
		}
		if (operation.transition !== transitionKey(transition)) {
			throw this.operationStateConflict(operationId);
		}
		if (operation.state !== 'retired' && operation.state !== 'rolledBack') {
			throw this.operationStateConflict(operationId);
		}
		this.operations.delete(operationId);
	}

	async migrateResumeState(
		registration: IAgentRuntimeRegistration,
		request: IAgentResumeMigrationRequest,
	): Promise<IAgentResumeState> {
		this.assertReady();
		return this.resolvePreparedActivation(request.operation, registration).resumeStates.migrate(request);
	}

	async deleteBacking(
		registration: IAgentRuntimeRegistration,
		identity: IAgentBackingIdentity,
		operationId: AgentPackageOperationId,
	): Promise<void> {
		const agent = this.resolve(registration);
		const operation = operationIdentity('deleteBacking', operationId, identity);
		if (identity.chatId !== undefined) {
			await agent.chats.delete({
				...operation,
				session: identity.sessionId,
				chat: identity.chatId,
			});
			return;
		}
		await agent.sessions.delete({ ...operation, session: identity.sessionId });
	}

	resolve(registration: IAgentRuntimeRegistration): IAgent {
		this.assertReady();
		return this.resolveActiveEndpoint(registration).agent;
	}

	resolvePreparedActivation(
		operationId: AgentPackageOperationId,
		registration: IAgentRuntimeRegistration,
	): IAgent {
		this.assertReady();
		const endpoint = this.stagedEndpoints.get(registrationKey(registration));
		if (
			endpoint === undefined
			|| endpoint.operation !== operationId
			|| !exactRegistration(endpoint.registration, registration)
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'No prepared runtime matches the exact Agent package operation and registration',
				{ operationId, packageId: registration.packageId, agentId: registration.agentId },
			);
		}
		return endpoint.agent;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.operations.clear();
		this.stagedEndpoints.clear();
		this.resolvedEndpoints.clear();
		this.activeByPackage.clear();
		super.dispose();
	}

	private async createActivation(
		installedPackage: IInstalledAgentPackage,
		context: AgentRuntimeConnectionLaunchContext,
		expectedRegistrations?: readonly IAgentRuntimeRegistration[],
	): Promise<IAgentPackageRuntimeActivation> {
		const activation = installedPackage.manifest.runtimeForm === 'embedded'
			? this.createEmbeddedActivation(installedPackage)
			: await this.createConnectedActivation(installedPackage, context);
		try {
			if (expectedRegistrations !== undefined) {
				this.assertExactRegistrations(
					activation.registrations,
					expectedRegistrations,
					installedPackage.packageId,
				);
			}
			return activation;
		} catch (error) {
			this.disposeActivation(activation);
			throw error;
		}
	}

	private createEmbeddedActivation(
		installedPackage: IInstalledAgentPackage,
	): IAgentPackageRuntimeActivation {
		const runtime = this.embeddedRuntimes.get(offeringKey(installedPackageOffering(installedPackage)));
		if (runtime === undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'No product-authorized embedded runtime matches the Agent package revision',
				{ packageId: installedPackage.packageId },
			);
		}
		return this.activationFromAgents(installedPackage, runtime.agents);
	}

	private async createConnectedActivation(
		installedPackage: IInstalledAgentPackage,
		context: AgentRuntimeConnectionLaunchContext,
	): Promise<IAgentPackageRuntimeActivation> {
		const connection = await this.options.connectionFactory.create(installedPackage, context);
		try {
			this.assertNotDisposed();
		} catch (error) {
			connection.dispose();
			throw error;
		}
		let runtime: IConnectedAgentRuntime;
		try {
			runtime = await connectAgentRuntime({
				connection,
				toolExecution: this.options.toolExecution,
				contentResources: this.options.contentResources,
				credentialResolver: this.options.credentialResolver,
				protocolVersions: this.options.protocolVersions,
				transportLimits: this.options.transportLimits,
				packageId: installedPackage.packageId,
				packageRevision: installedPackage.revision,
				authorizedAgents: installedPackage.manifest.agentIds,
				implementation: this.options.implementation,
			});
		} catch (error) {
			connection.dispose();
			throw error;
		}
		try {
			this.assertNotDisposed();
		} catch (error) {
			runtime.dispose();
			throw error;
		}
		const runtimeKey = ++this.nextConnectedRuntimeKey;
		this.connectedRuntimes.set(runtimeKey, runtime);
		try {
			return this.activationFromAgents(installedPackage, runtime.agents, runtimeKey);
		} catch (error) {
			this.connectedRuntimes.deleteAndDispose(runtimeKey);
			throw error;
		}
	}

	private activationFromAgents(
		installedPackage: IInstalledAgentPackage,
		agents: readonly IAgent[],
		connectedRuntimeKey?: number,
	): IAgentPackageRuntimeActivation {
		const endpointsByAgent = new Map<AgentId, IAgentRuntimeEndpoint>();
		for (const agent of agents) {
			if (
				agent.id !== agent.registration.agentId
				|| agent.registration.packageId !== installedPackage.packageId
				|| !installedPackage.manifest.agentIds.includes(agent.id)
				|| endpointsByAgent.has(agent.id)
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.RegistrationInvalid,
					'Agent runtime registration does not match its exact package activation',
					{ packageId: installedPackage.packageId, agentId: agent.id },
				);
			}
			endpointsByAgent.set(agent.id, { registration: agent.registration, agent });
		}
		if (endpointsByAgent.size !== installedPackage.manifest.agentIds.length) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Agent package runtime returned a partial registration set',
				{ packageId: installedPackage.packageId },
			);
		}
		const endpoints = new Map<AgentId, IAgentRuntimeEndpoint>();
		const registrations: IAgentRuntimeRegistration[] = [];
		for (const agentId of installedPackage.manifest.agentIds) {
			const endpoint = endpointsByAgent.get(agentId)!;
			endpoints.set(agentId, endpoint);
			registrations.push(endpoint.registration);
		}
		const side: IAgentPackageRuntimeTransitionSide = {
			installedPackage,
			registrations,
		};
		return {
			key: sideKey(side),
			installedPackage,
			registrations: Object.freeze(registrations),
			endpoints,
			...(connectedRuntimeKey === undefined ? {} : { connectedRuntimeKey }),
			published: false,
		};
	}

	private publishActivation(activation: IAgentPackageRuntimeActivation): void {
		for (const endpoint of activation.endpoints.values()) {
			const key = registrationKey(endpoint.registration);
			const existing = this.resolvedEndpoints.get(key);
			if (
				existing !== undefined
				&& existing.activation !== activation
				&& (
					existing.agent !== endpoint.agent
					|| !exactRegistration(existing.registration, endpoint.registration)
				)
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.AgentIdConflict,
					'An exact Agent runtime registration already resolves to another endpoint',
					{
						packageId: endpoint.registration.packageId,
						agentId: endpoint.registration.agentId,
					},
				);
			}
		}
		for (const endpoint of activation.endpoints.values()) {
			this.resolvedEndpoints.set(registrationKey(endpoint.registration), {
				...endpoint,
				activation,
			});
		}
		activation.published = true;
	}

	private replacePublishedActivation(
		previous: IAgentPackageRuntimeActivation | undefined,
		next: IAgentPackageRuntimeActivation,
	): void {
		if (previous === next) {
			this.publishActivation(next);
			return;
		}
		if (previous !== undefined) {
			this.unpublishActivation(previous);
		}
		try {
			this.publishActivation(next);
		} catch (error) {
			if (previous !== undefined) {
				try {
					this.publishActivation(previous);
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'Agent runtime publication and rollback both failed',
					);
				}
			}
			throw error;
		}
	}

	private unpublishActivation(activation: IAgentPackageRuntimeActivation): void {
		if (!activation.published) {
			return;
		}
		for (const endpoint of activation.endpoints.values()) {
			const key = registrationKey(endpoint.registration);
			if (this.resolvedEndpoints.get(key)?.activation === activation) {
				this.resolvedEndpoints.delete(key);
			}
		}
		activation.published = false;
	}

	private stageActivation(
		operation: AgentPackageOperationId,
		activation: IAgentPackageRuntimeActivation,
	): void {
		for (const endpoint of activation.endpoints.values()) {
			const key = registrationKey(endpoint.registration);
			const existing = this.stagedEndpoints.get(key);
			if (existing !== undefined && existing.operation !== operation) {
				throw new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'An Agent runtime registration is already staged by another package operation',
					{ packageId: endpoint.registration.packageId, agentId: endpoint.registration.agentId },
				);
			}
		}
		for (const endpoint of activation.endpoints.values()) {
			this.stagedEndpoints.set(registrationKey(endpoint.registration), {
				...endpoint,
				activation,
				operation,
			});
		}
	}

	private clearStagedActivation(
		operation: AgentPackageOperationId,
		activation: IAgentPackageRuntimeActivation,
	): void {
		for (const endpoint of activation.endpoints.values()) {
			const key = registrationKey(endpoint.registration);
			if (this.stagedEndpoints.get(key)?.operation === operation) {
				this.stagedEndpoints.delete(key);
			}
		}
	}

	private disposeActivation(activation: IAgentPackageRuntimeActivation): void {
		this.unpublishActivation(activation);
		if (activation.connectedRuntimeKey !== undefined) {
			this.connectedRuntimes.deleteAndDispose(activation.connectedRuntimeKey);
		}
	}

	private resolveActiveEndpoint(
		registration: IAgentRuntimeRegistration,
	): IAgentRuntimeEndpoint {
		const endpoint = this.resolvedEndpoints.get(registrationKey(registration));
		if (endpoint === undefined || !exactRegistration(endpoint.registration, registration)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'No active runtime matches the exact Agent registration',
				{ packageId: registration.packageId, agentId: registration.agentId },
			);
		}
		return endpoint;
	}

	private activeSide(packageId: AgentPackageId): IAgentPackageRuntimeTransitionSide | null {
		const activation = this.activeByPackage.get(packageId);
		return activation === undefined ? null : this.activationSide(activation);
	}

	private activationSide(
		activation: IAgentPackageRuntimeActivation,
	): IAgentPackageRuntimeTransitionSide {
		return Object.freeze({
			installedPackage: activation.installedPackage,
			registrations: activation.registrations,
		});
	}

	private stateSide(
		state: IAgentPackagePersistedState,
		packageId: AgentPackageId,
	): IAgentPackageRuntimeTransitionSide | null {
		const installedPackage = state.installedPackages.find(candidate => candidate.packageId === packageId);
		if (installedPackage === undefined) {
			return null;
		}
		return Object.freeze({
			installedPackage,
			registrations: Object.freeze(state.activeRegistrations.filter(
				registration => registration.packageId === packageId,
			)),
		});
	}

	private assertExactStateSide(
		actual: IAgentPackageRuntimeTransitionSide | null,
		expected: IAgentPackageRuntimeTransitionSide | null,
		packageId: AgentPackageId,
	): void {
		if (!exactSide(actual, expected)) {
			throw this.stateConflict(
				'Agent package runtime transition does not match authoritative persisted state',
				packageId,
			);
		}
	}

	private assertExactRegistrations(
		actual: readonly IAgentRuntimeRegistration[],
		expected: readonly IAgentRuntimeRegistration[],
		packageId: AgentPackageId,
	): void {
		const actualByAgent = new Map(actual.map(registration => [registration.agentId, registration]));
		if (
			actualByAgent.size !== expected.length
			|| expected.some(registration => {
				const candidate = actualByAgent.get(registration.agentId);
				return candidate === undefined || !exactRegistration(candidate, registration);
			})
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Restored Agent runtime does not match the exact persisted registrations',
				{ packageId },
			);
		}
	}

	private requireOperation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): IAgentPackageRuntimeOperation {
		const operation = this.operations.get(operationId);
		if (operation === undefined || operation.transition !== transitionKey(transition)) {
			throw this.operationStateConflict(operationId);
		}
		return operation;
	}

	private operationStateConflict(operationId: AgentPackageOperationId): AgentPackageError {
		return new AgentPackageError(
			AgentPackageErrorCode.StateConflict,
			'Agent package runtime operation has no matching lifecycle state',
			{ operationId },
		);
	}

	private stateConflict(message: string, packageId: AgentPackageId): AgentPackageError {
		return new AgentPackageError(
			AgentPackageErrorCode.StateConflict,
			message,
			{ packageId },
		);
	}

	private assertReady(): void {
		this.assertNotDisposed();
		if (this.restoreState !== 'restored') {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Agent package runtime state has not been restored',
			);
		}
	}

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Agent package runtime registry is disposed',
			);
		}
	}
}
