/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { RemoteTunnelAgentHostTransport } from 'cs/platform/agentHost/browser/remoteTunnelAgentHostTransport';
import {
	validateRemoteAgentHostAddress,
	type IRemoteTunnelAgentHostAddress,
} from 'cs/platform/agentHost/common/remoteAgentHostAddress';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	createRemoteAgentHostEndpointCredential,
	validateRemoteAgentHostEndpointAuthenticationTimeout,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostEndpointCredential,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelTransportGeneration,
	findRemoteTunnelEndpoint,
	isEqualRemoteTunnelEndpoint,
	isRemoteTunnelProtocolCompatible,
	validateRemoteTunnelConnectionIdentity,
	validateRemoteTunnelEndpointDescriptor,
	validateRemoteTunnelIdentity,
	validateRemoteTunnelLookupDescriptor,
	validateRemoteTunnelReconnectPolicy,
	type IRemoteTunnelConnection,
	type IRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelReconnectPolicy,
	type IRemoteTunnelService,
	type RemoteTunnelClientConnectionId,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';
import {
	initializeRemoteAgentHostSessionsContribution,
	type IRemoteAgentHostSessionsContributionOptions,
} from './remoteAgentHost.js';

export interface IRemoteTunnelAgentHostSessionsContributionOptions
	extends IRemoteAgentHostSessionsContributionOptions {
	readonly tunnelConnection: RemoteTunnelClientConnectionId;
	readonly tunnelReconnect: IRemoteTunnelReconnectPolicy;
	readonly endpointCredential: RemoteAgentHostEndpointCredential;
	readonly endpointAuthenticationScheduler: IRemoteAgentHostTunnelScheduler;
	readonly endpointAuthenticationTimeoutMilliseconds: number;
}

interface IValidatedRemoteTunnelAgentHostSessionsOptions {
	readonly shared: IRemoteAgentHostSessionsContributionOptions;
	readonly tunnelConnection: RemoteTunnelClientConnectionId;
	readonly tunnelReconnect: IRemoteTunnelReconnectPolicy;
	readonly endpointCredential: RemoteAgentHostEndpointCredential;
	readonly endpointAuthenticationScheduler: IRemoteAgentHostTunnelScheduler;
	readonly endpointAuthenticationTimeoutMilliseconds: number;
}

function validateRemoteTunnelRouteAddress(
	address: IRemoteTunnelAgentHostAddress,
): IRemoteTunnelAgentHostAddress {
	const validatedAddress = validateRemoteAgentHostAddress(address);
	if (validatedAddress.kind !== 'remoteTunnel') {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.EndpointIncompatible,
			'Remote Tunnel Sessions contribution requires a Remote Tunnel address',
		);
	}
	return validatedAddress;
}

function validateContributionOptions(
	options: IRemoteTunnelAgentHostSessionsContributionOptions,
): IValidatedRemoteTunnelAgentHostSessionsOptions {
	if (
		options.endpointAuthenticationScheduler === null
		|| typeof options.endpointAuthenticationScheduler !== 'object'
		|| typeof options.endpointAuthenticationScheduler.wait !== 'function'
	) {
		throw new RemoteAgentHostEndpointAuthenticationError(
			RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
		);
	}
	return Object.freeze({
		shared: Object.freeze({
			implementation: options.implementation,
			maximumClientToolCallRecords: options.maximumClientToolCallRecords,
			maximumBufferedActions: options.maximumBufferedActions,
			contentResourceLimits: options.contentResourceLimits,
		}),
		tunnelConnection: createRemoteTunnelClientConnectionId(options.tunnelConnection),
		tunnelReconnect: validateRemoteTunnelReconnectPolicy(options.tunnelReconnect),
		endpointCredential: createRemoteAgentHostEndpointCredential(options.endpointCredential),
		endpointAuthenticationScheduler: options.endpointAuthenticationScheduler,
		endpointAuthenticationTimeoutMilliseconds: validateRemoteAgentHostEndpointAuthenticationTimeout(
			options.endpointAuthenticationTimeoutMilliseconds,
		),
	});
}

function assertAddressedEndpoint(
	address: IRemoteTunnelAgentHostAddress,
	endpointValue: IRemoteTunnelEndpointDescriptor,
): IRemoteTunnelEndpointDescriptor {
	const endpoint = validateRemoteTunnelEndpointDescriptor(endpointValue);
	const protocol = Object.freeze({
		minimum: createRemoteTunnelProtocolRevision(address.protocolRevision),
		maximum: createRemoteTunnelProtocolRevision(address.protocolRevision),
	});
	if (
		address.endpointKind !== AGENT_HOST_TUNNEL_ENDPOINT_KIND
		|| address.protocolRevision !== remoteAgentHostTunnelProtocolRevision
		|| !isEqualRemoteTunnelEndpoint(endpoint.identity, address.endpoint)
		|| endpoint.kind !== address.endpointKind
		|| !isRemoteTunnelProtocolCompatible(endpoint.protocol, protocol)
		|| endpoint.connectionScope !== 'privateAuthenticated'
	) {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.EndpointIncompatible,
			'Remote Tunnel endpoint does not match the selected Agent Host address',
			{ endpoint: address.endpoint.endpoint },
		);
	}
	if (endpoint.status !== 'online') {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.EndpointOffline,
			'Remote Tunnel Agent Host endpoint is offline',
			{ endpoint: address.endpoint.endpoint },
		);
	}
	return endpoint;
}

function assertLookupRoute(
	address: IRemoteTunnelAgentHostAddress,
	descriptor: Awaited<ReturnType<IRemoteTunnelService['lookup']>>,
): void {
	const validatedDescriptor = validateRemoteTunnelLookupDescriptor(descriptor, address.endpoint);
	assertAddressedEndpoint(address, findRemoteTunnelEndpoint(validatedDescriptor, address.endpoint));
}

function assertConnectedRoute(
	address: IRemoteTunnelAgentHostAddress,
	connection: IRemoteTunnelConnection,
	tunnelConnection: RemoteTunnelClientConnectionId,
): void {
	const identity = validateRemoteTunnelConnectionIdentity(connection.identity);
	const endpoint = assertAddressedEndpoint(address, connection.endpoint);
	if (
		connection.state !== 'connected'
		|| connection.generation !== createRemoteTunnelTransportGeneration(1)
		|| identity.connection !== tunnelConnection
		|| !isEqualRemoteTunnelEndpoint(identity, address.endpoint)
		|| !isEqualRemoteTunnelEndpoint(identity, endpoint.identity)
	) {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.ProtocolViolation,
			'Connected Remote Tunnel does not match the selected Agent Host route',
			{ endpoint: address.endpoint.endpoint },
		);
	}
}

async function closeDedicatedConnection(connection: IRemoteTunnelConnection): Promise<void> {
	try {
		await connection.close();
	} finally {
		connection.dispose();
	}
}

/** Starts one exact Remote Tunnel Agent Host endpoint as the workbench Sessions provider. */
export async function initializeRemoteTunnelAgentHostSessionsContribution(
	address: IRemoteTunnelAgentHostAddress,
	tunnelService: IRemoteTunnelService,
	options: IRemoteTunnelAgentHostSessionsContributionOptions,
): Promise<void> {
	const validatedAddress = validateRemoteTunnelRouteAddress(address);
	const validatedOptions = validateContributionOptions(options);
	const descriptor = await tunnelService.lookup(validateRemoteTunnelIdentity(validatedAddress.endpoint));
	assertLookupRoute(validatedAddress, descriptor);

	const connection = await tunnelService.connect(Object.freeze({
		endpoint: validatedAddress.endpoint,
		kind: validatedAddress.endpointKind,
		protocol: Object.freeze({
			minimum: validatedAddress.protocolRevision,
			maximum: validatedAddress.protocolRevision,
		}),
		connection: validatedOptions.tunnelConnection,
		reconnect: validatedOptions.tunnelReconnect,
	}));
	try {
		assertConnectedRoute(validatedAddress, connection, validatedOptions.tunnelConnection);
	} catch (error) {
		try {
			await closeDedicatedConnection(connection);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Remote Tunnel Agent Host route validation and cleanup both failed',
			);
		}
		throw error;
	}

	const transport = await RemoteTunnelAgentHostTransport.create(
		connection,
		Object.freeze({
			credential: validatedOptions.endpointCredential,
			scheduler: validatedOptions.endpointAuthenticationScheduler,
			authenticationTimeoutMilliseconds: validatedOptions.endpointAuthenticationTimeoutMilliseconds,
		}),
		CancellationTokenNone,
	);
	try {
		await initializeRemoteAgentHostSessionsContribution(transport, validatedOptions.shared);
	} catch (error) {
		transport.dispose();
		throw error;
	}
}
