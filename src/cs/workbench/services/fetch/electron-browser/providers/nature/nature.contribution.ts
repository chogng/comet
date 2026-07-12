/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchProviderDescriptor } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { NatureFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureFetchProvider';

export const natureFetchProviderDescriptor: FetchProviderDescriptor = {
	id: 'publisher.nature',
	ctor: NatureFetchProvider,
};
