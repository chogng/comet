/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILogService } from 'cs/platform/log/common/log';

export class BrowserLogService implements ILogService {
	declare readonly _serviceBrand: undefined;

	trace(message: string, ...args: unknown[]): void {
		console.trace(message, ...args);
	}

	debug(message: string, ...args: unknown[]): void {
		console.debug(message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		console.info(message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		console.warn(message, ...args);
	}

	error(message: string | Error, ...args: unknown[]): void {
		console.error(message, ...args);
	}
}
