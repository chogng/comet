/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import type { IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import type { IAgentPackageOffering } from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';

/** Product-owned package metadata consumed by the local Host catalog. */
export interface ILocalAgentPackageProduct {
	readonly offering: IAgentPackageOffering;
	readonly verifiedPackage: IVerifiedAgentPackage;
	readonly definition: {
		readonly registration: IAgentRuntimeRegistration;
		readonly sessionType: IAgentHostSessionTypeDescriptor;
	};
}
