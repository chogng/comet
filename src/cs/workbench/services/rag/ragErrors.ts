/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum RagErrorCode {
	ProviderUnsupported = 'RAG_PROVIDER_UNSUPPORTED',
	ApiKeyMissing = 'RAG_API_KEY_MISSING',
	BaseUrlInvalid = 'RAG_BASE_URL_INVALID',
	EmbeddingModelMissing = 'RAG_EMBEDDING_MODEL_MISSING',
	RerankerModelMissing = 'RAG_RERANKER_MODEL_MISSING',
	ConnectionFailed = 'RAG_CONNECTION_FAILED',
	QueryEmpty = 'RAG_QUERY_EMPTY',
}

export class RagError extends AppError {
	override readonly code: RagErrorCode;

	constructor(code: RagErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'RagError';
		this.code = code;
		Object.setPrototypeOf(this, RagError.prototype);
	}
}

export function ragError(code: RagErrorCode, details?: Record<string, unknown>): RagError {
	return new RagError(code, details);
}

export function isRagError(error: unknown): error is RagError {
	return error instanceof RagError || error instanceof AppError && Object.values(RagErrorCode).includes(error.code as RagErrorCode);
}
