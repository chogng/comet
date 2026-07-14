/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from 'electron';

import { Disposable } from 'cs/base/common/lifecycle';
import {
	localAgentRuntimeArtifactEnvironment,
	localAgentRuntimeProcessPrivilege,
	localAgentRuntimeStateEnvironment,
} from 'cs/code/common/agentHost/localAgentRuntimeProtocol';
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

class LocalAgentRuntimeSandboxProcess extends Disposable implements IAgentRuntimeSandboxProcess {
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

export interface ILocalAgentRuntimeSandboxProcessPortOptions {
	readonly installedArtifacts: IAgentRuntimeInstalledArtifactPort;
	readonly stateRoot: string;
	readonly executableArtifactTargets: readonly string[];
}

/** Owns exact package launch authority, private runtime state, and utility-process creation. */
export class LocalAgentRuntimeSandboxProcessPort implements IAgentRuntimeSandboxProcessPort {
	private readonly executableArtifactTargets: ReadonlySet<string>;

	constructor(private readonly options: ILocalAgentRuntimeSandboxProcessPortOptions) {
		if (!isAbsolute(options.stateRoot)) {
			throw new Error('Agent Runtime state root must be absolute.');
		}
		this.executableArtifactTargets = new Set(options.executableArtifactTargets);
		if (this.executableArtifactTargets.size !== options.executableArtifactTargets.length) {
			throw new Error('Agent Runtime executable artifact targets contain duplicates.');
		}
	}

	async launch(request: IAgentRuntimeSandboxLaunchRequest): Promise<IAgentRuntimeSandboxProcess> {
		const entryPoint = await this.options.installedArtifacts.resolveRuntimeEntryPoint(request.installedPackage);
		const expectedAuthority = createAgentRuntimeSandboxAuthority(
			request.installedPackage,
			localAgentRuntimeProcessPrivilege,
		);
		if (!isEqualAgentRuntimeSandboxAuthority(request.authority, expectedAuthority)) {
			throw new Error(`Agent package "${request.installedPackage.packageId}" sandbox authority changed.`);
		}
		createAgentRuntimeConnectionId(request.connection);
		createAgentRuntimeConnectionGeneration(request.generation);

		const artifacts: Record<string, string> = {};
		for (const artifact of expectedAuthority.artifacts) {
			const artifactPath = fileURLToPath(artifact.source);
			artifacts[artifact.target] = artifactPath;
			if (this.executableArtifactTargets.has(artifact.target)) {
				await chmod(artifactPath, 0o500);
			}
		}
		const stateDirectory = await this.resolveStateDirectory(request.installedPackage.packageId);

		const processOwner = new UtilityProcess();
		try {
			const child = processOwner.start(entryPoint, {
				serviceName: `Comet ${request.installedPackage.packageId} Agent Runtime`,
				environment: Object.freeze({
					[localAgentRuntimeArtifactEnvironment]: JSON.stringify(artifacts),
					[localAgentRuntimeStateEnvironment]: stateDirectory,
				}),
				execArgv: Object.freeze([]),
				workingDirectory: dirname(entryPoint),
				standardIO: 'ignore',
			});
			return new LocalAgentRuntimeSandboxProcess(
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

	private async resolveStateDirectory(packageId: string): Promise<string> {
		await mkdir(this.options.stateRoot, { recursive: true, mode: 0o700 });
		const rootMetadata = await lstat(this.options.stateRoot);
		if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
			throw new Error('Agent Runtime state root must be a real directory.');
		}
		const canonicalRoot = await realpath(this.options.stateRoot);
		await chmod(canonicalRoot, 0o700);
		const stateIdentity = createHash('sha256').update(packageId).digest('hex');
		const candidate = join(canonicalRoot, stateIdentity);
		await mkdir(candidate, { recursive: true, mode: 0o700 });
		const stateMetadata = await lstat(candidate);
		if (!stateMetadata.isDirectory() || stateMetadata.isSymbolicLink()) {
			throw new Error(`Agent package "${packageId}" runtime state must be a real directory.`);
		}
		const stateDirectory = await realpath(candidate);
		if (dirname(stateDirectory) !== canonicalRoot) {
			throw new Error(`Agent package "${packageId}" runtime state has the wrong parent.`);
		}
		await chmod(stateDirectory, 0o700);
		return stateDirectory;
	}
}
