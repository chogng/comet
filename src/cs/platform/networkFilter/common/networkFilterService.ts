/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IAgentNetworkFilterService =
	createDecorator<IAgentNetworkFilterService>('agentNetworkFilterService');

export interface IAgentNetworkFilterService {
	readonly _serviceBrand: undefined;
	isUriAllowed(uri: URI): boolean;
	formatError(uri: URI): string;
}
