/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageChannelMain, type UtilityProcess as ElectronUtilityProcess } from 'electron';

import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import {
	mockAgentRuntimeConnectMessage,
	mockAgentRuntimeProcessPrivilege,
	mockAgentRuntimeReadyMessage,
} from 'cs/code/common/agentHost/mockAgentPackages';
import {
	agentRuntimeConnectionChannelName,
	AgentRuntimeConnectionChannelClient,
} from 'cs/platform/agentHost/common/agentRuntimeConnectionChannel';
import type { IAgentRuntimeConnection } from 'cs/platform/agentHost/common/connections';
import { ManagedAgentRuntimeConnection } from 'cs/platform/agentHost/common/managedAgentRuntimeConnection';
import {
	type AgentRuntimeConnectionGeneration,
	type AgentRuntimeConnectionId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
} from 'cs/platform/agentHost/common/identities';
import type { IInstalledAgentPackage } from 'cs/platform/agentHost/common/packages';
import {
	createAgentRuntimeSandboxAuthority,
	isEqualAgentRuntimeSandboxAuthority,
} from 'cs/platform/agentHost/common/runtimeSandbox';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	AgentRuntimeConnectionLaunchContext,
	IAgentRuntimeConnectionFactory,
} from 'cs/platform/agentHost/node/packages/agentPackageRuntimeRegistry';
import type { IAgentRuntimeSandboxProcessPort } from 'cs/platform/agentHost/electron-main/agentRuntimeSandboxProcess';

/** Launches every installed mock package in its own Electron utility process. */
export class MockAgentRuntimeProcessFactory implements IAgentRuntimeConnectionFactory {
	private nextConnection = 1;

	constructor(
		private readonly sandboxProcessPort: IAgentRuntimeSandboxProcessPort,
	) {}

	async create(
		installedPackage: IInstalledAgentPackage,
		_context: AgentRuntimeConnectionLaunchContext,
	): Promise<IAgentRuntimeConnection> {
		const processPrivileges = installedPackage.grantedPrivileges.filter(privilege => privilege.kind === 'process');
		if (
			processPrivileges.length !== 1
			|| processPrivileges[0].value !== mockAgentRuntimeProcessPrivilege
		) {
			throw new Error(`Mock Agent package "${installedPackage.packageId}" has no exact utility-process grant.`);
		}
		const connection = createAgentRuntimeConnectionId(
			`mock-process:${installedPackage.packageId}:${this.nextConnection++}`,
		);
		return ManagedAgentRuntimeConnection.create({
			connection,
			createGeneration: (logicalConnection, generation) => this.createGeneration(
				installedPackage,
				logicalConnection,
				generation,
			),
		});
	}

	private async createGeneration(
		installedPackage: IInstalledAgentPackage,
		connection: AgentRuntimeConnectionId,
		generation: AgentRuntimeConnectionGeneration,
	): Promise<IAgentRuntimeConnection> {
		createAgentRuntimeConnectionGeneration(generation);
		const lifetime = new DisposableStore();
		let channel: MessagePortChannel | undefined;
		let client: AgentRuntimeConnectionChannelClient | undefined;
		let exitError: Error | undefined;
		try {
			const expectedAuthority = createAgentRuntimeSandboxAuthority(
				installedPackage,
				mockAgentRuntimeProcessPrivilege,
			);
			const processOwner = lifetime.add(await this.sandboxProcessPort.launch({
				installedPackage,
				authority: expectedAuthority,
				connection,
				generation,
			}));
			if (
				processOwner.connection !== connection
				|| processOwner.generation !== generation
				|| encodeAgentHostProtocolValue(processOwner.installedPackage)
					!== encodeAgentHostProtocolValue(installedPackage)
				|| !isEqualAgentRuntimeSandboxAuthority(processOwner.authority, expectedAuthority)
			) {
				throw new Error(`Mock Agent package "${installedPackage.packageId}" sandbox process identity changed.`);
			}
			const child = processOwner.child;
			await this.waitUntilReady(child, lifetime, error => {
				exitError = error;
				channel?.disconnect(error);
				client?.disconnect('processExited');
			});
			if (exitError !== undefined) {
				throw exitError;
			}

			const messageChannel = new MessageChannelMain();
			channel = lifetime.add(new MessagePortChannel(messageChannel.port1, 'mock-agent-runtime-host'));
			client = new AgentRuntimeConnectionChannelClient(
				channel.getChannel(agentRuntimeConnectionChannelName),
				connection,
				generation,
				lifetime,
			);
			if (exitError !== undefined) {
				client.disconnect('processExited');
				throw exitError;
			}
			processOwner.postMessage({
				type: mockAgentRuntimeConnectMessage,
				packageId: installedPackage.packageId,
				packageRevision: installedPackage.revision,
				connection,
				generation,
			}, [messageChannel.port2]);
			return client;
		} catch (error) {
			client?.dispose();
			lifetime.dispose();
			throw error;
		}
	}

	private waitUntilReady(
		child: ElectronUtilityProcess,
		lifetime: DisposableStore,
		onExitAfterReady: (error: Error) => void,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let ready = false;
			const onMessage = (message: unknown): void => {
				if (
					message === null
					|| typeof message !== 'object'
					|| Array.isArray(message)
					|| Object.keys(message).length !== 1
					|| (message as { readonly type?: unknown }).type !== mockAgentRuntimeReadyMessage
				) {
					reject(new Error('Mock Agent Runtime emitted an invalid readiness message.'));
					return;
				}
				ready = true;
				child.off('message', onMessage);
				resolve();
			};
			const onExit = (code: number): void => {
				child.off('message', onMessage);
				const error = new Error(`Mock Agent Runtime exited with code ${code}.`);
				if (ready) {
					onExitAfterReady(error);
				} else {
					reject(error);
				}
			};
			child.on('message', onMessage);
			child.once('exit', onExit);
			lifetime.add(toDisposable(() => {
				child.off('message', onMessage);
				child.off('exit', onExit);
			}));
		});
	}
}
