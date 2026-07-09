/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum ValidationErrorCode {
	UrlEmpty = 'URL_EMPTY',
	UrlProtocolUnsupported = 'URL_PROTOCOL_UNSUPPORTED',
	DateStartInvalid = 'DATE_START_INVALID',
	DateEndInvalid = 'DATE_END_INVALID',
	DateRangeInvalid = 'DATE_RANGE_INVALID',
}

export class ValidationError extends AppError {
	override readonly code: ValidationErrorCode;

	constructor(code: ValidationErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'ValidationError';
		this.code = code;
		Object.setPrototypeOf(this, ValidationError.prototype);
	}
}

export function validationError(code: ValidationErrorCode, details?: Record<string, unknown>): ValidationError {
	return new ValidationError(code, details);
}
