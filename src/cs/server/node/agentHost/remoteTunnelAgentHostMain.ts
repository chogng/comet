/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { Disposable } from 'cs/base/common/lifecycle';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import {
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
} from 'cs/platform/agentHost/common/identities';
import {
	createRemoteAgentHostEndpointCredential,
	validateRemoteAgentHostEndpointAuthenticationTimeout,
	validateRemoteAgentHostTunnelGracePeriod,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostEndpointCredential,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import {
	AgentHostAuthority,
	type IAgentHostAuthorityOptions,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';
import {
	RemoteTunnelAgentHostHostingBinding,
	type IRemoteTunnelAgentHostConnectionIdentityFactory,
} from 'cs/platform/agentHost/node/remoteTunnelAgentHostBinding';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	assertRemoteTunnelMutationValueDigest,
	computeRemoteTunnelMutationValueDigest,
	createRemoteTunnelOperationId,
	findRemoteTunnelEndpoint,
	isEqualRemoteTunnelEndpoint,
	isEqualRemoteTunnelEndpointDescriptor,
	isEqualRemoteTunnelEndpointPublication,
	validateRemoteTunnelDescriptor,
	validateRemoteTunnelEndpointDescriptor,
	validateRemoteTunnelEndpointPublication,
	validateRemoteTunnelMutationIdentity,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelHostService,
	type IRemoteTunnelStartHostingRequest,
	type IRemoteTunnelStopHostingRequest,
	type RemoteTunnelHostingState,
	type RemoteTunnelOperationId,
	type RemoteTunnelValueDigest,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';
import { RemoteAgentHostEndpointCredentialAuthority } from './remoteAgentHostEndpointCredentialAuthority.js';

const maximumLogicalConnections = 4_096;
const maximumRetainedLogicalConnectionIdentities = 65_536;

export type RemoteTunnelAgentHostContentResources =
	Pick<IAgentContentResourcePort, 'open' | 'release'>
	& IAgentContentResourceClientRouter;

export interface IRemoteTunnelAgentHostMainOptions {
	readonly host: Omit<IAgentHostAuthorityOptions, 'contentResources'>;
	readonly contentResources: RemoteTunnelAgentHostContentResources;
	readonly toolRegistry: AgentToolRegistry;
	readonly toolEndpoints: AgentToolEndpointRegistry;
	readonly hostService: IRemoteTunnelHostService;
	readonly startHosting: IRemoteTunnelStartHostingRequest;
	readonly stopHostingOperation: RemoteTunnelOperationId;
	readonly endpointCredential: RemoteAgentHostEndpointCredential;
	readonly connectionIdentity: IRemoteTunnelAgentHostConnectionIdentityFactory;
	readonly scheduler: IRemoteAgentHostTunnelScheduler;
	readonly authenticationTimeoutMilliseconds: number;
	readonly logicalConnectionGracePeriodMilliseconds: number;
	readonly maximumLogicalConnections: number;
	readonly maximumRetainedLogicalConnectionIdentities: number;
}

interface IRemoteTunnelAgentHostMainConfiguration {
	readonly host: Omit<IAgentHostAuthorityOptions, 'contentResources'>;
	readonly contentResources: RemoteTunnelAgentHostContentResources;
	readonly toolRegistry: AgentToolRegistry;
	readonly toolEndpoints: AgentToolEndpointRegistry;
	readonly hostService: IRemoteTunnelHostService;
	readonly startHosting: IRemoteTunnelStartHostingRequest;
	readonly stopHostingOperation: RemoteTunnelOperationId;
	readonly stopHostingValueDigest: RemoteTunnelValueDigest;
	readonly endpointAuthenticator: RemoteAgentHostEndpointCredentialAuthority;
	readonly connectionIdentity: IRemoteTunnelAgentHostConnectionIdentityFactory;
	readonly scheduler: IRemoteAgentHostTunnelScheduler;
	readonly authenticationTimeoutMilliseconds: number;
	readonly logicalConnectionGracePeriodMilliseconds: number;
	readonly maximumLogicalConnections: number;
	readonly maximumRetainedLogicalConnectionIdentities: number;
}

export type RemoteTunnelAgentHostMainState = 'starting' | 'running' | 'stopping' | 'stopped';

function invalidComposition(message: string): RemoteTunnelError {
	return new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, message);
}

function validateCompositionPorts(options: IRemoteTunnelAgentHostMainOptions): void {
	if (options.hostService === null
		|| (typeof options.hostService !== 'object' && typeof options.hostService !== 'function')
		|| typeof options.hostService.startHosting !== 'function'
		|| options.contentResources === null
		|| (typeof options.contentResources !== 'object' && typeof options.contentResources !== 'function')
		|| typeof options.contentResources.open !== 'function'
		|| typeof options.contentResources.release !== 'function'
		|| typeof options.contentResources.bindClientReader !== 'function'
		|| options.connectionIdentity === null
		|| (typeof options.connectionIdentity !== 'object' && typeof options.connectionIdentity !== 'function')
		|| typeof options.connectionIdentity.create !== 'function'
		|| options.scheduler === null
		|| (typeof options.scheduler !== 'object' && typeof options.scheduler !== 'function')
		|| typeof options.scheduler.wait !== 'function') {
		throw invalidComposition('Remote Tunnel Agent Host product ports are invalid');
	}
	if (!Number.isSafeInteger(options.maximumLogicalConnections)
		|| options.maximumLogicalConnections < 1
		|| options.maximumLogicalConnections > maximumLogicalConnections
		|| !Number.isSafeInteger(options.maximumRetainedLogicalConnectionIdentities)
		|| options.maximumRetainedLogicalConnectionIdentities < options.maximumLogicalConnections
		|| options.maximumRetainedLogicalConnectionIdentities > maximumRetainedLogicalConnectionIdentities) {
		throw invalidComposition('Remote Tunnel Agent Host product capacities are invalid');
	}
}

async function validateComposition(
	options: IRemoteTunnelAgentHostMainOptions,
): Promise<IRemoteTunnelAgentHostMainConfiguration> {
	validateCompositionPorts(options);
	const host = Object.freeze({ ...options.host });
	const endpoint = validateRemoteTunnelEndpointPublication(options.startHosting.endpoint);
	const expectedRevision = remoteAgentHostTunnelProtocolRevision;
	if (endpoint.kind !== AGENT_HOST_TUNNEL_ENDPOINT_KIND
		|| endpoint.connectionScope !== 'privateAuthenticated'
		|| endpoint.protocol.minimum !== expectedRevision
		|| endpoint.protocol.maximum !== expectedRevision) {
		throw invalidComposition('Remote Tunnel Agent Host product endpoint is incompatible');
	}

	const startMutation = validateRemoteTunnelMutationIdentity(options.startHosting.mutation);
	if (startMutation.kind !== 'startHosting'
		|| startMutation.target.kind !== 'endpoint'
		|| !isEqualRemoteTunnelEndpoint(startMutation.target.identity, endpoint.identity)
		|| startMutation.expectedRevision === undefined) {
		throw invalidComposition('Remote Tunnel Agent Host start mutation is invalid');
	}
	await assertRemoteTunnelMutationValueDigest(startMutation, Object.freeze({
		kind: 'startHosting',
		endpoint,
	}));

	const credential = createRemoteAgentHostEndpointCredential(options.endpointCredential);
	const endpointAuthenticator = new RemoteAgentHostEndpointCredentialAuthority(endpoint.identity, credential);
	return Object.freeze({
		host,
		contentResources: options.contentResources,
		toolRegistry: options.toolRegistry,
		toolEndpoints: options.toolEndpoints,
		hostService: options.hostService,
		startHosting: Object.freeze({ endpoint, mutation: startMutation }),
		stopHostingOperation: createRemoteTunnelOperationId(options.stopHostingOperation),
		stopHostingValueDigest: await computeRemoteTunnelMutationValueDigest(Object.freeze({ kind: 'stopHosting' })),
		endpointAuthenticator,
		connectionIdentity: options.connectionIdentity,
		scheduler: options.scheduler,
		authenticationTimeoutMilliseconds: validateRemoteAgentHostEndpointAuthenticationTimeout(
			options.authenticationTimeoutMilliseconds,
		),
		logicalConnectionGracePeriodMilliseconds: validateRemoteAgentHostTunnelGracePeriod(
			options.logicalConnectionGracePeriodMilliseconds,
		),
		maximumLogicalConnections: options.maximumLogicalConnections,
		maximumRetainedLogicalConnectionIdentities: options.maximumRetainedLogicalConnectionIdentities,
	});
}

function shutdownRequest(configuration: IRemoteTunnelAgentHostMainConfiguration) {
	const endpoint = configuration.startHosting.endpoint.identity;
	const value = JSON.stringify(Object.freeze({
		kind: 'remoteTunnelAgentHostShutdown',
		host: configuration.host.authority,
		endpoint: Object.freeze({
			provider: endpoint.provider,
			account: endpoint.account,
			tunnel: endpoint.tunnel,
			cluster: endpoint.cluster,
			endpoint: endpoint.endpoint,
		}),
	}));
	const digest = createHash('sha256').update(value).digest('hex');
	return Object.freeze({
		operation: createAgentHostOperationId(`shutdown:${digest}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digest}`),
	});
}

function throwCleanupErrors(errors: unknown[], message: string): void {
	if (errors.length === 1) {
		throw errors[0];
	}
	if (errors.length > 1) {
		throw new AggregateError(errors, message);
	}
}

function readHostingLeaseState(lease: IRemoteTunnelHostingLease): RemoteTunnelHostingState {
	return lease.state;
}

/** Owns one live Agent Host authority and its exact private Remote Tunnel publication. */
export class RemoteTunnelAgentHostMain extends Disposable {
	private authority: AgentHostAuthority | undefined;
	private lease: IRemoteTunnelHostingLease | undefined;
	private binding: RemoteTunnelAgentHostHostingBinding | undefined;
	private stopHostingRequest: IRemoteTunnelStopHostingRequest | undefined;
	private currentState: RemoteTunnelAgentHostMainState = 'starting';
	private shutdownPromise: Promise<void> | undefined;

	private constructor(private readonly configuration: IRemoteTunnelAgentHostMainConfiguration) {
		super();
	}

	static async create(options: IRemoteTunnelAgentHostMainOptions): Promise<RemoteTunnelAgentHostMain> {
		const configuration = await validateComposition(options);
		const result = new RemoteTunnelAgentHostMain(configuration);
		try {
			await result.initialize();
			return result;
		} catch (error) {
			try {
				await result.shutdown();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Remote Tunnel Agent Host startup and cleanup both failed',
				);
			}
			throw error;
		}
	}

	get state(): RemoteTunnelAgentHostMainState {
		return this.currentState;
	}

	shutdown(): Promise<void> {
		if (this.currentState === 'stopped') {
			this.shutdownPromise ??= Promise.resolve();
			return this.shutdownPromise;
		}
		if (this.shutdownPromise === undefined) {
			const attempt = this.doShutdown();
			this.shutdownPromise = attempt;
			void attempt.catch(() => {
				if (this.currentState === 'running' && this.shutdownPromise === attempt) {
					this.shutdownPromise = undefined;
				}
			});
		}
		return this.shutdownPromise;
	}

	private async initialize(): Promise<void> {
		const authority = await AgentHostAuthority.create(Object.freeze({
			...this.configuration.host,
			contentResources: this.configuration.contentResources,
		}));
		this.authority = authority;
		const lease = await this.configuration.hostService.startHosting(this.configuration.startHosting);
		this.lease = lease;
		const returnedEndpoint = validateRemoteTunnelEndpointDescriptor(lease.endpoint);
		const returnedDescriptor = validateRemoteTunnelDescriptor(lease.descriptor);
		this.stopHostingRequest = Object.freeze({
			mutation: Object.freeze({
				kind: 'stopHosting',
				operation: this.configuration.stopHostingOperation,
				target: Object.freeze({
					kind: 'endpoint',
					identity: returnedEndpoint.identity,
				}),
				expectedRevision: returnedDescriptor.revision,
				valueDigest: this.configuration.stopHostingValueDigest,
			}),
		});
		const descriptorEndpoint = findRemoteTunnelEndpoint(returnedDescriptor, returnedEndpoint.identity);
		if (!isEqualRemoteTunnelEndpointDescriptor(returnedEndpoint, descriptorEndpoint)) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.EndpointIncompatible,
				'Remote Tunnel Host returned inconsistent Agent Host lease state',
				{ endpoint: returnedEndpoint.identity.endpoint },
			);
		}
		if (!isEqualRemoteTunnelEndpointPublication(returnedEndpoint, this.configuration.startHosting.endpoint)) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.EndpointIncompatible,
				'Remote Tunnel Host published another Agent Host endpoint',
				{ endpoint: returnedEndpoint.identity.endpoint },
			);
		}
		const binding = new RemoteTunnelAgentHostHostingBinding(lease, Object.freeze({
			authority,
			identityFactory: this.configuration.connectionIdentity,
			contentResources: this.configuration.contentResources,
			toolRegistry: this.configuration.toolRegistry,
			toolEndpoints: this.configuration.toolEndpoints,
			authenticator: this.configuration.endpointAuthenticator,
			scheduler: this.configuration.scheduler,
			authenticationTimeoutMilliseconds: this.configuration.authenticationTimeoutMilliseconds,
			logicalConnectionGracePeriodMilliseconds: this.configuration.logicalConnectionGracePeriodMilliseconds,
			maximumLogicalConnections: this.configuration.maximumLogicalConnections,
			maximumRetainedLogicalConnectionIdentities: this.configuration.maximumRetainedLogicalConnectionIdentities,
		}));
		this.binding = binding;
		this.currentState = 'running';
	}

	private async doShutdown(): Promise<void> {
		this.currentState = 'stopping';
		const errors: unknown[] = [];
		const lease = this.lease;
		const stopHostingRequest = this.stopHostingRequest;
		if (lease !== undefined && stopHostingRequest !== undefined) {
			const leaseState = readHostingLeaseState(lease);
			if (leaseState !== 'stopped') {
				if (leaseState !== 'active') {
					this.currentState = 'running';
					throw new RemoteTunnelError(
						RemoteTunnelErrorCode.HostingInactive,
						'Remote Tunnel Agent Host lease has no confirmed stopped state',
						{ state: leaseState },
					);
				}
				try {
					await lease.stop(stopHostingRequest);
				} catch (error) {
					if (readHostingLeaseState(lease) !== 'stopped') {
						this.currentState = 'running';
						throw error;
					}
					errors.push(error);
				}
			}
		}
		try {
			this.binding?.dispose();
		} catch (error) {
			errors.push(error);
		}
		this.binding = undefined;
		this.lease = undefined;
		this.stopHostingRequest = undefined;
		try {
			this.configuration.hostService.dispose();
		} catch (error) {
			errors.push(error);
		}
		const authority = this.authority;
		if (authority !== undefined) {
			try {
				await authority.close(shutdownRequest(this.configuration));
			} catch (error) {
				errors.push(error);
				try {
					authority.dispose();
				} catch (disposeError) {
					errors.push(disposeError);
				}
			}
		}
		this.authority = undefined;
		try {
			super.dispose();
		} catch (error) {
			errors.push(error);
		}
		this.currentState = 'stopped';
		throwCleanupErrors(errors, 'Remote Tunnel Agent Host shutdown failed');
	}

	override dispose(): void {
		if (this.currentState === 'stopped') {
			return;
		}
		throw new Error('Remote Tunnel Agent Host requires awaited shutdown');
	}
}
