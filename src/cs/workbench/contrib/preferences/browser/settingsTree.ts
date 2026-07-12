/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import {
	createSettingsSectionMap,
	type SettingsSectionMap,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import type {
	SettingsPageId,
	SettingsSectionId,
} from 'cs/workbench/contrib/preferences/common/settings';
import { shouldUpdateSettingsSection } from 'cs/workbench/contrib/preferences/browser/settingsSectionUpdates';
import type { SettingsTreeModel } from 'cs/workbench/contrib/preferences/browser/settingsTreeModel';
import {
	buildSettingsButton,
	createSettingsElement,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import type { SettingsViewState } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import type { SettingsController } from 'cs/workbench/contrib/preferences/browser/settingsController';
import { createDefaultKnowledgeBaseSettings } from 'cs/workbench/services/knowledgeBase/config';
import { createDefaultRagSettings } from 'cs/workbench/services/rag/config';

export type SettingsSectionRenderer = (state: SettingsViewState) => HTMLElement;

export type SettingsSectionRenderers = Readonly<Record<SettingsSectionId, SettingsSectionRenderer>>;

type SettingsTreeOptions = {
	readonly contentElement: HTMLElement;
	readonly scrollableElement: DomScrollableElement;
	readonly pageTitleElement: HTMLElement;
	readonly loadingHintElement: HTMLElement;
	readonly noResultsElement: HTMLElement;
	readonly sectionRenderers: SettingsSectionRenderers;
	readonly settingsController: SettingsController;
};

function isKnowledgeBasePageAtDefaults(state: SettingsViewState) {
	const defaultKnowledgeBaseSettings = createDefaultKnowledgeBaseSettings();
	const defaultRagSettings = createDefaultRagSettings();

	return (
		state.knowledgeBaseEnabled === defaultKnowledgeBaseSettings.enabled &&
		state.autoIndexDownloadedPdf === defaultKnowledgeBaseSettings.autoIndexDownloadedPdf &&
		state.knowledgeBasePdfDownloadDir.trim() === '' &&
		state.libraryStorageMode === defaultKnowledgeBaseSettings.libraryStorageMode &&
		state.libraryDirectory.trim() === '' &&
		state.maxConcurrentIndexJobs === defaultKnowledgeBaseSettings.maxConcurrentIndexJobs &&
		state.activeRagProvider === defaultRagSettings.activeProvider &&
		JSON.stringify(state.ragProviders) === JSON.stringify(defaultRagSettings.providers) &&
		state.retrievalCandidateCount === defaultRagSettings.retrievalCandidateCount &&
		state.retrievalTopK === defaultRagSettings.retrievalTopK
	);
}

function renderSettingsPageFooter(
	pageId: SettingsPageId,
	state: SettingsViewState,
	settingsController: SettingsController,
): HTMLElement | null {
	switch (pageId) {
		case 'general': {
			const button = buildSettingsButton({
				label: state.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.general.reset',
				disabled:
					!state.desktopRuntime ||
					state.isSettingsSaving ||
					!state.defaultConfigPath.trim() ||
					state.configPath === state.defaultConfigPath,
				onClick: settingsController.handleResetConfigPath,
			});
			const footer = createSettingsElement('div', 'comet-settings-page-footer');
			footer.append(button);
			return footer;
		}
		case 'textEditor': {
			const button = buildSettingsButton({
				label: state.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.textEditor.reset',
				disabled: state.isSettingsSaving || state.editorDraftStyle.userValue === null,
				onClick: settingsController.handleResetEditorDraftStyle,
			});
			const footer = createSettingsElement('div', 'comet-settings-page-footer');
			footer.append(button);
			return footer;
		}
		case 'knowledgeBase': {
			const button = buildSettingsButton({
				label: state.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.knowledgeBase.reset',
				disabled: state.isSettingsSaving || isKnowledgeBasePageAtDefaults(state),
				onClick: settingsController.handleResetKnowledgeBaseSettings,
			});
			const footer = createSettingsElement('div', 'comet-settings-page-footer');
			footer.append(button);
			return footer;
		}
		default:
			return null;
	}
}

export class SettingsTree {
	private readonly sections: SettingsSectionMap = createSettingsSectionMap(() => createSettingsElement('section', 'comet-settings-section'));

	constructor(
		private readonly model: SettingsTreeModel,
		private readonly options: SettingsTreeOptions,
	) {
		for (const [id, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
			section.dataset.sectionId = id;
			section.id = `settings-section-${id}`;
		}
	}

	updateSections(
		state: SettingsViewState,
		previousState: SettingsViewState | undefined,
		forceAll = false,
	) {
		for (const sectionId of Object.keys(this.sections) as SettingsSectionId[]) {
			if (forceAll || shouldUpdateSettingsSection(sectionId, previousState, state)) {
				this.updateSection(sectionId, state);
			}
		}
	}

	updateSection(
		sectionId: SettingsSectionId,
		state: SettingsViewState,
	) {
		this.sections[sectionId].replaceChildren(this.options.sectionRenderers[sectionId](state));
	}

	dispose() {
		for (const section of Object.values(this.sections)) {
			section.replaceChildren();
		}
	}

	renderPage(
		pageId: SettingsPageId,
		state: SettingsViewState,
	) {
		const activeSectionIds = this.model.getActiveSectionIds(pageId);
		this.options.pageTitleElement.textContent = this.model.getPageTitle(pageId);
		const pageFooter = renderSettingsPageFooter(pageId, state, this.options.settingsController);
		const contentChildren: Node[] = [
			this.options.pageTitleElement,
			...activeSectionIds.map(sectionId => this.sections[sectionId]),
		];

		if (this.model.searchActive && activeSectionIds.length === 0) {
			contentChildren.push(this.options.noResultsElement);
		}

		if (pageFooter && !this.model.searchActive) {
			contentChildren.push(pageFooter);
		}

		if (state.isSettingsLoading) {
			contentChildren.splice(1, 0, this.options.loadingHintElement);
		}

		this.options.contentElement.replaceChildren(...contentChildren);
		this.options.scrollableElement.scanDomNode();
		for (const [sectionId, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
			section.classList.toggle('active', activeSectionIds.includes(sectionId));
		}
	}
}
