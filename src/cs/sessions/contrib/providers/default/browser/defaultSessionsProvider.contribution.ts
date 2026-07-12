/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { DefaultSessionsProvider } from 'cs/sessions/contrib/providers/default/browser/defaultSessionsProvider';
import { ISessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

/** Registers the desktop default Sessions provider for the returned lifetime. */
export function registerDefaultSessionsProvider(
	instantiationService: IInstantiationService,
	sessionsProvidersService: ISessionsProvidersService,
): IDisposable {
	const store = new DisposableStore();
	try {
		const provider = store.add(instantiationService.createInstance(DefaultSessionsProvider));
		store.add(sessionsProvidersService.registerProvider(provider));
		return store;
	} catch (error) {
		store.dispose();
		throw error;
	}
}

export class DefaultSessionsProviderContribution extends Disposable {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();
		this._register(registerDefaultSessionsProvider(instantiationService, sessionsProvidersService));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DefaultSessionsProviderContribution),
);
