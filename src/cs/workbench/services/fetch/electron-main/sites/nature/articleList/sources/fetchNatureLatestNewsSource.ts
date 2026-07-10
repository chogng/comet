/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateString } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { matchesNatureAuthority, natureNextLinkPaginationPolicy } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/fetchNatureArticleListSourceShared';
import type { FetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/sites/types';

const natureRssUri = URI.parse('https://www.nature.com/nature.rss');

function parseRssPublishedDates(xml: string): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	const itemPattern = /<item\s+rdf:about="([^"]+)"[\s\S]*?<dc:date>([^<]+)<\/dc:date>/gi;
	for (const match of xml.matchAll(itemPattern)) {
		if (match[1] && match[2]) {
			const publishedAt = parseDateString(match[2]);
			if (publishedAt) {
				result.set(new URL(match[1]).toString(), publishedAt);
			}
		}
	}
	return result;
}

export const fetchNatureLatestNewsSource: FetchArticleListSource = {
	id: 'nature.latestNews',
	allowedParserIds: ['nature.editorialFeedList.v1'],
	matchUri(uri) {
		return matchesNatureAuthority(uri) && uri.path.replace(/\/+$/, '') === '/latest-news';
	},
	matchLoadedUri(_requestedUri, finalUri) {
		return matchesNatureAuthority(finalUri) && finalUri.path.replace(/\/+$/, '') === '/latest-news';
	},
	pagination: natureNextLinkPaginationPolicy,
	enrichment: {
		kind: 'rssPublishedDate',
		async enrich(context) {
			if (context.candidates.every(candidate => candidate.publishedAtHint)) {
				return context.candidates;
			}
			const xml = await context.fetchText(natureRssUri, {
				timeoutMs: 12_000,
				stage: 'natureLatestNewsRss',
			});
			const publishedDates = parseRssPublishedDates(xml);
			return context.candidates.map(candidate => ({
				...candidate,
				publishedAtHint: candidate.publishedAtHint ?? publishedDates.get(
					URI.revive(candidate.sourceUri).toString(true),
				),
			}));
		},
	},
};
