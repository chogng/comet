/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { FetchRegistry, IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { FetchService } from 'cs/workbench/services/fetch/electron-browser/fetchService';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';
import { NatureFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureFetchProvider';
import { natureJournals } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureJournals';
import { ScienceFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFetchProvider';
import { scienceJournals } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceJournals';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

registerSingleton(IFetchRegistry, FetchRegistry, InstantiationType.Delayed);
registerSingleton(IFetchService, FetchService, InstantiationType.Delayed);
registerSingleton(IFetchPageSessionFactory, FetchPageSessionFactory, InstantiationType.Delayed);

registerWorkbenchContribution(() => {
	const registry = getWorkbenchInstantiationService().invokeFunction(accessor => accessor.get(IFetchRegistry));
	const registrations = [
		registry.registerProvider({ id: 'publisher.nature', ctor: NatureFetchProvider }),
		registry.registerProvider({ id: 'publisher.science', ctor: ScienceFetchProvider }),
		...natureJournals.map(journal => registry.registerJournal(journal)),
		...scienceJournals.map(journal => registry.registerJournal(journal)),
	];
	return {
		dispose: () => {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
		},
	};
});
