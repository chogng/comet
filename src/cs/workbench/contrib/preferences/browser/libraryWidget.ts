import type {
  LibraryDocumentSummary,
  LibraryStorageMode,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import {
  NumberStepper,
  numberStepperDecrementAriaLabel,
  numberStepperIncrementAriaLabel,
} from 'cs/base/browser/ui/numberStepper/numberStepper';
import type { LocaleMessages } from 'language/locales';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsButton as buildButton,
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  buildSettingsSwitch as buildSwitch,
  createSettingsElement as el,
  setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
	maxKnowledgeBaseConcurrentIndexJobs,
	minKnowledgeBaseConcurrentIndexJobs,
} from 'cs/workbench/services/knowledgeBase/config';

function resolveLibraryDocumentStatusLabel(labels: LocaleMessages, document: LibraryDocumentSummary) {
  if (document.latestJobStatus === 'failed' || document.ingestStatus === 'failed') { return labels.settingsLibraryDocumentFailed; }
  if (document.latestJobStatus === 'running' || document.ingestStatus === 'indexing') { return labels.settingsLibraryDocumentRunning; }
  if (document.latestJobStatus === 'queued' || document.ingestStatus === 'queued') { return labels.settingsLibraryDocumentQueued; }
  return labels.settingsLibraryDocumentRegistered;
}

export type LibrarySettingsSectionProps = {
  labels: LocaleMessages;
  contextViewProvider: IContextViewProvider;
  knowledgeBaseEnabled: boolean;
  autoIndexDownloadedPdf: boolean;
  knowledgeBasePdfDownloadDir: string;
  libraryStorageMode: LibraryStorageMode;
  libraryDirectory: string;
  defaultManagedDirectory: string;
  maxConcurrentIndexJobs: number;
  desktopRuntime: boolean;
  isSettingsSaving: boolean;
  isLibraryLoading: boolean;
  libraryDocumentCount: number;
  libraryFileCount: number;
  libraryQueuedJobCount: number;
  libraryDocuments: readonly LibraryDocumentSummary[];
  libraryDbFile: string;
  ragCacheDir: string;
  onKnowledgeBaseEnabledChange: (checked: boolean) => void;
  onAutoIndexDownloadedPdfChange: (checked: boolean) => void;
  onKnowledgeBasePdfDownloadDirChange: (value: string) => void;
  onChooseKnowledgeBasePdfDownloadDir: () => void;
  onLibraryStorageModeChange: (value: LibraryStorageMode) => void;
  onLibraryDirectoryChange: (value: string) => void;
  onChooseLibraryDirectory: () => void;
  onMaxConcurrentIndexJobsChange: (value: string) => void;
};

function renderLibraryReadOnlyField(label: string, value: string, focusKey: string) {
  return createSettingsRow({
    title: label,
    control: buildInput({
      value,
      className: 'comet-settings-input-control',
      focusKey,
      readOnly: true,
    }).element,
    itemClassName: 'comet-settings-library-readonly-item',
    controlClassName: 'comet-settings-library-readonly-control',
  });
}

function renderLibraryDownloadDirectoryField(props: LibrarySettingsSectionProps) {
  const effectiveDownloadDir =
    props.knowledgeBasePdfDownloadDir.trim() || props.labels.systemDownloads;
  return createSettingsRow({
    title: props.labels.settingsKnowledgeBasePdfDownloadDir,
    description: `${props.labels.settingsKnowledgeBasePdfDownloadDirHint} ${props.labels.currentDir} ${effectiveDownloadDir}`,
    control: buildButton({
      label: props.labels.change,
      focusKey: 'settings.library.openDownloadDirectory',
      title: props.labels.chooseDirectory,
      disabled: !props.desktopRuntime || props.isSettingsSaving,
      onClick: props.onChooseKnowledgeBasePdfDownloadDir,
    }),
    itemClassName: 'comet-settings-library-download-directory-item',
    controlClassName: 'comet-settings-library-directory-control',
  });
}

function renderLibraryMaxConcurrentJobsField(props: LibrarySettingsSectionProps) {
  const jobsWrap = el('div', 'comet-settings-limit-input-wrap');
  const maxConcurrentJobsInput = new NumberStepper({
    value: props.maxConcurrentIndexJobs,
    className: 'comet-settings-number-stepper comet-settings-limit-input',
	min: String(minKnowledgeBaseConcurrentIndexJobs),
	max: String(maxKnowledgeBaseConcurrentIndexJobs),
    inputMode: 'numeric',
    step: '1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onMaxConcurrentIndexJobsChange,
    disabled: props.isSettingsSaving,
  });
  setSettingsFocusKey(maxConcurrentJobsInput.inputElement, 'settings.library.maxJobs');
  jobsWrap.append(maxConcurrentJobsInput.element);
  return createSettingsRow({
    title: props.labels.settingsLibraryMaxConcurrentJobs,
    description: props.labels.settingsLibraryMaxConcurrentJobsHint,
    control: jobsWrap,
    itemClassName: 'comet-settings-library-max-jobs-item',
    controlClassName: 'comet-settings-library-max-jobs-control',
  });
}

function renderLibraryStats(props: LibrarySettingsSectionProps) {
  const stats = el('div', 'comet-settings-library-stats');
  const addCard = (label: string, value: number) => {
    const card = el('div', 'comet-settings-library-stat-card');
    const cardLabel = el('span', 'comet-settings-library-stat-label');
    cardLabel.textContent = label;
    const strong = el('strong');
    strong.textContent = String(value);
    card.append(cardLabel, strong);
    stats.append(card);
  };
  addCard(props.labels.settingsLibraryStatusDocuments, props.libraryDocumentCount);
  addCard(props.labels.settingsLibraryStatusFiles, props.libraryFileCount);
  addCard(props.labels.settingsLibraryStatusQueuedJobs, props.libraryQueuedJobCount);
  return createSettingsRow({
    title: '',
    control: stats,
    itemClassName: 'comet-settings-library-stats-item',
    titleClassName: 'comet-settings-block-list-item-title-empty',
    contentClassName: 'comet-settings-library-stats-content',
    controlClassName: 'comet-settings-library-stats-control',
  });
}

function renderLibraryRecentDocuments(props: LibrarySettingsSectionProps) {
  const content = el('div', 'comet-settings-library-recent-documents-content');
  if (props.isLibraryLoading) {
    content.append(buildHint(props.labels.settingsLoading));
  }
  if (props.libraryDocuments.length === 0) {
    content.append(buildHint(props.labels.settingsLibraryStatusEmpty));
    return createSettingsRow({
      title: props.labels.settingsLibraryRecentDocuments,
      control: content,
      itemClassName: 'comet-settings-library-recent-documents-item',
      controlClassName: 'comet-settings-library-recent-documents-control',
    });
  }
  const list = el('div', 'comet-settings-library-doc-list');
  for (const document of props.libraryDocuments) {
    const item = el('div', 'comet-settings-library-doc-item');
    const strong = el('strong', 'comet-settings-library-doc-title');
    strong.textContent = document.title || '-';
    const meta = el('span', 'comet-settings-library-doc-meta');
    meta.textContent = [document.journalTitle, document.publishedAt].filter(Boolean).join(' | ');
    const status = el('span', 'comet-settings-library-doc-status');
    status.textContent = resolveLibraryDocumentStatusLabel(props.labels, document);
    item.append(strong, meta, status);
    list.append(item);
  }
  content.append(list);
  return createSettingsRow({
    title: props.labels.settingsLibraryRecentDocuments,
    control: content,
    itemClassName: 'comet-settings-library-recent-documents-item',
    controlClassName: 'comet-settings-library-recent-documents-control',
  });
}

function renderLibraryStorageSection(props: LibrarySettingsSectionProps, effectiveManagedDirectory: string) {
  const usesManagedCopy = props.libraryStorageMode === 'managed-copy';
  const libraryDirectoryDescription = usesManagedCopy
    ? `${props.labels.settingsLibraryDirectoryHint} ${props.labels.currentDir} ${effectiveManagedDirectory || '-'}`
    : `${props.labels.settingsLibraryDirectoryInactiveHint} ${effectiveManagedDirectory || '-'}`;
  const section = createSettingsSection({
    title: props.labels.settingsLibraryTitle,
    titleClassName: 'comet-settings-section-title',
    sectionClassName: 'comet-settings-library-section comet-settings-library-storage-section',
    panelClassName: 'comet-settings-library-storage-panel',
    listClassName: 'comet-settings-library-storage-list',
  });
  section.list.append(
    createSettingsRow({
      title: props.labels.settingsLibraryStorageMode,
      control: buildSelect([
        { value: 'linked-original', label: props.labels.settingsLibraryStorageModeLinkedOriginal },
        { value: 'managed-copy', label: props.labels.settingsLibraryStorageModeManagedCopy },
      ], props.libraryStorageMode, 'settings.library.storage', value => props.onLibraryStorageModeChange(value as LibraryStorageMode), props.contextViewProvider, 'comet-settings-llm-provider'),
    }),
  );

  section.list.append(
    createSettingsRow({
      title: props.labels.settingsLibraryDirectory,
      description: libraryDirectoryDescription,
      control: buildButton({
        label: props.labels.change,
        focusKey: 'settings.library.openDirectory',
        title: props.labels.chooseDirectory,
        disabled: !props.desktopRuntime || props.isSettingsSaving || !usesManagedCopy,
        onClick: props.onChooseLibraryDirectory,
      }),
      itemClassName: 'comet-settings-library-directory-item',
      controlClassName: 'comet-settings-library-directory-control',
    }),
    renderLibraryReadOnlyField(props.labels.settingsLibraryDbFile, props.libraryDbFile, 'settings.library.db'),
    renderLibraryReadOnlyField(props.labels.settingsLibraryFilesDir, effectiveManagedDirectory, 'settings.library.filesDir'),
    renderLibraryReadOnlyField(props.labels.settingsLibraryCacheDir, props.ragCacheDir, 'settings.library.cacheDir'),
  );
  return section.element;
}

function renderLibraryIndexingSection(props: LibrarySettingsSectionProps) {
  const section = createSettingsSection({
    title: props.labels.settingsNavigationKnowledgeBase,
    titleClassName: 'comet-settings-section-title',
    sectionClassName: 'comet-settings-library-section comet-settings-library-indexing-section',
    panelClassName: 'comet-settings-library-indexing-panel',
    listClassName: 'comet-settings-library-indexing-list',
  });
  section.list.append(
    createSettingsRow({
      title: props.labels.settingsKnowledgeBaseMode,
      description: props.labels.settingsKnowledgeBaseModeHint,
      control: buildSwitch({
        checked: props.knowledgeBaseEnabled,
        focusKey: 'settings.library.enabled',
        disabled: props.isSettingsSaving,
        title: props.labels.settingsKnowledgeBaseMode,
        onChange: props.onKnowledgeBaseEnabledChange,
      }),
    }),
    createSettingsRow({
      title: props.labels.settingsKnowledgeBaseAutoIndex,
      description: props.labels.settingsKnowledgeBaseAutoIndexHint,
      control: buildSwitch({
        checked: props.autoIndexDownloadedPdf,
        focusKey: 'settings.library.autoIndex',
        disabled: props.isSettingsSaving || !props.knowledgeBaseEnabled,
        title: props.labels.settingsKnowledgeBaseAutoIndex,
        onChange: props.onAutoIndexDownloadedPdfChange,
      }),
    }),
  );
  if (!props.knowledgeBaseEnabled) {
    section.element.append(buildHint(props.labels.settingsKnowledgeBaseModeDisabledHint, 'comet-settings-hint comet-settings-library-mode-note'));
  }
  section.list.append(
    renderLibraryDownloadDirectoryField(props),
    renderLibraryMaxConcurrentJobsField(props),
    renderLibraryStats(props),
    renderLibraryRecentDocuments(props),
  );
  return section.element;
}

export function renderLibrarySettingsSection(props: LibrarySettingsSectionProps) {
  const field = el('div', 'comet-settings-field comet-settings-library-sections');
  const effectiveManagedDirectory = props.libraryDirectory.trim() || props.defaultManagedDirectory;

  field.append(
    renderLibraryStorageSection(props, effectiveManagedDirectory),
    renderLibraryIndexingSection(props),
  );
  return field;
}
