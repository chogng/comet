import type {
  LibraryDocumentSummary,
  LibraryStorageMode,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import {
  createSettingsSection,
  createSettingsRow,
} from 'ls/workbench/contrib/preferences/browser/section';
import {
  buildSettingsButton as buildButton,
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  buildSettingsSwitch as buildSwitch,
  createSettingsElement as el,
  createSettingsText as text,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import { buildSettingsNumberStepperInput as buildNumberStepperInput } from 'ls/workbench/contrib/preferences/browser/settingsNumberStepperInput';

function resolveLibraryDocumentStatusLabel(labels: SettingsPartLabels, document: LibraryDocumentSummary) {
  if (document.latestJobStatus === 'failed' || document.ingestStatus === 'failed') { return labels.settingsLibraryDocumentFailed; }
  if (document.latestJobStatus === 'running' || document.ingestStatus === 'indexing') { return labels.settingsLibraryDocumentRunning; }
  if (document.latestJobStatus === 'queued' || document.ingestStatus === 'queued') { return labels.settingsLibraryDocumentQueued; }
  return labels.settingsLibraryDocumentRegistered;
}

export type LibraryWidgetProps = {
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

export class LibraryWidget {
  private props: LibraryWidgetProps;
  private readonly element = el('div', 'settings-field');

  constructor(props: LibraryWidgetProps) {
    this.props = props;
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: LibraryWidgetProps) {
    this.props = props;
    this.element.replaceChildren(this.render());
  }

  private render() {
    const field = el('div', 'settings-field settings-library-sections');
    const effectiveManagedDirectory = this.props.libraryDirectory.trim() || this.props.defaultManagedDirectory;

    field.append(
      this.renderStorageSection(effectiveManagedDirectory),
      this.renderIndexingSection(),
    );
    return field;
  }

  private renderStorageSection(effectiveManagedDirectory: string) {
    const section = createSettingsSection({
      title: this.props.labels.settingsLibraryTitle,
      titleClassName: 'settings-section-title',
      sectionClassName: 'settings-library-section settings-library-storage-section',
      panelClassName: 'settings-library-storage-panel',
      listClassName: 'settings-library-storage-list',
    });
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsLibraryStorageMode,
        control: buildSelect([
          { value: 'linked-original', label: this.props.labels.settingsLibraryStorageModeLinkedOriginal },
          { value: 'managed-copy', label: this.props.labels.settingsLibraryStorageModeManagedCopy },
        ], this.props.libraryStorageMode, 'settings.library.storage', (value) => this.props.onLibraryStorageModeChange(value as LibraryStorageMode), 'settings-llm-provider'),
      }),
    );

    const directoryField = el('div', 'settings-field');
    const directoryRow = el('div', 'settings-input-row');
    directoryRow.append(
      buildInput({
        value: this.props.libraryDirectory,
        className: 'settings-input-control',
        focusKey: 'settings.library.directory',
        placeholder: this.props.labels.settingsLibraryDirectoryPlaceholder,
        onInput: this.props.onLibraryDirectoryChange,
      }).element,
      buildButton({ label: '...', icon: lxIconSemanticMap.settings.chooseDirectory, className: 'settings-btn-icon', focusKey: 'settings.library.chooseDirectory', title: this.props.labels.chooseDirectory, disabled: !this.props.desktopRuntime || this.props.isSettingsSaving, onClick: this.props.onChooseLibraryDirectory }),
    );
    directoryField.append(
      text(this.props.labels.settingsLibraryDirectory),
      directoryRow,
      buildHint(this.props.labels.settingsLibraryDirectoryHint),
      buildHint(`${this.props.labels.currentDir} ${effectiveManagedDirectory || '-'}`),
    );

    section.element.append(
      directoryField,
      this.renderReadOnlyField(this.props.labels.settingsLibraryDbFile, this.props.libraryDbFile, 'settings.library.db'),
      this.renderReadOnlyField(this.props.labels.settingsLibraryFilesDir, effectiveManagedDirectory, 'settings.library.filesDir'),
      this.renderReadOnlyField(this.props.labels.settingsLibraryCacheDir, this.props.ragCacheDir, 'settings.library.cacheDir'),
    );
    return section.element;
  }

  private renderIndexingSection() {
    const section = createSettingsSection({
      title: this.props.labels.settingsNavigationKnowledgeBase,
      titleClassName: 'settings-section-title',
      sectionClassName: 'settings-library-section settings-library-indexing-section',
      panelClassName: 'settings-library-indexing-panel',
      listClassName: 'settings-library-indexing-list',
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
      section.element.append(buildHint(this.props.labels.settingsKnowledgeBaseModeDisabledHint, 'settings-hint settings-library-mode-note'));
    }
    section.element.append(
      this.renderDownloadDirectoryField(),
      this.renderMaxConcurrentJobsField(),
      this.renderLibraryStats(),
      this.renderLibraryRecentDocuments(),
    );
    return section.element;
  }

  private renderDownloadDirectoryField() {
    const downloadDirectoryField = el('div', 'settings-field');
    const downloadDirectoryRow = el('div', 'settings-input-row');
    downloadDirectoryRow.append(
      buildInput({
        value: this.props.knowledgeBasePdfDownloadDir,
        className: 'settings-input-control',
        focusKey: 'settings.library.downloadDirectory',
        placeholder: this.props.labels.settingsKnowledgeBasePdfDownloadDirPlaceholder,
        onInput: this.props.onKnowledgeBasePdfDownloadDirChange,
      }).element,
      buildButton({ label: '...', icon: lxIconSemanticMap.settings.chooseDirectory, className: 'settings-btn-icon', focusKey: 'settings.library.chooseDownloadDirectory', title: this.props.labels.chooseDirectory, disabled: !this.props.desktopRuntime || this.props.isSettingsSaving, onClick: this.props.onChooseKnowledgeBasePdfDownloadDir }),
    );
    downloadDirectoryField.append(
      text(this.props.labels.settingsKnowledgeBasePdfDownloadDir),
      downloadDirectoryRow,
      buildHint(this.props.labels.settingsKnowledgeBasePdfDownloadDirHint),
      buildHint(`${this.props.labels.currentDir} ${this.props.knowledgeBasePdfDownloadDir.trim() || this.props.labels.systemDownloads}`),
    );
    return downloadDirectoryField;
  }

  private renderMaxConcurrentJobsField() {
    const jobsField = el('div', 'settings-field');
    const jobsWrap = el('div', 'settings-limit-input-wrap');
    jobsWrap.append(buildNumberStepperInput({
      value: this.props.maxConcurrentIndexJobs,
      className: 'settings-limit-input',
      focusKey: 'settings.library.maxJobs',
      min: '1',
      max: '4',
      inputMode: 'numeric',
      step: '1',
      onInput: this.props.onMaxConcurrentIndexJobsChange,
      disabled: this.props.isSettingsSaving,
    }).element);
    jobsField.append(
      text(this.props.labels.settingsLibraryMaxConcurrentJobs),
      jobsWrap,
      buildHint(this.props.labels.settingsLibraryMaxConcurrentJobsHint),
    );
    return jobsField;
  }

  private renderLibraryStats() {
    const stats = el('div', 'settings-library-stats');
    const addCard = (label: string, value: number) => {
      const card = el('div', 'settings-library-stat-card');
      const cardLabel = el('span', 'settings-library-stat-label');
      cardLabel.textContent = label;
      const strong = el('strong');
      strong.textContent = String(value);
      card.append(cardLabel, strong);
      stats.append(card);
    };
    addCard(this.props.labels.settingsLibraryStatusDocuments, this.props.libraryDocumentCount);
    addCard(this.props.labels.settingsLibraryStatusFiles, this.props.libraryFileCount);
    addCard(this.props.labels.settingsLibraryStatusQueuedJobs, this.props.libraryQueuedJobCount);
    return stats;
  }

  private renderLibraryRecentDocuments() {
    const field = el('div', 'settings-field');
    const title = el('span');
    title.textContent = this.props.labels.settingsLibraryRecentDocuments;
    field.append(title);
    if (this.props.isLibraryLoading) {
      field.append(buildHint(this.props.labels.settingsLoading));
    }
    if (this.props.libraryDocuments.length === 0) {
      field.append(buildHint(this.props.labels.settingsLibraryStatusEmpty));
      return field;
    }
    const list = el('div', 'settings-library-doc-list');
    for (const document of this.props.libraryDocuments) {
      const item = el('div', 'settings-library-doc-item');
      const strong = el('strong', 'settings-library-doc-title');
      strong.textContent = document.title || '-';
      const meta = el('span', 'settings-library-doc-meta');
      meta.textContent = [document.journalTitle, document.publishedAt].filter(Boolean).join(' | ');
      const status = el('span', 'settings-library-doc-status');
      status.textContent = resolveLibraryDocumentStatusLabel(this.props.labels, document);
      item.append(strong, meta, status);
      list.append(item);
    }
    field.append(list);
    return field;
  }

  private renderReadOnlyField(label: string, value: string, focusKey: string) {
    const field = el('div', 'settings-field');
    field.append(text(label), buildInput({
      value,
      className: 'settings-input-control',
      focusKey,
      readOnly: true,
    }).element);
    return field;
  }
}
