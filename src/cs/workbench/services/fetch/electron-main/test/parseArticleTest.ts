/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';

import { URI } from 'cs/base/common/uri';
import { getFetchArticleBodyText } from 'cs/base/parts/sandbox/common/fetchArticle';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { parseFetchArticleSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';

async function main() {
	const [, , sourceUrl, htmlPath] = process.argv;
	if (!sourceUrl || !htmlPath) {
		console.error('Usage: node parseArticleTest.js <source-url> <html-path>');
		process.exitCode = 1;
		return;
	}
	const html = await readFile(htmlPath, 'utf8');
	const uri = URI.parse(sourceUrl);
	const result = parseFetchArticleSnapshot({
		resource: BrowserViewUri.forId('parse-article-test'),
		presentation: 'background',
		requestedUri: uri,
		finalUri: uri,
		statusCode: 200,
		html,
		documentReadyState: 'complete',
	});
	const body = getFetchArticleBodyText(result.article);
	console.log(JSON.stringify({
		title: result.article.title,
		articleKind: result.article.articleKind,
		sourceArticleType: result.article.sourceArticleType,
		publication: result.article.publication,
		doi: result.article.doi,
		authors: result.article.authors,
		abstractLength: result.article.abstract?.length ?? 0,
		abstractPreview: result.article.abstract?.slice(0, 300) ?? null,
		bodyLength: body.length,
		bodyPreview: body.slice(0, 600),
		figureCount: result.article.figures.length,
		figures: result.article.figures,
		publishedAt: result.article.publishedAt,
		proof: result.proof,
		diagnostics: result.diagnostics,
	}, null, 2));
}

void main();
