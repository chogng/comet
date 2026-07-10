/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchAcsSite } from 'cs/workbench/services/fetch/electron-main/sites/acs/fetchAcsSite';
import { fetchNatureSite } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureSite';
import { fetchScienceSite } from 'cs/workbench/services/fetch/electron-main/sites/science/fetchScienceSite';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';
import { fetchWileySite } from 'cs/workbench/services/fetch/electron-main/sites/wiley/fetchWileySite';

export const fetchSiteProviders: readonly FetchSiteProvider[] = [
	fetchNatureSite,
	fetchScienceSite,
	fetchAcsSite,
	fetchWileySite,
];
