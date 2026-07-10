/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
	Application,
	ConsoleLogger,
	FileLogger,
	MultiLogger,
} from '../../automation';

const projectRoot = path.resolve(__dirname, '..', '..', '..');

export type SmokeTestContext = {
	readonly application: Application;
	readonly tempRoot: string;
};

export async function createSmokeTestContext(
	testName: string,
): Promise<SmokeTestContext> {
	const tempRoot = await mkdtemp(
		path.join(os.tmpdir(), `comet-smoke-${testName}-`),
	);
	const logsPath = path.join(tempRoot, 'logs');
	const logger = new MultiLogger([
		new ConsoleLogger(),
		new FileLogger(path.join(logsPath, 'smoke.log')),
	]);

	return {
		application: new Application({
			projectRoot,
			userDataDir: path.join(tempRoot, 'portable'),
			logsPath,
			logger,
		}),
		tempRoot,
	};
}

export async function disposeSmokeTestContext(
	context: SmokeTestContext | undefined,
): Promise<void> {
	if (!context) {
		return;
	}

	try {
		await context.application.stop();
	} finally {
		await rm(context.tempRoot, { recursive: true, force: true });
	}
}
