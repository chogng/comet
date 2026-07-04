/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	HoverDelegate,
	setBaseLayerHoverDelegate,
} from 'cs/base/browser/ui/hover/hoverDelegate';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { IHoverService } from 'cs/platform/hover/browser/hover';

export class HoverService extends HoverDelegate implements IHoverService {
	declare readonly _serviceBrand: undefined;

	constructor() {
		super();
		setBaseLayerHoverDelegate(this);
	}
}

export const hoverService = new HoverService();

export function getHoverService(): IHoverService {
	return hoverService;
}

registerSingleton(IHoverService, HoverService, InstantiationType.Delayed);
