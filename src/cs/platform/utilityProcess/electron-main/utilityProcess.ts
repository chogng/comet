/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { utilityProcess, type MessagePortMain, type UtilityProcess as ElectronUtilityProcess } from 'electron';
import { isAbsolute } from 'node:path';
import { Disposable } from 'cs/base/common/lifecycle';

export interface IUtilityProcessStartOptions {
	readonly serviceName: string;
	readonly environment: Readonly<NodeJS.ProcessEnv>;
	readonly execArgv: readonly string[];
	readonly workingDirectory: string;
	readonly standardIO: 'ignore' | 'pipe';
}

function processEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(source)) {
		if (value !== undefined) {
			environment[key] = String(value);
		}
	}
	delete environment.DEBUG;
	delete environment.NODE_OPTIONS;
	if (process.platform === 'linux') {
		delete environment.LD_PRELOAD;
	}
	return environment;
}

export class UtilityProcess extends Disposable {
	private process: ElectronUtilityProcess | undefined;

	start(entryPoint: string, options: IUtilityProcessStartOptions): ElectronUtilityProcess {
		if (this.process) {
			throw new Error('Utility process is already running.');
		}
		if (
			options.serviceName.length === 0
			|| options.execArgv.some(argument => typeof argument !== 'string')
			|| !isAbsolute(options.workingDirectory)
			|| (options.standardIO !== 'ignore' && options.standardIO !== 'pipe')
		) {
			throw new Error('Utility process start options are invalid.');
		}
		const process = utilityProcess.fork(entryPoint, [], {
			serviceName: options.serviceName,
			stdio: options.standardIO,
			env: processEnvironment(options.environment),
			execArgv: [...options.execArgv],
			cwd: options.workingDirectory,
		});
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
