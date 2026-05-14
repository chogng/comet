import {
  getSettingsPageSectionIds,
  getSettingsPageTitle,
  type SettingsPageId,
  type SettingsSectionId,
} from 'ls/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPartProps } from 'ls/workbench/contrib/preferences/browser/settingsTypes';

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

  const contentChildren: Node[] = [
    pageTitleElement,
    ...activeSectionIds.map((sectionId) => sections[sectionId]),
  ];

  if (props.isSettingsLoading) {
    contentChildren.splice(1, 0, loadingHintElement);
  }

  return {
    contentChildren,
    activeSectionIds,
  };
}
