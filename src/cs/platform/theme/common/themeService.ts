/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColorIdentifier } from 'cs/platform/theme/common/colorRegistry';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IThemeService = createDecorator<IThemeService>('themeService');

export interface IColorTheme {
	getColor(color: ColorIdentifier | string): { toString(): string } | undefined;
}

export interface IThemeService {
	readonly _serviceBrand: undefined;
	getColorTheme(): IColorTheme;
}
