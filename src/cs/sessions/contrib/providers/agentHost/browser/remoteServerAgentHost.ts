/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RemoteServerAgentHostTransport } from 'cs/platform/agentHost/browser/remoteServerAgentHostTransport';
import {
	validateRemoteAgentHostAddress,
	type IRemoteServerAgentHostAddress,
} from 'cs/platform/agentHost/common/remoteAgentHostAddress';
import { remoteServerAgentHostCapability } from 'cs/platform/agentHost/common/remoteProtocol';
import { isEqualRemoteAuthority } from 'cs/platform/remote/common/remoteAuthority';
import type { IRemoteServerConnection } from 'cs/platform/remote/common/remoteConnection';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import type { IRemoteServerService } from 'cs/workbench/services/remote/common/remoteServerService';
import {
	initializeRemoteAgentHostSessionsContribution,
	type IRemoteAgentHostSessionsContributionOptions,
} from './remoteAgentHost.js';

function assertSelectedRemoteServerRoute(
	address: IRemoteServerAgentHostAddress,
	remoteServerService: IRemoteServerService,
): void {
	if (
		address.kind !== 'remoteServer'
		|| address.capability !== remoteServerAgentHostCapability
	) {
		throw new RemoteError(
			RemoteErrorCode.ChannelMissing,
			'Remote Server address does not select the Agent Host capability',
		);
	}
	if (!isEqualRemoteAuthority(remoteServerService.selection.authority, address.authority)) {
		throw new RemoteError(
			RemoteErrorCode.ConnectionMismatch,
			'Remote Server selection does not match the Agent Host address',
		);
	}
}

function validateRemoteServerRouteAddress(
	address: IRemoteServerAgentHostAddress,
): IRemoteServerAgentHostAddress {
	const validatedAddress = validateRemoteAgentHostAddress(address);
	if (validatedAddress.kind !== 'remoteServer') {
		throw new RemoteError(
			RemoteErrorCode.ConnectionMismatch,
			'Remote Server Sessions contribution requires a Remote Server address',
		);
	}
	return validatedAddress;
}

function assertConnectedRemoteServerRoute(
	address: IRemoteServerAgentHostAddress,
	remoteServerService: IRemoteServerService,
	connection: IRemoteServerConnection,
): void {
	assertSelectedRemoteServerRoute(address, remoteServerService);
	if (
		remoteServerService.connection !== connection
		|| remoteServerService.environment !== connection.environment
		|| connection.state !== 'connected'
		|| !isEqualRemoteAuthority(connection.authority, address.authority)
		|| connection.client !== remoteServerService.selection.client
	) {
		throw new RemoteError(
			RemoteErrorCode.ConnectionMismatch,
			'Connected Remote Server does not match the selected Agent Host route',
		);
	}
	if (!connection.environment.capabilities.includes(remoteServerAgentHostCapability)) {
		throw new RemoteError(
			RemoteErrorCode.ChannelMissing,
			'Connected Remote Server does not advertise the Agent Host capability',
		);
	}
}

/** Starts the explicitly selected Remote Server Agent Host route as the workbench Sessions provider. */
export async function initializeRemoteServerAgentHostSessionsContribution(
	address: IRemoteServerAgentHostAddress,
	remoteServerService: IRemoteServerService,
	options: IRemoteAgentHostSessionsContributionOptions,
): Promise<void> {
	const validatedAddress = validateRemoteServerRouteAddress(address);
	assertSelectedRemoteServerRoute(validatedAddress, remoteServerService);
	const connection = await remoteServerService.connect();
	assertConnectedRemoteServerRoute(validatedAddress, remoteServerService, connection);

	const transport = new RemoteServerAgentHostTransport(connection);
	try {
		await initializeRemoteAgentHostSessionsContribution(transport, options);
	} catch (error) {
		transport.dispose();
		throw error;
	}
}
