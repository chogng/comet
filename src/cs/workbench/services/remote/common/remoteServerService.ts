/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
	IRemoteAuthority,
	RemoteClientId,
	RemoteProtocolVersion,
} from 'cs/platform/remote/common/remoteAuthority';
import type { IRemoteServerConnection } from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';

export const IRemoteServerService = createDecorator<IRemoteServerService>('remoteServerService');

export interface IRemoteServerSelection {
	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly protocolVersions: readonly RemoteProtocolVersion[];
	readonly productCommit: string;
	readonly locale: string;
	readonly profile: string;
}

export interface IRemoteServerService {
	readonly _serviceBrand: undefined;
	readonly selection: IRemoteServerSelection;
	readonly connection: IRemoteServerConnection | undefined;
	readonly environment: IRemoteEnvironment | undefined;
	connect(): Promise<IRemoteServerConnection>;
	disconnect(): Promise<void>;
}
