/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	Article,
	ArticlePageProof,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
	buildArticlePageProof,
	isArticlePageProofSatisfied,
} from 'cs/workbench/services/fetch/electron-main/articlePageProof';
import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';
import type { FetchTargetSession } from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';
import { resolvePublisherProfile } from 'cs/workbench/services/fetch/electron-main/publisherResolver';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';

export interface ArticleFetchRequest {
	readonly pageUrl: string;
	readonly targetSession: FetchTargetSession;
	readonly backgroundTimeoutMs: number;
	readonly webContentsViewTimeoutMs: number;
	readonly requireBody?: boolean;
	readonly signal?: AbortSignal;
}

export interface ArticleFetchResult {
	readonly article: Article;
	readonly document: FetchTargetDocument;
	readonly proof: ArticlePageProof;
}

function parseArticleDocument(
	document: FetchTargetDocument,
	requireBody: boolean,
) {
	const article = buildArticleFromHtml(document.requestedUrl, document.html);
	const proof = buildArticlePageProof(document, article);
	return {
		article,
		proof,
		accepted: isArticlePageProofSatisfied(proof, requireBody),
	};
}

export class ArticleFetchService {
	async fetch(request: ArticleFetchRequest): Promise<ArticleFetchResult> {
		const requireBody = Boolean(request.requireBody);
		const publisher = resolvePublisherProfile(request.pageUrl);
		const timeoutMs = request.targetSession.targetMode === 'webContentsView'
			? request.webContentsViewTimeoutMs
			: request.backgroundTimeoutMs;
		const document = await request.targetSession.load(request.pageUrl, {
			timeoutMs,
			settleMs: publisher.backgroundSettleMs,
			signal: request.signal,
			admitWebContentsViewDocument: candidate =>
				parseArticleDocument(candidate, requireBody).accepted,
		});
		const parsed = parseArticleDocument(document, requireBody);
		if (!parsed.accepted) {
			throw fetchError(FetchErrorCode.ArticlePageRejected, {
				url: request.pageUrl,
				finalUrl: document.finalUrl,
				targetMode: document.targetMode,
				statusCode: document.statusCode,
				publisherId: publisher.id,
				proof: parsed.proof,
			});
		}

		return {
			article: parsed.article,
			document,
			proof: parsed.proof,
		};
	}
}
