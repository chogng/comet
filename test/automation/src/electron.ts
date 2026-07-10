/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { access, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import type { Logger } from './logger';

const requireFromAutomation = createRequire(__filename);

export interface LaunchOptions {
	readonly projectRoot: string;
	readonly userDataDir: string;
	readonly logsPath: string;
	readonly logger: Logger;
	readonly extraArgs?: readonly string[];
	readonly extraEnv?: Readonly<Record<string, string | undefined>>;
}

export interface ElectronConfiguration {
	readonly electronPath: string;
	readonly args: string[];
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
}

export async function resolveElectronConfiguration(
	options: LaunchOptions,
): Promise<ElectronConfiguration> {
	const mainEntry = path.join(
		options.projectRoot,
		'dist-electron',
		'code',
		'electron-main',
		'main.js',
	);
	const workbenchEntry = path.join(
		options.projectRoot,
		'dist',
		'src',
		'cs',
		'code',
		'electron-browser',
		'workbench.html',
	);

	await Promise.all([
		access(mainEntry),
		access(workbenchEntry),
		mkdir(options.userDataDir, { recursive: true }),
		mkdir(options.logsPath, { recursive: true }),
	]);

	const electronPath = requireFromAutomation('electron') as string;
	if (typeof electronPath !== 'string') {
		throw new Error('The Electron package did not resolve to an executable path.');
	}

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PORTABLE_EXECUTABLE_DIR: options.userDataDir,
	};
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.ELECTRON_RENDERER_URL;
	delete env.LS_RENDERER_DEBUG;

	for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
		if (value === undefined) {
			delete env[key];
		} else {
			env[key] = value;
		}
	}

	return {
		electronPath,
		args: [
			mainEntry,
			'--enable-smoke-test-driver',
			...(options.extraArgs ?? []),
		],
		cwd: options.projectRoot,
		env,
	};
}
