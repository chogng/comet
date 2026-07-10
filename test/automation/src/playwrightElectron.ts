/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';

import { resolveElectronConfiguration, type LaunchOptions } from './electron';
import { PlaywrightDriver } from './playwrightDriver';

const launchTimeout = 60_000;

export async function launchElectron(
	options: LaunchOptions,
): Promise<PlaywrightDriver> {
	const configuration = await resolveElectronConfiguration(options);
	options.logger.log(`[electron] launching ${configuration.electronPath}`);

	const application = await playwright._electron.launch({
		executablePath: configuration.electronPath,
		args: configuration.args,
		cwd: configuration.cwd,
		env: configuration.env as Record<string, string>,
		timeout: launchTimeout,
	});
	const page = await application.firstWindow({ timeout: launchTimeout });
	return new PlaywrightDriver(application, page, options);
}
