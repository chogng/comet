/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum LlmErrorCode {
	ProviderUnsupported = 'LLM_PROVIDER_UNSUPPORTED',
	ApiKeyMissing = 'LLM_API_KEY_MISSING',
	ModelMissing = 'LLM_MODEL_MISSING',
	BaseUrlInvalid = 'LLM_BASE_URL_INVALID',
	ConnectionFailed = 'LLM_CONNECTION_FAILED',
}

export class LlmError extends AppError {
	override readonly code: LlmErrorCode;

	constructor(code: LlmErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'LlmError';
		this.code = code;
		Object.setPrototypeOf(this, LlmError.prototype);
	}
}

export function llmError(code: LlmErrorCode, details?: Record<string, unknown>): LlmError {
	return new LlmError(code, details);
}

export function isLlmError(error: unknown): error is LlmError {
	return error instanceof LlmError || error instanceof AppError && Object.values(LlmErrorCode).includes(error.code as LlmErrorCode);
}
