/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';
import type {
	FetchArticleDetailParser,
	FetchArticleDetailParserContext,
	FetchArticleDetailParserProof,
	FetchArticleListParser,
	FetchArticleListParserContext,
	FetchArticleListParserProof,
	FetchArticleListSource,
	FetchSiteProvider,
} from 'cs/workbench/services/fetch/electron-main/sites/types';

export interface ResolvedFetchArticleListParser {
	readonly parser: FetchArticleListParser;
	readonly proof: FetchArticleListParserProof;
}

export interface ResolvedFetchArticleDetailParser {
	readonly parser: FetchArticleDetailParser;
	readonly proof: FetchArticleDetailParserProof;
}

export function resolveFetchArticleListSource(
	site: FetchSiteProvider,
	uri: URI,
): FetchArticleListSource {
	const matched = site.articleListSources.filter(source => source.matchUri(uri));
	if (matched.length === 0) {
		throw fetchError(FetchErrorCode.UnsupportedArticleListSource, {
			siteId: site.id,
			uri: uri.toString(true),
		});
	}
	if (matched.length > 1) {
		throw fetchError(FetchErrorCode.AmbiguousArticleListSource, {
			siteId: site.id,
			uri: uri.toString(true),
			sourceIds: matched.map(source => source.id),
		});
	}
	return matched[0];
}

export function resolveFetchArticleListParser(
	site: FetchSiteProvider,
	source: FetchArticleListSource,
	context: FetchArticleListParserContext,
): ResolvedFetchArticleListParser {
	const allowedIds = new Set(source.allowedParserIds);
	const matched = site.articleListParsers
		.filter(parser => allowedIds.has(parser.id))
		.map(parser => ({ parser, proof: parser.match(context) }))
		.filter((item): item is ResolvedFetchArticleListParser => item.proof !== undefined);
	if (matched.length === 0) {
		throw fetchError(FetchErrorCode.UnsupportedArticleListStructure, {
			siteId: site.id,
			sourceId: source.id,
			uri: context.sourceUri.toString(true),
			allowedParserIds: source.allowedParserIds,
		});
	}
	if (matched.length > 1) {
		throw fetchError(FetchErrorCode.AmbiguousArticleListStructure, {
			siteId: site.id,
			sourceId: source.id,
			uri: context.sourceUri.toString(true),
			parserIds: matched.map(item => item.parser.id),
		});
	}
	return matched[0];
}

export function resolveFetchArticleDetailParser(
	site: FetchSiteProvider,
	context: FetchArticleDetailParserContext,
): ResolvedFetchArticleDetailParser {
	const allowedParserIds = context.identity && site.resolveArticleDetailParserIds
		? site.resolveArticleDetailParserIds(context.identity)
		: undefined;
	const allowedIdSet = allowedParserIds ? new Set(allowedParserIds) : undefined;
	const collectMatches = (parsers: readonly FetchArticleDetailParser[]) => parsers
		.map(parser => ({ parser, proof: parser.match(context) }))
		.filter((item): item is ResolvedFetchArticleDetailParser => item.proof !== undefined);
	const candidates = allowedIdSet
		? site.articleDetailParsers.filter(parser => allowedIdSet.has(parser.id))
		: site.articleDetailParsers;
	const matched = collectMatches(candidates);
	if (matched.length === 0) {
		if (allowedIdSet) {
			const conflicting = collectMatches(
				site.articleDetailParsers.filter(parser => !allowedIdSet.has(parser.id)),
			);
			if (conflicting.length > 0) {
				throw fetchError(FetchErrorCode.ArticleIdentityStructureConflict, {
					siteId: site.id,
					uri: context.sourceUri.toString(true),
					pageFamilyHint: context.identity?.pageFamilyHint,
					parserIds: conflicting.map(item => item.parser.id),
				});
			}
		}
		throw fetchError(FetchErrorCode.UnsupportedArticleDetailStructure, {
			siteId: site.id,
			uri: context.sourceUri.toString(true),
			allowedParserIds,
		});
	}
	if (matched.length > 1) {
		throw fetchError(FetchErrorCode.AmbiguousArticleDetailStructure, {
			siteId: site.id,
			uri: context.sourceUri.toString(true),
			parserIds: matched.map(item => item.parser.id),
		});
	}
	return matched[0];
}
