/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IClientContentResourceLimits } from 'cs/platform/agentHost/browser/clientContentResources';

const mebibyte = 1024 * 1024;

/** Maximum exact connected-client Tool calls retained for retry and reconciliation. */
export const localAgentClientToolCallRecords = 4_096;

/** Product limits accepted by the renderer-owned immutable content publisher. */
export const localAgentClientContentResourceLimits: IClientContentResourceLimits = Object.freeze({
	maximumBlobBytes: 10 * mebibyte,
	maximumTreeBytes: 20 * mebibyte,
	maximumTreeEntries: 4_096,
	maximumTreeDepth: 32,
	maximumReadLength: mebibyte,
	maximumOpenLeases: 64,
	maximumConcurrentOperations: 16,
	maximumTotalReadBytes: 24 * mebibyte,
	maximumTreePageEntries: 256,
	maximumTreePages: 32,
	maximumLeaseDurationMilliseconds: 5 * 60 * 1_000,
});
