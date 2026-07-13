/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleReadableContent } from 'cs/workbench/services/fetch/common/fetchProvider';
import { extractArticleReadableText } from 'cs/workbench/services/fetch/electron-browser/articleReadableContentParser';

export const scienceArticleReadableBodySelector = 'main .article__body';

function title(document: Document, base: URI): string {
	const value = document.querySelector('main h1')?.textContent?.replace(/\s+/gu, ' ').trim();
	if (!value) {
		throw new Error(`Science article "${base.toString(true)}" does not contain a title.`);
	}
	return value;
}

export function parseScienceArticleReadableContent(
	document: Document,
	base: URI,
): ParsedArticleReadableContent {
	const body = document.querySelector(scienceArticleReadableBodySelector);
	if (!body) {
		throw new Error(`Science article "${base.toString(true)}" does not contain its readable body.`);
	}
	return {
		url: base,
		title: title(document, base),
		text: extractArticleReadableText(body, `Science article "${base.toString(true)}"`),
	};
}
