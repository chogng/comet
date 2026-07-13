/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AgentHostErrorCode = {
	InvalidIdentity: 'invalidIdentity',
	InvalidProtocolValue: 'invalidProtocolValue',
	UnsupportedProtocolVersion: 'unsupportedProtocolVersion',
	ChannelSnapshotRequired: 'channelSnapshotRequired',
	ChannelRevisionGap: 'channelRevisionGap',
	ChannelRevisionConflict: 'channelRevisionConflict',
	OperationDigestConflict: 'operationDigestConflict',
	OperationNotFound: 'operationNotFound',
	OperationNotPending: 'operationNotPending',
	ResourceMissing: 'resourceMissing',
	CapabilityUnsupported: 'capabilityUnsupported',
} as const;

export type AgentHostErrorCode = typeof AgentHostErrorCode[keyof typeof AgentHostErrorCode];

export interface IAgentHostErrorDataByCode {
	readonly invalidIdentity: {
		readonly identity: string;
		readonly value: string;
	};
	readonly invalidProtocolValue: {
		readonly field: string;
		readonly value: string | number;
	};
	readonly unsupportedProtocolVersion: {
		readonly offered: readonly string[];
		readonly supported: readonly string[];
	};
	readonly channelSnapshotRequired: {
		readonly channel: string;
	};
	readonly channelRevisionGap: {
		readonly channel: string;
		readonly expectedRevision: number;
		readonly receivedRevision: number;
	};
	readonly channelRevisionConflict: {
		readonly channel: string;
		readonly revision: number;
	};
	readonly operationDigestConflict: {
		readonly operation: string;
		readonly recordedDigest: string;
		readonly receivedDigest: string;
	};
	readonly operationNotFound: {
		readonly operation: string;
	};
	readonly operationNotPending: {
		readonly operation: string;
	};
	readonly resourceMissing: {
		readonly resource: string;
	};
	readonly capabilityUnsupported: {
		readonly capability: string;
	};
}

export class AgentHostError<TCode extends AgentHostErrorCode = AgentHostErrorCode> extends Error {
	constructor(
		readonly code: TCode,
		message: string,
		readonly data: IAgentHostErrorDataByCode[TCode],
	) {
		super(message);
		this.name = 'AgentHostError';
	}
}
