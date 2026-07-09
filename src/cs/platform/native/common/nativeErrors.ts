/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum NativeErrorCode {
	UnknownError = 'UNKNOWN_ERROR',
	UnknownCommand = 'UNKNOWN_COMMAND',
	UrlProtocolUnsupported = 'URL_PROTOCOL_UNSUPPORTED',
}

export class NativeError extends AppError {
	override readonly code: NativeErrorCode;

	constructor(code: NativeErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'NativeError';
		this.code = code;
		Object.setPrototypeOf(this, NativeError.prototype);
	}
}

export function nativeError(code: NativeErrorCode, details?: Record<string, unknown>): NativeError {
	return new NativeError(code, details);
}
