/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { format } from 'node:util';

export interface Logger {
	log(message: string, ...args: readonly object[]): void;
}

export class ConsoleLogger implements Logger {
	log(message: string, ...args: readonly object[]): void {
		console.log(message, ...args);
	}
}

export class FileLogger implements Logger {
	constructor(private readonly filePath: string) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, '');
	}

	log(message: string, ...args: readonly object[]): void {
		fs.appendFileSync(
			this.filePath,
			`${new Date().toISOString()} ${format(message, ...args)}\n`,
		);
	}
}

export class MultiLogger implements Logger {
	constructor(private readonly loggers: readonly Logger[]) {}

	log(message: string, ...args: readonly object[]): void {
		for (const logger of this.loggers) {
			logger.log(message, ...args);
		}
	}
}
