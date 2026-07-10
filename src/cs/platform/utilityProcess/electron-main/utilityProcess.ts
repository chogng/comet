/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { utilityProcess, type MessagePortMain, type UtilityProcess as ElectronUtilityProcess } from 'electron';
import { Disposable } from 'cs/base/common/lifecycle';

export class UtilityProcess extends Disposable {
	private process: ElectronUtilityProcess | undefined;

	start(entryPoint: string): Promise<void> {
		if (this.process) {
			throw new Error('Utility process is already running.');
		}
		const process = utilityProcess.fork(entryPoint, [], { stdio: 'pipe' });
		this.process = process;
		return new Promise<void>((resolve, reject) => {
			const onMessage = (message: unknown) => {
				if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'comet:shared-process-ready') {
					process.off('exit', onExit);
					resolve();
				}
			};
			const onExit = (code: number) => {
				process.off('message', onMessage);
				reject(new Error(`Utility process exited before initialization (code ${code}).`));
			};
			process.on('message', onMessage);
			process.once('exit', onExit);
		});
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
