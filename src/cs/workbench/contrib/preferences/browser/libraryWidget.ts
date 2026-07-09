import type {
  LibraryDocumentSummary,
  LibraryStorageMode,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  NumberStepper,
  numberStepperDecrementAriaLabel,
  numberStepperIncrementAriaLabel,
} from 'cs/base/browser/ui/numberStepper/numberStepper';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
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

function resolveLibraryDocumentStatusLabel(labels: SettingsPartLabels, document: LibraryDocumentSummary) {
  if (document.latestJobStatus === 'failed' || document.ingestStatus === 'failed') { return labels.settingsLibraryDocumentFailed; }
  if (document.latestJobStatus === 'running' || document.ingestStatus === 'indexing') { return labels.settingsLibraryDocumentRunning; }
  if (document.latestJobStatus === 'queued' || document.ingestStatus === 'queued') { return labels.settingsLibraryDocumentQueued; }
  return labels.settingsLibraryDocumentRegistered;
}

export type LibrarySettingsSectionProps = {
  labels: SettingsPartLabels;
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
  libraryDocuments: LibraryDocumentSummary[];
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

export class LibrarySettingsSection {
  private props: LibrarySettingsSectionProps;
  private readonly element = el('div', 'comet-settings-field');

  constructor(props: LibrarySettingsSectionProps) {
    this.props = props;
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: LibrarySettingsSectionProps) {
    this.props = props;
    this.element.replaceChildren(this.render());
  }

  private render() {
    const field = el('div', 'comet-settings-field comet-settings-library-sections');
    const effectiveManagedDirectory = this.props.libraryDirectory.trim() || this.props.defaultManagedDirectory;

    field.append(
      this.renderStorageSection(effectiveManagedDirectory),
      this.renderIndexingSection(),
    );
    return field;
  }

  private renderStorageSection(effectiveManagedDirectory: string) {
    const usesManagedCopy = this.props.libraryStorageMode === 'managed-copy';
    const libraryDirectoryDescription = usesManagedCopy
      ? `${this.props.labels.settingsLibraryDirectoryHint} ${this.props.labels.currentDir} ${effectiveManagedDirectory || '-'}`
      : `${this.props.labels.settingsLibraryDirectoryInactiveHint} ${effectiveManagedDirectory || '-'}`;
    const section = createSettingsSection({
      title: this.props.labels.settingsLibraryTitle,
      titleClassName: 'comet-settings-section-title',
      sectionClassName: 'comet-settings-library-section comet-settings-library-storage-section',
      panelClassName: 'comet-settings-library-storage-panel',
      listClassName: 'comet-settings-library-storage-list',
    });
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsLibraryStorageMode,
        control: buildSelect([
          { value: 'linked-original', label: this.props.labels.settingsLibraryStorageModeLinkedOriginal },
          { value: 'managed-copy', label: this.props.labels.settingsLibraryStorageModeManagedCopy },
        ], this.props.libraryStorageMode, 'settings.library.storage', (value) => this.props.onLibraryStorageModeChange(value as LibraryStorageMode), 'comet-settings-llm-provider'),
      }),
    );

    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsLibraryDirectory,
        description: libraryDirectoryDescription,
        control: buildButton({
          label: this.props.labels.change,
          focusKey: 'settings.library.openDirectory',
          title: this.props.labels.chooseDirectory,
          disabled: !this.props.desktopRuntime || this.props.isSettingsSaving || !usesManagedCopy,
          onClick: this.props.onChooseLibraryDirectory,
        }),
        itemClassName: 'comet-settings-library-directory-item',
        controlClassName: 'comet-settings-library-directory-control',
      }),
      this.renderReadOnlyField(this.props.labels.settingsLibraryDbFile, this.props.libraryDbFile, 'settings.library.db'),
      this.renderReadOnlyField(this.props.labels.settingsLibraryFilesDir, effectiveManagedDirectory, 'settings.library.filesDir'),
      this.renderReadOnlyField(this.props.labels.settingsLibraryCacheDir, this.props.ragCacheDir, 'settings.library.cacheDir'),
    );
    return section.element;
  }

  private renderIndexingSection() {
    const section = createSettingsSection({
      title: this.props.labels.settingsNavigationKnowledgeBase,
      titleClassName: 'comet-settings-section-title',
      sectionClassName: 'comet-settings-library-section comet-settings-library-indexing-section',
      panelClassName: 'comet-settings-library-indexing-panel',
      listClassName: 'comet-settings-library-indexing-list',
    });
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsKnowledgeBaseMode,
        description: this.props.labels.settingsKnowledgeBaseModeHint,
        control: buildSwitch({
          checked: this.props.knowledgeBaseEnabled,
          focusKey: 'settings.library.enabled',
          disabled: this.props.isSettingsSaving,
          title: this.props.labels.settingsKnowledgeBaseMode,
          onChange: this.props.onKnowledgeBaseEnabledChange,
        }),
      }),
      createSettingsRow({
        title: this.props.labels.settingsKnowledgeBaseAutoIndex,
        description: this.props.labels.settingsKnowledgeBaseAutoIndexHint,
        control: buildSwitch({
          checked: this.props.autoIndexDownloadedPdf,
          focusKey: 'settings.library.autoIndex',
          disabled: this.props.isSettingsSaving || !this.props.knowledgeBaseEnabled,
          title: this.props.labels.settingsKnowledgeBaseAutoIndex,
          onChange: this.props.onAutoIndexDownloadedPdfChange,
        }),
      }),
    );
    if (!this.props.knowledgeBaseEnabled) {
      section.element.append(buildHint(this.props.labels.settingsKnowledgeBaseModeDisabledHint, 'comet-settings-hint comet-settings-library-mode-note'));
    }
    section.list.append(
      this.renderDownloadDirectoryField(),
      this.renderMaxConcurrentJobsField(),
      this.renderLibraryStats(),
      this.renderLibraryRecentDocuments(),
    );
    return section.element;
  }

  private renderDownloadDirectoryField() {
    const effectiveDownloadDir =
      this.props.knowledgeBasePdfDownloadDir.trim() || this.props.labels.systemDownloads;
    return createSettingsRow({
      title: this.props.labels.settingsKnowledgeBasePdfDownloadDir,
      description: `${this.props.labels.settingsKnowledgeBasePdfDownloadDirHint} ${this.props.labels.currentDir} ${effectiveDownloadDir}`,
      control: buildButton({
        label: this.props.labels.change,
        focusKey: 'settings.library.openDownloadDirectory',
        title: this.props.labels.chooseDirectory,
        disabled: !this.props.desktopRuntime || this.props.isSettingsSaving,
        onClick: this.props.onChooseKnowledgeBasePdfDownloadDir,
      }),
      itemClassName: 'comet-settings-library-download-directory-item',
      controlClassName: 'comet-settings-library-directory-control',
    });
  }

  private renderMaxConcurrentJobsField() {
    const jobsWrap = el('div', 'comet-settings-limit-input-wrap');
    const maxConcurrentJobsInput = new NumberStepper({
      value: this.props.maxConcurrentIndexJobs,
      className: 'comet-settings-limit-input',
      min: '1',
      max: '4',
      inputMode: 'numeric',
      step: '1',
      decrementAriaLabel: numberStepperDecrementAriaLabel,
      incrementAriaLabel: numberStepperIncrementAriaLabel,
      onDidChange: this.props.onMaxConcurrentIndexJobsChange,
      disabled: this.props.isSettingsSaving,
    });
    setSettingsFocusKey(maxConcurrentJobsInput.inputElement, 'settings.library.maxJobs');
    jobsWrap.append(maxConcurrentJobsInput.element);
    return createSettingsRow({
      title: this.props.labels.settingsLibraryMaxConcurrentJobs,
      description: this.props.labels.settingsLibraryMaxConcurrentJobsHint,
      control: jobsWrap,
      itemClassName: 'comet-settings-library-max-jobs-item',
      controlClassName: 'comet-settings-library-max-jobs-control',
    });
  }

  private renderLibraryStats() {
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
    addCard(this.props.labels.settingsLibraryStatusDocuments, this.props.libraryDocumentCount);
    addCard(this.props.labels.settingsLibraryStatusFiles, this.props.libraryFileCount);
    addCard(this.props.labels.settingsLibraryStatusQueuedJobs, this.props.libraryQueuedJobCount);
    return createSettingsRow({
      title: '',
      control: stats,
      itemClassName: 'comet-settings-library-stats-item',
      titleClassName: 'comet-settings-block-list-item-title-empty',
      contentClassName: 'comet-settings-library-stats-content',
      controlClassName: 'comet-settings-library-stats-control',
    });
  }

  private renderLibraryRecentDocuments() {
    const content = el('div', 'comet-settings-library-recent-documents-content');
    if (this.props.isLibraryLoading) {
      content.append(buildHint(this.props.labels.settingsLoading));
    }
    if (this.props.libraryDocuments.length === 0) {
      content.append(buildHint(this.props.labels.settingsLibraryStatusEmpty));
      return createSettingsRow({
        title: this.props.labels.settingsLibraryRecentDocuments,
        control: content,
        itemClassName: 'comet-settings-library-recent-documents-item',
        controlClassName: 'comet-settings-library-recent-documents-control',
      });
    }
    const list = el('div', 'comet-settings-library-doc-list');
    for (const document of this.props.libraryDocuments) {
      const item = el('div', 'comet-settings-library-doc-item');
      const strong = el('strong', 'comet-settings-library-doc-title');
      strong.textContent = document.title || '-';
      const meta = el('span', 'comet-settings-library-doc-meta');
      meta.textContent = [document.journalTitle, document.publishedAt].filter(Boolean).join(' | ');
      const status = el('span', 'comet-settings-library-doc-status');
      status.textContent = resolveLibraryDocumentStatusLabel(this.props.labels, document);
      item.append(strong, meta, status);
      list.append(item);
    }
    content.append(list);
    return createSettingsRow({
      title: this.props.labels.settingsLibraryRecentDocuments,
      control: content,
      itemClassName: 'comet-settings-library-recent-documents-item',
      controlClassName: 'comet-settings-library-recent-documents-control',
    });
  }

  private renderReadOnlyField(label: string, value: string, focusKey: string) {
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
}
