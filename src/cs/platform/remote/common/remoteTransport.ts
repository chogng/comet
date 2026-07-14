/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { ISerializedRemoteError } from './remoteErrors.js';

export type RemoteTransportCloseKind = 'lost' | 'terminal' | 'graceful';

export interface IRemoteTransportClose {
	readonly kind: RemoteTransportCloseKind;
	readonly error?: ISerializedRemoteError;
}

/** One physical management transport generation carrying bounded string frames. */
export interface IRemoteTransport extends IDisposable {
	readonly onDidReceivePayload: Event<string>;
	readonly onDidClose: Event<IRemoteTransportClose>;
	send(payload: string): void;
	close(reason: IRemoteTransportClose): void;
}

export interface IRemoteReconnectTransport {
	readonly generation: number;
	readonly transport: IRemoteTransport;
}

export interface IRemoteTransportReconnectProvider {
	reconnect(currentGeneration: number): Promise<IRemoteReconnectTransport>;
}
