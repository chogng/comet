/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentContentResourceHostLimits } from 'cs/platform/agentHost/node/content/agentContentResourceService';

const mebibyte = 1024 * 1024;

/** Product limits enforced by the local Host content-resource authority. */
export const localAgentHostContentResourceLimits: IAgentContentResourceHostLimits = Object.freeze({
	maximumContentBytes: 20 * mebibyte,
	maximumReadLength: mebibyte,
	maximumTotalReadBytesPerLease: 24 * mebibyte,
	maximumTreeEntries: 4_096,
	maximumTreeDepth: 32,
	maximumTreePageEntries: 256,
	maximumTreePages: 32,
	maximumOpenLeases: 64,
	maximumMaterializations: 32,
	maximumConcurrentOperations: 16,
	maximumConcurrentOperationsPerLease: 4,
	operationTimeoutMilliseconds: 30 * 1_000,
	leaseLifetimeMilliseconds: 5 * 60 * 1_000,
});
