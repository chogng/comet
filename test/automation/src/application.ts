/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import type { LaunchOptions } from './electron';
import { launchElectron } from './playwrightElectron';
import { Workbench } from './workbench';

export type ApplicationOptions = LaunchOptions;

export class Application {
	private codeInstance: Code | undefined;
	private workbenchInstance: Workbench | undefined;

	constructor(private readonly options: ApplicationOptions) {}

	get code(): Code {
		if (!this.codeInstance) {
			throw new Error('The application has not started.');
		}
		return this.codeInstance;
	}

	get workbench(): Workbench {
		if (!this.workbenchInstance) {
			throw new Error('The application has not started.');
		}
		return this.workbenchInstance;
	}

	async start(): Promise<void> {
		const driver = await launchElectron(this.options);
		this.codeInstance = new Code(driver, this.options.logger);
		this.workbenchInstance = new Workbench(this.codeInstance);

		try {
			await this.workbenchInstance.waitForReady();
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	async reloadWithLocalStorage(
		entries: Readonly<Record<string, string>>,
	): Promise<void> {
		await this.code.setLocalStorage(entries);
		await this.code.reload();
	}

	async stop(): Promise<void> {
		if (!this.codeInstance) {
			return;
		}

		const code = this.codeInstance;
		this.codeInstance = undefined;
		this.workbenchInstance = undefined;
		await code.exit();
	}
}
