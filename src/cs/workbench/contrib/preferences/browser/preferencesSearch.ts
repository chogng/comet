/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	settingsPageLayout,
	settingsSectionLayout,
	type SettingsPageId,
	type SettingsSectionId,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

type PreferencesSearchItem = {
	readonly labels: readonly string[];
};

export type PreferencesSearchIndexEntry = {
	readonly pageId: SettingsPageId;
	readonly sectionId: SettingsSectionId;
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

function normalizePreferencesSearchQuery(value: string) {
	return value
		.replace(/[":]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLocaleLowerCase();
}

function createPreferencesSearchText(item: PreferencesSearchItem) {
	return normalizePreferencesSearchQuery(item.labels.join(' '));
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
			entries.push({
				pageId: page.id,
				sectionId,
				searchText: createPreferencesSearchText({
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
	const normalizedQuery = normalizePreferencesSearchQuery(query);
	const matchingSectionIdsByPage = createEmptySectionIdsByPage();

	for (const entry of index) {
		if (matchesPreferencesSearchQuery(entry.searchText, normalizedQuery)) {
			matchingSectionIdsByPage[entry.pageId].push(entry.sectionId);
		}
	}

	return {
		query,
		normalizedQuery,
		active: normalizedQuery.length > 0,
		matchingPageIds: settingsPageLayout
			.map((page) => page.id)
			.filter((pageId) => matchingSectionIdsByPage[pageId].length > 0),
		matchingSectionIdsByPage,
	};
}
