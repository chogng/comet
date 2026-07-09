/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum RequestErrorCode {
	HttpRequestFailed = 'HTTP_REQUEST_FAILED',
}

export class RequestError extends AppError {
	override readonly code: RequestErrorCode;

	constructor(code: RequestErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'RequestError';
		this.code = code;
		Object.setPrototypeOf(this, RequestError.prototype);
	}
}

export function requestError(code: RequestErrorCode, details?: Record<string, unknown>): RequestError {
	return new RequestError(code, details);
}

export function isRequestError(error: unknown): error is RequestError {
	return error instanceof RequestError || error instanceof AppError && Object.values(RequestErrorCode).includes(error.code as RequestErrorCode);
}
