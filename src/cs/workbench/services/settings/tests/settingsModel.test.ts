/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { INativeHostService } from 'cs/platform/native/common/native';
import {
	INotificationService,
	NoOpNotificationService,
} from 'cs/platform/notification/common/notification';
import {
	ISettingsController,
	SettingsController,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
import {
	IWorkbenchLanguageService,
	WorkbenchLanguageService,
} from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import {
	ISettingsModel,
	SettingsModel,
} from 'cs/workbench/services/settings/settingsModel';
import { IEditorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';

class SettingsModelConsumer {
	constructor(@ISettingsModel readonly settingsModel: SettingsModel) {}
}

class SettingsControllerConsumer {
	constructor(@ISettingsController readonly settingsController: SettingsController) {}
}

test('Settings model and controller are delayed DI owners shared by consumers', () => {
	const registrations = getSingletonServiceDescriptors();
	const settingsModelRegistrations = registrations.filter(([id]) => id === ISettingsModel);
	const settingsControllerRegistrations = registrations.filter(([id]) => id === ISettingsController);
	const editorDraftStyleRegistrations = registrations.filter(([id]) => id === IEditorDraftStyleService);
	assert.equal(settingsModelRegistrations.length, 1);
	assert.equal(settingsControllerRegistrations.length, 1);
	assert.equal(editorDraftStyleRegistrations.length, 1);

	const settingsModelDescriptor = settingsModelRegistrations[0][1];
	const settingsControllerDescriptor = settingsControllerRegistrations[0][1];
	const editorDraftStyleDescriptor = editorDraftStyleRegistrations[0][1];
	assert.equal(settingsModelDescriptor.supportsDelayedInstantiation, true);
	assert.equal(settingsControllerDescriptor.supportsDelayedInstantiation, true);
	assert.equal(editorDraftStyleDescriptor.supportsDelayedInstantiation, true);

	const services = new ServiceCollection(
		[ISettingsModel, settingsModelDescriptor],
		[ISettingsController, settingsControllerDescriptor],
		[IEditorDraftStyleService, editorDraftStyleDescriptor],
		[INativeHostService, {
			canInvoke: () => false,
			invoke: async () => {
				throw new Error('Desktop invocation is unavailable in this test.');
			},
		} as unknown as INativeHostService],
		[INotificationService, new NoOpNotificationService()],
		[IWorkbenchLocaleService, {
			getLocale: () => 'en',
		} as never],
		[IWorkbenchLanguageService, new WorkbenchLanguageService()],
	);
	const instantiationService = new InstantiationService(services, true);

	try {
		assert.equal(services.get(ISettingsModel), settingsModelDescriptor);
		assert.equal(services.get(ISettingsController), settingsControllerDescriptor);

		const firstConsumer = instantiationService.createInstance(SettingsModelConsumer);
		const secondConsumer = instantiationService.createInstance(SettingsModelConsumer);
		const firstControllerConsumer = instantiationService.createInstance(SettingsControllerConsumer);
		const secondControllerConsumer = instantiationService.createInstance(SettingsControllerConsumer);

		assert(firstConsumer.settingsModel instanceof SettingsModel);
		assert.equal(firstConsumer.settingsModel, secondConsumer.settingsModel);
		assert.equal(
			firstControllerConsumer.settingsController,
			secondControllerConsumer.settingsController,
		);
		assert.equal(services.get(ISettingsModel), firstConsumer.settingsModel);
		assert.equal(services.get(ISettingsController), firstControllerConsumer.settingsController);

		firstConsumer.settingsModel.setUseMica(false);
		assert.equal(firstControllerConsumer.settingsController.getSnapshot().useMica, false);
	} finally {
		instantiationService.dispose();
	}
});
