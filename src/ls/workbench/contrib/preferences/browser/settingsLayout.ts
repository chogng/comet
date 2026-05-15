import type { LxIconName } from 'ls/base/browser/ui/lxicon/lxicon';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';

export type SettingsSectionId =
  | 'locale'
  | 'layout'
  | 'notifications'
  | 'appearance'
  | 'configPath'
  | 'textEditor'
  | 'llm'
  | 'translation'
  | 'batchOptions'
  | 'supportedSources'
  | 'knowledgeBase'
  | 'downloadDirectory';

export type SettingsPageId =
  | 'general'
  | 'appearance'
  | 'textEditor'
  | 'model'
  | 'knowledgeBase'
  | 'literature';

export type SettingsNavigationItemId = 'back' | SettingsPageId;

type SettingsPageDefinition = {
  id: SettingsPageId;
  label: (labels: SettingsPartLabels) => string;
  icon?: LxIconName;
  sections: SettingsSectionId[];
};

const settingsPageLayout: SettingsPageDefinition[] = [
  {
    id: 'general',
    label: (labels) => labels.settingsNavigationGeneral,
    icon: 'gear',
    sections: ['locale', 'layout', 'notifications', 'configPath'],
  },
  {
    id: 'appearance',
    label: (labels) => labels.settingsNavigationAppearance,
    icon: 'appearance',
    sections: ['appearance'],
  },
  {
    id: 'textEditor',
    label: (labels) => labels.settingsNavigationTextEditor,
    icon: 'write',
    sections: ['textEditor'],
  },
  {
    id: 'model',
    label: (labels) => labels.settingsLlmTitle,
    icon: 'model',
    sections: ['llm'],
  },
  {
    id: 'knowledgeBase',
    label: (labels) => labels.settingsNavigationKnowledgeBase,
    icon: 'database-1',
    sections: ['knowledgeBase'],
  },
  {
    id: 'literature',
    label: (labels) => labels.settingsNavigationLiterature,
    icon: 'book',
    sections: ['batchOptions', 'supportedSources', 'downloadDirectory', 'translation'],
  },
] as const;

export type SettingsSectionMap = Record<SettingsSectionId, HTMLElement>;
export type SettingsNavigationItem = {
  id: SettingsNavigationItemId;
  label: string;
  icon?: LxIconName;
};

// This remains intentionally lightweight: it defines page structure and the
// section membership of each page without introducing tree models.
export function createSettingsSectionMap(factory: () => HTMLElement): SettingsSectionMap {
  const sectionIds = new Set<SettingsSectionId>();
  for (const page of settingsPageLayout) {
    for (const sectionId of page.sections) {
      sectionIds.add(sectionId);
    }
  }
  const entries = Array.from(sectionIds).map((id) => [id, factory()] as const);
  return Object.fromEntries(entries) as SettingsSectionMap;
}

export function getSettingsNavigationItems(labels: SettingsPartLabels): SettingsNavigationItem[] {
  return [
    {
      id: 'back',
      label: labels.settingsNavigationBack.trim(),
      icon: 'arrow-left',
    },
    ...getSettingsPageNavigationItems(labels),
  ];
}

export function getSettingsPageNavigationItems(
  labels: SettingsPartLabels,
): Array<SettingsNavigationItem & { id: SettingsPageId }> {
  return settingsPageLayout.map((page) => ({
    id: page.id,
    label: page.label(labels).trim(),
    icon: page.icon,
  }));
}

export function getSettingsPageSectionIds(pageId: SettingsPageId): SettingsSectionId[] {
  return settingsPageLayout.find((page) => page.id === pageId)?.sections ?? [];
}

export function getSettingsPageTitle(
  pageId: SettingsPageId,
  labels: SettingsPartLabels,
): string {
  const page = settingsPageLayout.find((item) => item.id === pageId);
  return page ? page.label(labels).trim() : '';
}
