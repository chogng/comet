import {
  getSettingsPageSectionIds,
  getSettingsPageTitle,
  type SettingsPageId,
  type SettingsSectionId,
} from 'cs/workbench/contrib/preferences/browser/settingsLayout';
import { createDefaultKnowledgeBaseSettings } from 'cs/workbench/services/knowledgeBase/config';
import { createDefaultRagSettings } from 'cs/workbench/services/rag/config';
import {
  buildSettingsButton,
  createSettingsElement,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import type { SettingsPartProps } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

export type RenderSettingsPageParams = {
  pageId: SettingsPageId;
  props: SettingsPartProps;
  pageTitleElement: HTMLElement;
  loadingHintElement: HTMLElement;
  sections: Record<SettingsSectionId, HTMLElement>;
};

export type RenderedSettingsPage = {
  contentChildren: Node[];
  activeSectionIds: SettingsSectionId[];
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

// Keep page composition lightweight: the editor container owns focus and
// update orchestration, while this module owns page-to-sections assembly.
export function renderSettingsPage({
  pageId,
  props,
  pageTitleElement,
  loadingHintElement,
  sections,
}: RenderSettingsPageParams): RenderedSettingsPage {
  const activeSectionIds = getSettingsPageSectionIds(pageId);
  pageTitleElement.textContent = getSettingsPageTitle(pageId, props.labels);
  const pageFooter = renderSettingsPageFooter(pageId, props);

  const contentChildren: Node[] = [
    pageTitleElement,
    ...activeSectionIds.map((sectionId) => sections[sectionId]),
  ];

  if (pageFooter) {
    contentChildren.push(pageFooter);
  }

  if (props.isSettingsLoading) {
    contentChildren.splice(1, 0, loadingHintElement);
  }

  return {
    contentChildren,
    activeSectionIds,
  };
}
