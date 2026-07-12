/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchProviderDescriptor } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { ScienceFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFetchProvider';

export const scienceFetchProviderDescriptor: FetchProviderDescriptor = {
	id: 'publisher.science',
	ctor: ScienceFetchProvider,
};
