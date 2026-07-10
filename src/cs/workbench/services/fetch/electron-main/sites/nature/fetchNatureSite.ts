/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchNatureArticleParser } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleDetail/fetchNatureArticleParser';
import { fetchNatureEditorialFeedListParser } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/parsers/fetchNatureEditorialFeedListParser';
import { fetchNatureJournalArchiveListParser } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/parsers/fetchNatureJournalArchiveListParser';
import { fetchNatureLatestNewsSource } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/sources/fetchNatureLatestNewsSource';
import { fetchNatureOpinionSource } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/sources/fetchNatureOpinionSource';
import { fetchNatureResearchArticlesSource } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/sources/fetchNatureResearchArticlesSource';
import { resolveNatureArticleIdentity } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleIdentity';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchNatureSite: FetchSiteProvider = {
	id: 'nature',
	acquisitionPolicy: { settleMs: 350 },
	articleListSources: [
		fetchNatureResearchArticlesSource,
		fetchNatureLatestNewsSource,
		fetchNatureOpinionSource,
	],
	articleListParsers: [
		fetchNatureJournalArchiveListParser,
		fetchNatureEditorialFeedListParser,
	],
	articleDetailParsers: [fetchNatureArticleParser],
	matchUri(uri) {
		const authority = uri.authority.toLowerCase();
		return authority === 'nature.com' || authority.endsWith('.nature.com');
	},
	normalizeArticleAuthority(authority) {
		const value = authority.toLowerCase();
		return value === 'nature.com' || value.endsWith('.nature.com') ? 'nature.com' : value;
	},
	resolveArticleIdentity: resolveNatureArticleIdentity,
	resolveArticleDetailParserIds() {
		return [fetchNatureArticleParser.id];
	},
};
