/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	isScienceHostUrl,
} from 'cs/base/common/url';
import { normalizeUrl } from 'cs/workbench/common/url';
export type PreparedPdfDownload = {
	normalizedSourceUrl: string;
	preferredPdfUrl: string;
	isSciencePdfDownload: boolean;
};

export function canExportArticlesDocx(articleCount: number) {
	return articleCount > 0;
}

export function preparePdfDownload(
	sourceUrl: string,
	pdfUrl: string | null | undefined,
): PreparedPdfDownload | null {
	const normalizedSourceUrl = normalizeUrl(sourceUrl);
	const normalizedPdfUrl = normalizeUrl(pdfUrl ?? '');
	if (!normalizedSourceUrl || !normalizedPdfUrl) {
		return null;
	}

	return {
		normalizedSourceUrl,
		preferredPdfUrl: normalizedPdfUrl,
		isSciencePdfDownload: isScienceHostUrl(normalizedSourceUrl),
	};
}

export function resolvePreferredDirectory(directory: string) {
	const trimmedDirectory = directory.trim();
	return trimmedDirectory || null;
}
