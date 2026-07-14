/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	MessagePortMain,
	UtilityProcess as ElectronUtilityProcess,
} from 'electron';

import type { IDisposable } from 'cs/base/common/lifecycle';
import type {
	AgentRuntimeConnectionGeneration,
	AgentRuntimeConnectionId,
} from '../common/identities.js';
import type { IInstalledAgentPackage } from '../common/packages.js';
import type { IAgentRuntimeSandboxAuthority } from '../common/runtimeSandbox.js';

export interface IAgentRuntimeSandboxLaunchRequest {
	readonly installedPackage: IInstalledAgentPackage;
	readonly authority: IAgentRuntimeSandboxAuthority;
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
}

export interface IAgentRuntimeSandboxProcess extends IDisposable {
	readonly installedPackage: IInstalledAgentPackage;
	readonly authority: IAgentRuntimeSandboxAuthority;
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly child: ElectronUtilityProcess;
	postMessage(message: unknown, ports?: MessagePortMain[]): void;
}

/** Launches one exact connected runtime generation under product-owned sandbox authority. */
export interface IAgentRuntimeSandboxProcessPort {
	launch(request: IAgentRuntimeSandboxLaunchRequest): Promise<IAgentRuntimeSandboxProcess>;
}
