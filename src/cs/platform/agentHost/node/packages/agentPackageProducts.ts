/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import type { IAgentPackageOffering } from 'cs/platform/agentHost/common/packages';
import type { IInstalledAgentPackage } from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { IAgent, IAgentDescriptor, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import type { IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import type {
	AgentId,
	AgentPackageId,
} from 'cs/platform/agentHost/common/identities';

/** Maps one product-authorized credential reference to its Host secret grant. */
export interface IAgentPackageCredentialBinding {
	readonly provider: string;
	readonly scope: string;
	readonly reference: string;
	readonly privilege: string;
}

interface ILocalAgentPackageProductBase {
	readonly offering: IAgentPackageOffering;
	readonly verifiedPackage: IVerifiedAgentPackage;
	readonly credentialBindings: readonly IAgentPackageCredentialBinding[];
	readonly definition: {
		readonly packageId: AgentPackageId;
		readonly agentId: AgentId;
		resolveRegistrationRevision(descriptor: IAgentDescriptor): IAgentRuntimeRegistration['revision'];
		resolveSessionType(descriptor: IAgentDescriptor): IAgentHostSessionTypeDescriptor;
	};
}

export interface ILocalConnectedAgentPackageProduct extends ILocalAgentPackageProductBase {
	readonly execution: 'connected';
}

export interface ILocalHostAgentPackageProduct extends ILocalAgentPackageProductBase {
	readonly execution: 'host';
	createAgent(
		installedPackage: IInstalledAgentPackage,
		services: {
			readonly toolExecution: IAgentToolExecutionPort;
			readonly credentialResolver: IAgentCredentialResolver;
		},
	): Promise<{
		readonly agents: readonly IAgent[];
		readonly lifetime: IDisposable;
	}>;
}

/** Product-owned package metadata consumed by the local Host catalog. */
export type ILocalAgentPackageProduct = ILocalConnectedAgentPackageProduct | ILocalHostAgentPackageProduct;
