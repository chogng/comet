/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createPreferencesSearchIndex,
	searchPreferences,
	type PreferencesSearchResult,
} from 'cs/workbench/contrib/preferences/browser/preferencesSearch';
import {
	settingsPageLayout,
	type SettingsPageId,
	type SettingsSectionId,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

abstract class SettingsTreeElement {
	constructor(readonly id: string) {}
}

class SettingsTreeSectionElement extends SettingsTreeElement {
	constructor(
		readonly sectionId: SettingsSectionId,
		readonly parent: SettingsTreePageElement,
	) {
		super(`settings.section.${sectionId}`);
	}
}

class SettingsTreePageElement extends SettingsTreeElement {
	readonly sectionIds: readonly SettingsSectionId[];
	readonly sections: readonly SettingsTreeSectionElement[];

	constructor(
		readonly pageId: SettingsPageId,
		readonly label: string,
		sectionIds: readonly SettingsSectionId[],
	) {
		super(`settings.page.${pageId}`);
		this.sectionIds = [...sectionIds];
		this.sections = this.sectionIds.map(sectionId => new SettingsTreeSectionElement(sectionId, this));
	}
}

class SearchResultModel {
	constructor(readonly result: PreferencesSearchResult) {}

	get active() {
		return this.result.active;
	}

	includesPage(pageId: SettingsPageId) {
		return this.result.matchingPageIds.includes(pageId);
	}

	getSectionIds(pageId: SettingsPageId) {
		return this.result.matchingSectionIdsByPage[pageId];
	}
}

export class SettingsTreeModel {
	private pages: readonly SettingsTreePageElement[] = [];
	private pageById!: Readonly<Record<SettingsPageId, SettingsTreePageElement>>;
	private searchResultModel!: SearchResultModel;

	constructor(
		labels: SettingsPartLabels,
		query: string,
	) {
		this.update(labels, query);
	}

	get searchActive() {
		return this.searchResultModel.active;
	}

	update(
		labels: SettingsPartLabels,
		query: string,
	) {
		this.pages = settingsPageLayout.map(page => new SettingsTreePageElement(
			page.id,
			page.label(labels).trim(),
			page.sections,
		));
		this.pageById = Object.fromEntries(
			this.pages.map(page => [page.pageId, page]),
		) as Record<SettingsPageId, SettingsTreePageElement>;
		this.searchResultModel = new SearchResultModel(
			searchPreferences(createPreferencesSearchIndex(labels), query),
		);
	}

	getVisiblePageIds() {
		return this.pages
			.filter(page => !this.searchActive || this.searchResultModel.includesPage(page.pageId))
			.map(page => page.pageId);
	}

	hasVisiblePage(pageId: SettingsPageId) {
		return !this.searchActive || this.searchResultModel.includesPage(pageId);
	}

	getFirstVisiblePageId() {
		return this.getVisiblePageIds()[0];
	}

	getPageTitle(pageId: SettingsPageId) {
		return this.pageById[pageId].label;
	}

	getActiveSectionIds(pageId: SettingsPageId) {
		return this.searchActive
			? [...this.searchResultModel.getSectionIds(pageId)]
			: [...this.pageById[pageId].sectionIds];
	}
}
