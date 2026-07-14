/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { RemoteError, RemoteErrorCode } from '../common/remoteErrors.js';
import type { IRemoteTransport, IRemoteTransportClose } from '../common/remoteTransport.js';

/** One explicit in-memory mock of an external Remote socket. */
export class MockRemoteTransport extends Disposable implements IRemoteTransport {
	private readonly payloadEmitter = this._register(new EventEmitter<string>({ onListenerError: onUnexpectedError }));
	private readonly closeEmitter = this._register(new EventEmitter<IRemoteTransportClose>({ onListenerError: onUnexpectedError }));
	private peer: MockRemoteTransport | undefined;
	private closed = false;

	readonly onDidReceivePayload = this.payloadEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	connectPeer(peer: MockRemoteTransport): void {
		if (this.peer || this.closed) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Mock Remote transport is already connected');
		}
		this.peer = peer;
	}

	send(payload: string): void {
		if (this.closed || !this.peer || this.peer.closed) {
			throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Mock Remote transport is closed');
		}
		this.peer.receive(payload);
	}

	close(reason: IRemoteTransportClose): void {
		if (this.closed) {
			return;
		}
		const peer = this.peer;
		this.finish(reason);
		peer?.finish(reason);
	}

	private receive(payload: string): void {
		if (!this.closed) {
			this.payloadEmitter.fire(payload);
		}
	}

	private finish(reason: IRemoteTransportClose): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.closeEmitter.fire(reason);
		super.dispose();
	}

	override dispose(): void {
		this.close({ kind: 'graceful' });
	}
}

export interface IMockRemoteTransportPair {
	readonly client: MockRemoteTransport;
	readonly server: MockRemoteTransport;
}

export function createMockRemoteTransportPair(): IMockRemoteTransportPair {
	const client = new MockRemoteTransport();
	const server = new MockRemoteTransport();
	client.connectPeer(server);
	server.connectPeer(client);
	return { client, server };
}
