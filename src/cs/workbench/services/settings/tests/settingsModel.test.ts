/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import {
	SettingsController,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
import {
	ISettingsModel,
	SettingsModel,
} from 'cs/workbench/services/settings/settingsModel';
import { locales } from 'language/locales';

class SettingsModelConsumer {
	constructor(@ISettingsModel readonly settingsModel: SettingsModel) {}
}

test('SettingsModel is one delayed DI owner shared by SettingsController and consumers', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ISettingsModel);
	assert.equal(registrations.length, 1);

	const descriptor = registrations[0][1];
	assert.equal(descriptor.supportsDelayedInstantiation, true);

	const services = new ServiceCollection([ISettingsModel, descriptor]);
	const instantiationService = new InstantiationService(services, true);
	let controller: SettingsController | undefined;

	try {
		assert.equal(services.get(ISettingsModel), descriptor);

		controller = instantiationService.createInstance(SettingsController, {
			desktopRuntime: false,
			invokeDesktop: async () => {
				throw new Error('Desktop invocation is unavailable in this test.');
			},
			notificationService: new NoOpNotificationService(),
			ui: locales.en,
			locale: 'en',
		});
		const firstConsumer = instantiationService.createInstance(SettingsModelConsumer);
		const secondConsumer = instantiationService.createInstance(SettingsModelConsumer);

		assert(firstConsumer.settingsModel instanceof SettingsModel);
		assert.equal(firstConsumer.settingsModel, secondConsumer.settingsModel);
		assert.equal(services.get(ISettingsModel), firstConsumer.settingsModel);

		firstConsumer.settingsModel.setUseMica(false);
		assert.equal(controller.getSnapshot().useMica, false);
	} finally {
		controller?.dispose();
		instantiationService.dispose();
	}
});
