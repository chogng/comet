/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from 'node:path';

import type {
	MessagePortMain,
	UtilityProcess as ElectronUtilityProcess,
} from 'electron';

import { Disposable } from 'cs/base/common/lifecycle';
import {
	getMockAgentPackageDefinition,
	mockAgentRuntimeProcessPrivilege,
} from 'cs/code/common/agentHost/mockAgentPackages';
import {
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
} from 'cs/platform/agentHost/common/identities';
import {
	createAgentRuntimeSandboxAuthority,
	type IAgentRuntimeSandboxAuthority,
	type IAgentRuntimeInstalledArtifactPort,
	isEqualAgentRuntimeSandboxAuthority,
} from 'cs/platform/agentHost/common/runtimeSandbox';
import type {
	IAgentRuntimeSandboxLaunchRequest,
	IAgentRuntimeSandboxProcess,
	IAgentRuntimeSandboxProcessPort,
} from 'cs/platform/agentHost/electron-main/agentRuntimeSandboxProcess';
import { UtilityProcess } from 'cs/platform/utilityProcess/electron-main/utilityProcess';

class MockAgentRuntimeSandboxProcess extends Disposable implements IAgentRuntimeSandboxProcess {
	constructor(
		readonly installedPackage: IAgentRuntimeSandboxProcess['installedPackage'],
		readonly authority: IAgentRuntimeSandboxAuthority,
		readonly connection: IAgentRuntimeSandboxProcess['connection'],
		readonly generation: IAgentRuntimeSandboxProcess['generation'],
		readonly child: ElectronUtilityProcess,
		private readonly processOwner: UtilityProcess,
	) {
		super();
		this._register(processOwner);
	}

	postMessage(message: unknown, ports: MessagePortMain[] = []): void {
		this.processOwner.postMessage(message, ports);
	}
}

/**
 * Temporary product mock for the sandbox process port. It preserves exact launch authority and
 * process ownership but intentionally does not claim operating-system sandbox enforcement.
 */
export class MockAgentRuntimeSandboxProcessPort implements IAgentRuntimeSandboxProcessPort {
	constructor(private readonly installedArtifacts: IAgentRuntimeInstalledArtifactPort) {}

	async launch(request: IAgentRuntimeSandboxLaunchRequest): Promise<IAgentRuntimeSandboxProcess> {
		const entryPoint = await this.installedArtifacts.resolveRuntimeEntryPoint(request.installedPackage);
		const definition = getMockAgentPackageDefinition(request.installedPackage.packageId);
		const expectedAuthority = createAgentRuntimeSandboxAuthority(
			request.installedPackage,
			mockAgentRuntimeProcessPrivilege,
		);
		if (!isEqualAgentRuntimeSandboxAuthority(request.authority, expectedAuthority)) {
			throw new Error(`Mock Agent package "${request.installedPackage.packageId}" sandbox authority changed.`);
		}
		createAgentRuntimeConnectionId(request.connection);
		createAgentRuntimeConnectionGeneration(request.generation);

		// The package-owned receipt authorization and byte verification immediately precede fork for
		// every transport generation. The current installable catalog is not runtime authority.
		const processOwner = new UtilityProcess();
		try {
			const child = processOwner.start(entryPoint, {
				serviceName: `Comet ${definition.displayName} Mock Agent Runtime`,
				environment: Object.freeze({}),
				execArgv: Object.freeze([]),
				workingDirectory: dirname(entryPoint),
				standardIO: 'ignore',
			});
			return new MockAgentRuntimeSandboxProcess(
				request.installedPackage,
				expectedAuthority,
				request.connection,
				request.generation,
				child,
				processOwner,
			);
		} catch (error) {
			processOwner.dispose();
			throw error;
		}
	}
}
