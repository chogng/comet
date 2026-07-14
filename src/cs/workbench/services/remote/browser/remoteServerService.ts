/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IRemoteAuthorityResolverService } from 'cs/platform/remote/common/remoteAuthority';
import {
	validateRemoteConnection,
	type IRemoteServerConnection,
	type IRemoteServerConnectionFactory,
} from 'cs/platform/remote/common/remoteConnection';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import type {
	IRemoteServerSelection,
	IRemoteServerService,
} from '../common/remoteServerService.js';

export interface IRemoteServerServiceOptions {
	readonly selection: IRemoteServerSelection;
	readonly resolver: IRemoteAuthorityResolverService;
	readonly connectionFactory: IRemoteServerConnectionFactory;
}

/** Owns the one shared Remote management connection for the selected authority. */
export class RemoteServerService extends Disposable implements IRemoteServerService {
	declare readonly _serviceBrand: undefined;

	readonly selection: IRemoteServerSelection;
	private connectionPromise: Promise<IRemoteServerConnection> | undefined;
	private currentConnection: IRemoteServerConnection | undefined;
	private lastReconnectGeneration: number | undefined;
	private disposed = false;

	constructor(private readonly options: IRemoteServerServiceOptions) {
		super();
		this.selection = Object.freeze({
			...options.selection,
			authority: Object.freeze({ ...options.selection.authority }),
			protocolVersions: Object.freeze([...options.selection.protocolVersions]),
		});
	}

	get connection(): IRemoteServerConnection | undefined {
		return this.currentConnection;
	}

	get environment() {
		return this.currentConnection?.environment;
	}

	connect(): Promise<IRemoteServerConnection> {
		if (this.disposed) {
			return Promise.reject(new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote Server service is disposed'));
		}
		if (!this.connectionPromise) {
			this.connectionPromise = this.createConnection();
		}
		return this.connectionPromise;
	}

	async disconnect(): Promise<void> {
		if (!this.connectionPromise) {
			return;
		}
		const connection = await this.connectionPromise;
		await connection.end();
	}

	private async createConnection(): Promise<IRemoteServerConnection> {
		const endpoint = await this.options.resolver.resolve(this.selection.authority);
		const connection = await this.options.connectionFactory.connect(endpoint, {
			authority: this.selection.authority,
			client: this.selection.client,
			protocolVersions: this.selection.protocolVersions,
			productCommit: this.selection.productCommit,
			locale: this.selection.locale,
			profile: this.selection.profile,
		});
		try {
			validateRemoteConnection(connection, endpoint, {
				authority: this.selection.authority,
				client: this.selection.client,
				protocolVersions: this.selection.protocolVersions,
				productCommit: this.selection.productCommit,
				locale: this.selection.locale,
				profile: this.selection.profile,
			});
			if (this.disposed) {
				throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote Server service ended during connect');
			}
			this.currentConnection = this._register(connection);
			this._register(connection.onDidChangeState(change => {
				if (
					change.state !== 'reconnecting'
					|| this.lastReconnectGeneration === change.generation
				) {
					return;
				}
				this.lastReconnectGeneration = change.generation;
				void this.reconnect(connection).catch(onUnexpectedError);
			}));
			return connection;
		} catch (error) {
			connection.dispose();
			throw error;
		}
	}

	private async reconnect(connection: IRemoteServerConnection): Promise<void> {
		try {
			await connection.reconnect();
		} catch {
			await connection.end();
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.currentConnection = undefined;
		super.dispose();
	}
}
