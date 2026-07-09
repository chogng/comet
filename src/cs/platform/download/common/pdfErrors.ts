/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError } from 'cs/base/parts/sandbox/common/appError';

export enum PdfErrorCode {
	LinkNotFound = 'PDF_LINK_NOT_FOUND',
	DownloadFailed = 'PDF_DOWNLOAD_FAILED',
}

export class PdfError extends AppError {
	override readonly code: PdfErrorCode;

	constructor(code: PdfErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'PdfError';
		this.code = code;
		Object.setPrototypeOf(this, PdfError.prototype);
	}
}

export function pdfError(code: PdfErrorCode, details?: Record<string, unknown>): PdfError {
	return new PdfError(code, details);
}

export function isPdfError(error: unknown): error is PdfError {
	return error instanceof PdfError || error instanceof AppError && Object.values(PdfErrorCode).includes(error.code as PdfErrorCode);
}
