/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { FetchService } from 'cs/workbench/services/fetch/browser/fetchService';
import { FetchRegistry, IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';

registerSingleton(IFetchRegistry, FetchRegistry, InstantiationType.Delayed);
registerSingleton(IFetchService, FetchService, InstantiationType.Delayed);
