/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { utilityProcess, type MessagePortMain, type UtilityProcess as ElectronUtilityProcess } from 'electron';
import { Disposable } from 'cs/base/common/lifecycle';

export class UtilityProcess extends Disposable {
	private process: ElectronUtilityProcess | undefined;

	start(entryPoint: string, serviceName: string): ElectronUtilityProcess {
		if (this.process) {
			throw new Error('Utility process is already running.');
		}
		const process = utilityProcess.fork(entryPoint, [], { serviceName, stdio: 'pipe' });
		this.process = process;
		return process;
	}

	postMessage(message: unknown, ports: MessagePortMain[] = []): void {
		if (!this.process) {
			throw new Error('Utility process is not running.');
		}
		this.process.postMessage(message, ports);
	}

	override dispose(): void {
		this.process?.kill();
		this.process = undefined;
		super.dispose();
	}
}
