/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackagePrivilege,
	IVerifiedAgentPackageDependency,
} from 'cs/platform/agentHost/common/packages';

export interface IVerifiedAgentPackage {
	readonly offering: IAgentPackageOffering;
	readonly manifest: IAgentPackageManifest;
	readonly dependencyClosure: readonly IVerifiedAgentPackageDependency[];
	readonly grantedPrivileges: readonly IAgentPackagePrivilege[];
}
