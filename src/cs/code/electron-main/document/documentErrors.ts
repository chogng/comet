/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum DocumentErrorCode {
	DocxExportNoArticles = 'DOCX_EXPORT_NO_ARTICLES',
	DocxTranslationFailed = 'DOCX_TRANSLATION_FAILED',
	DocxExportFailed = 'DOCX_EXPORT_FAILED',
}

export class DocumentError extends AppError {
	override readonly code: DocumentErrorCode;

	constructor(code: DocumentErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'DocumentError';
		this.code = code;
		Object.setPrototypeOf(this, DocumentError.prototype);
	}
}

export function documentError(code: DocumentErrorCode, details?: Record<string, unknown>): DocumentError {
	return new DocumentError(code, details);
}

export function isDocumentError(error: unknown): error is DocumentError {
	return error instanceof DocumentError || error instanceof AppError && Object.values(DocumentErrorCode).includes(error.code as DocumentErrorCode);
}
