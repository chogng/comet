/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum BrowserViewErrorCode {
	PreviewNotReady = 'PREVIEW_NOT_READY',
}

export class BrowserViewError extends AppError {
	override readonly code: BrowserViewErrorCode;

	constructor(code: BrowserViewErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'BrowserViewError';
		this.code = code;
		Object.setPrototypeOf(this, BrowserViewError.prototype);
	}
}

export function browserViewError(code: BrowserViewErrorCode, details?: Record<string, unknown>): BrowserViewError {
	return new BrowserViewError(code, details);
}
