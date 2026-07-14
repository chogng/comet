/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RemoteTunnelErrorCode = {
	InvalidIdentity: 'invalidIdentity',
	InvalidDescriptor: 'invalidDescriptor',
	DuplicateProvider: 'duplicateProvider',
	ProviderMissing: 'providerMissing',
	ProviderCapabilityMissing: 'providerCapabilityMissing',
	AuthenticationDenied: 'authenticationDenied',
	CredentialScopeDenied: 'credentialScopeDenied',
	TunnelMissing: 'tunnelMissing',
	TunnelConflict: 'tunnelConflict',
	ClusterMismatch: 'clusterMismatch',
	EndpointMissing: 'endpointMissing',
	EndpointIncompatible: 'endpointIncompatible',
	EndpointOffline: 'endpointOffline',
	RevisionConflict: 'revisionConflict',
	OperationConflict: 'operationConflict',
	OperationUnknown: 'operationUnknown',
	ResourceLimit: 'resourceLimit',
	HostingConflict: 'hostingConflict',
	HostingInactive: 'hostingInactive',
	RelayUnavailable: 'relayUnavailable',
	FrameTooLarge: 'frameTooLarge',
	ConnectionTerminal: 'connectionTerminal',
	GenerationConflict: 'generationConflict',
	ReconnectPaused: 'reconnectPaused',
	ReconnectGraceExpired: 'reconnectGraceExpired',
	ProtocolViolation: 'protocolViolation',
} as const;

export type RemoteTunnelErrorCode = typeof RemoteTunnelErrorCode[keyof typeof RemoteTunnelErrorCode];
export type RemoteTunnelErrorDataValue = string | number | boolean;
export type RemoteTunnelErrorData = Readonly<Record<string, RemoteTunnelErrorDataValue>>;

/** A bounded typed failure from the Remote Tunnel foundation. */
export class RemoteTunnelError extends Error {
	constructor(
		readonly code: RemoteTunnelErrorCode,
		message: string,
		readonly data: RemoteTunnelErrorData = {},
	) {
		super(message);
		this.name = 'RemoteTunnelError';
	}
}

export function isRemoteTunnelReconnectTerminalError(error: RemoteTunnelError): boolean {
	return error.code === RemoteTunnelErrorCode.AuthenticationDenied
		|| error.code === RemoteTunnelErrorCode.CredentialScopeDenied
		|| error.code === RemoteTunnelErrorCode.TunnelMissing
		|| error.code === RemoteTunnelErrorCode.ClusterMismatch
		|| error.code === RemoteTunnelErrorCode.EndpointMissing
		|| error.code === RemoteTunnelErrorCode.EndpointIncompatible
		|| error.code === RemoteTunnelErrorCode.ConnectionTerminal
		|| error.code === RemoteTunnelErrorCode.ReconnectGraceExpired
		|| error.code === RemoteTunnelErrorCode.ProtocolViolation;
}
