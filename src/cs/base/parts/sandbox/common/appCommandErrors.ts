/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum AppCommandErrorCode {
	MainWindowUnavailable = 'MAIN_WINDOW_UNAVAILABLE',
	UnknownCommand = 'UNKNOWN_COMMAND',
	UnknownError = 'UNKNOWN_ERROR',
}

export class AppCommandError extends AppError {
	override readonly code: AppCommandErrorCode;

	constructor(code: AppCommandErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'AppCommandError';
		this.code = code;
		Object.setPrototypeOf(this, AppCommandError.prototype);
	}
}

export function appCommandError(code: AppCommandErrorCode, details?: Record<string, unknown>): AppCommandError {
	return new AppCommandError(code, details);
}
