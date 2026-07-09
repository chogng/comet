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
import type { SettingsPartProps } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import { createDefaultKnowledgeBaseSettings } from 'cs/workbench/services/knowledgeBase/config';
import { createDefaultRagSettings } from 'cs/workbench/services/rag/config';

export type SettingsSectionRenderer = (props: SettingsPartProps) => HTMLElement;

export type SettingsSectionRenderers = Readonly<Record<SettingsSectionId, SettingsSectionRenderer>>;

type SettingsTreeOptions = {
	readonly contentElement: HTMLElement;
	readonly scrollableElement: DomScrollableElement;
	readonly pageTitleElement: HTMLElement;
	readonly loadingHintElement: HTMLElement;
	readonly noResultsElement: HTMLElement;
	readonly sectionRenderers: SettingsSectionRenderers;
};

function isKnowledgeBasePageAtDefaults(props: SettingsPartProps) {
	const defaultKnowledgeBaseSettings = createDefaultKnowledgeBaseSettings();
	const defaultRagSettings = createDefaultRagSettings();

	return (
		props.knowledgeBaseEnabled === defaultKnowledgeBaseSettings.enabled &&
		props.autoIndexDownloadedPdf === defaultKnowledgeBaseSettings.autoIndexDownloadedPdf &&
		props.knowledgeBasePdfDownloadDir.trim() === '' &&
		props.libraryStorageMode === defaultKnowledgeBaseSettings.libraryStorageMode &&
		props.libraryDirectory.trim() === '' &&
		props.maxConcurrentIndexJobs === defaultKnowledgeBaseSettings.maxConcurrentIndexJobs &&
		props.activeRagProvider === defaultRagSettings.activeProvider &&
		JSON.stringify(props.ragProviders) === JSON.stringify(defaultRagSettings.providers) &&
		props.retrievalCandidateCount === defaultRagSettings.retrievalCandidateCount &&
		props.retrievalTopK === defaultRagSettings.retrievalTopK
	);
}

function renderSettingsPageFooter(
	pageId: SettingsPageId,
	props: SettingsPartProps,
): HTMLElement | null {
	switch (pageId) {
		case 'general': {
			const button = buildSettingsButton({
				label: props.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.general.reset',
				disabled:
					!props.desktopRuntime ||
					props.isSettingsSaving ||
					!props.defaultConfigPath.trim() ||
					props.configPath === props.defaultConfigPath,
				onClick: props.onResetConfigPath,
			});
			const footer = createSettingsElement('div', 'comet-settings-page-footer');
			footer.append(button);
			return footer;
		}
		case 'textEditor': {
			const button = buildSettingsButton({
				label: props.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.textEditor.reset',
				disabled: props.isSettingsSaving || props.editorDraftStyle.userValue === null,
				onClick: props.onResetEditorDraftStyle,
			});
			const footer = createSettingsElement('div', 'comet-settings-page-footer');
			footer.append(button);
			return footer;
		}
		case 'knowledgeBase': {
			const button = buildSettingsButton({
				label: props.labels.resetDefault,
				className: 'comet-settings-page-footer-button',
				focusKey: 'settings.page.knowledgeBase.reset',
				disabled: props.isSettingsSaving || isKnowledgeBasePageAtDefaults(props),
				onClick: props.onResetKnowledgeBaseSettings,
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
		props: SettingsPartProps,
		previousProps: SettingsPartProps | undefined,
		forceAll = false,
	) {
		for (const sectionId of Object.keys(this.sections) as SettingsSectionId[]) {
			if (forceAll || shouldUpdateSettingsSection(sectionId, previousProps, props)) {
				this.updateSection(sectionId, props);
			}
		}
	}

	updateSection(
		sectionId: SettingsSectionId,
		props: SettingsPartProps,
	) {
		this.sections[sectionId].replaceChildren(this.options.sectionRenderers[sectionId](props));
	}

	dispose() {
		for (const section of Object.values(this.sections)) {
			section.replaceChildren();
		}
	}

	renderPage(
		pageId: SettingsPageId,
		props: SettingsPartProps,
	) {
		const activeSectionIds = this.model.getActiveSectionIds(pageId);
		this.options.pageTitleElement.textContent = this.model.getPageTitle(pageId);
		const pageFooter = renderSettingsPageFooter(pageId, props);
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

		if (props.isSettingsLoading) {
			contentChildren.splice(1, 0, this.options.loadingHintElement);
		}

		this.options.contentElement.replaceChildren(...contentChildren);
		this.options.scrollableElement.scanDomNode();
		for (const [sectionId, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
			section.classList.toggle('active', activeSectionIds.includes(sectionId));
		}
	}
}
