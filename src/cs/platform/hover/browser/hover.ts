/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IHoverDelegate } from 'cs/base/browser/ui/hover/hover';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IHoverService = createDecorator<IHoverService>('hoverService');

export interface IHoverService extends IHoverDelegate {
	readonly _serviceBrand: undefined;
}
