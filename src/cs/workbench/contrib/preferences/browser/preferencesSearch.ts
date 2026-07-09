/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	settingsPageLayout,
	settingsSectionLayout,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import {
	ID_SETTING_TAG,
	type SettingsPageId,
	type SettingsSearchId,
	type SettingsSectionId,
} from 'cs/workbench/contrib/preferences/common/settings';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

type PreferencesSearchItem = {
	readonly labels: readonly string[];
	readonly ids: readonly SettingsSearchId[];
};

export type PreferencesSearchIndexEntry = {
	readonly pageId: SettingsPageId;
	readonly sectionId: SettingsSectionId;
	readonly ids: readonly string[];
	readonly searchText: string;
};

export type PreferencesSearchIndex = readonly PreferencesSearchIndexEntry[];

export type PreferencesSearchResult = {
	readonly query: string;
	readonly normalizedQuery: string;
	readonly active: boolean;
	readonly matchingPageIds: readonly SettingsPageId[];
	readonly matchingSectionIdsByPage: Readonly<Record<SettingsPageId, readonly SettingsSectionId[]>>;
};

type ParsedPreferencesSearchQuery = {
	readonly normalizedQuery: string;
	readonly idFilters: readonly string[];
};

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const settingsIdFilterRegex = new RegExp(
	`(^|\\s)@${escapeRegExp(ID_SETTING_TAG)}("([^"]*)"|[^"]\\S*)?`,
	'g',
);

function normalizePreferencesSearchQuery(value: string) {
	return value
		.replace(/[":]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLocaleLowerCase();
}

function normalizePreferencesSearchId(value: string) {
	return value.trim().toLocaleLowerCase();
}

function parsePreferencesSearchQuery(value: string): ParsedPreferencesSearchQuery {
	const idFilters: string[] = [];
	const query = value.replace(settingsIdFilterRegex, (_match, _leading, rawFilter, quotedFilter) => {
		const filter = quotedFilter || rawFilter;
		if (filter) {
			idFilters.push(...filter
				.split(',')
				.map(normalizePreferencesSearchId)
				.filter(Boolean));
		}
		return '';
	});

	return {
		normalizedQuery: normalizePreferencesSearchQuery(query),
		idFilters,
	};
}

function createPreferencesSearchText(item: PreferencesSearchItem) {
	return normalizePreferencesSearchQuery([
		...item.labels,
		...item.ids,
	].join(' '));
}

function matchesPreferencesSearchQuery(
	searchText: string,
	normalizedQuery: string,
) {
	if (normalizedQuery.length === 0) {
		return true;
	}

	return normalizedQuery
		.split(' ')
		.every((token) => searchText.includes(token));
}

function matchesPreferencesSearchId(
	ids: readonly string[],
	filter: string,
) {
	if (filter.endsWith('*')) {
		const prefix = filter.slice(0, -1);
		return ids.some(id => id.startsWith(prefix));
	}

	return ids.includes(filter);
}

function matchesPreferencesSearchIds(
	ids: readonly string[],
	filters: readonly string[],
) {
	return filters.length === 0 || filters.some(filter => matchesPreferencesSearchId(ids, filter));
}

function createEmptySectionIdsByPage() {
	return Object.fromEntries(
		settingsPageLayout.map((page) => [page.id, [] as SettingsSectionId[]]),
	) as Record<SettingsPageId, SettingsSectionId[]>;
}

export function createPreferencesSearchIndex(labels: SettingsPartLabels): PreferencesSearchIndex {
	const entries: PreferencesSearchIndexEntry[] = [];

	for (const page of settingsPageLayout) {
		const pageLabel = page.label(labels);
		for (const sectionId of page.sections) {
			const sectionDefinition = settingsSectionLayout[sectionId];
			const ids = [
				page.id,
				sectionId,
				...sectionDefinition.settingIds,
			];
			entries.push({
				pageId: page.id,
				sectionId,
				ids: ids.map(normalizePreferencesSearchId),
				searchText: createPreferencesSearchText({
					ids,
					labels: [
						pageLabel,
						...sectionDefinition.searchLabels(labels),
					],
				}),
			});
		}
	}

	return entries;
}

export function searchPreferences(
	index: PreferencesSearchIndex,
	query: string,
): PreferencesSearchResult {
	const parsedQuery = parsePreferencesSearchQuery(query);
	const matchingSectionIdsByPage = createEmptySectionIdsByPage();

	for (const entry of index) {
		if (
			matchesPreferencesSearchIds(entry.ids, parsedQuery.idFilters) &&
			matchesPreferencesSearchQuery(entry.searchText, parsedQuery.normalizedQuery)
		) {
			matchingSectionIdsByPage[entry.pageId].push(entry.sectionId);
		}
	}

	return {
		query,
		normalizedQuery: parsedQuery.normalizedQuery,
		active: parsedQuery.normalizedQuery.length > 0 || parsedQuery.idFilters.length > 0,
		matchingPageIds: settingsPageLayout
			.map((page) => page.id)
			.filter((pageId) => matchingSectionIdsByPage[pageId].length > 0),
		matchingSectionIdsByPage,
	};
}
