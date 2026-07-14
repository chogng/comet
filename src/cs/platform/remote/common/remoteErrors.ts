/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RemoteErrorCode = {
	InvalidAuthority: 'invalidAuthority',
	DuplicateResolver: 'duplicateResolver',
	ResolverMissing: 'resolverMissing',
	ResolutionMismatch: 'resolutionMismatch',
	EndpointIncompatible: 'endpointIncompatible',
	AuthenticationDenied: 'authenticationDenied',
	ProtocolIncompatible: 'protocolIncompatible',
	InvalidEnvironment: 'invalidEnvironment',
	FrameTooLarge: 'frameTooLarge',
	MalformedFrame: 'malformedFrame',
	ProtocolViolation: 'protocolViolation',
	DuplicateChannel: 'duplicateChannel',
	ChannelMissing: 'channelMissing',
	CommandMissing: 'commandMissing',
	EventMissing: 'eventMissing',
	DuplicateOperation: 'duplicateOperation',
	OperationMissing: 'operationMissing',
	OperationCancelled: 'operationCancelled',
	TransportUnavailable: 'transportUnavailable',
	ConnectionTerminal: 'connectionTerminal',
	GenerationConflict: 'generationConflict',
	DuplicateClient: 'duplicateClient',
	ConnectionMismatch: 'connectionMismatch',
} as const;

export type RemoteErrorCode = typeof RemoteErrorCode[keyof typeof RemoteErrorCode];

export type RemoteErrorDataValue = string | number | boolean;
export type RemoteErrorData = Readonly<Record<string, RemoteErrorDataValue>>;

/** A bounded, typed failure crossing the Remote management boundary. */
export class RemoteError extends Error {
	constructor(
		readonly code: RemoteErrorCode,
		message: string,
		readonly data: RemoteErrorData = {},
	) {
		super(message);
		this.name = 'RemoteError';
	}
}

export interface ISerializedRemoteError {
	readonly code: RemoteErrorCode;
	readonly data: RemoteErrorData;
}

export function serializeRemoteError(error: RemoteError): ISerializedRemoteError {
	return {
		code: error.code,
		data: error.data,
	};
}

export function deserializeRemoteError(error: ISerializedRemoteError): RemoteError {
	return new RemoteError(error.code, `Remote operation failed: ${error.code}`, error.data);
}
