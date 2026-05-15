import type { BatchSource } from 'ls/workbench/services/config/configSchema';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import {
  buildSettingsButton as buildButton,
  buildSettingsInput as buildInput,
  createSettingsElement as el,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';

export type BatchSourcesWidgetProps = {
  labels: SettingsPartLabels;
  batchSources: BatchSource[];
  isSettingsSaving: boolean;
  onBatchSourceUrlChange: (index: number, url: string) => void;
  onBatchSourceJournalTitleChange: (index: number, journalTitle: string) => void;
  onSaveBatchSources: () => Promise<boolean>;
  onAddBatchSource: () => void;
  onRemoveBatchSource: (index: number) => void;
  onMoveBatchSource: (index: number, direction: 'up' | 'down') => void;
};

export class BatchSourcesWidget {
  private readonly element = el('section', 'settings-block-section settings-supported-sources-section');
  private readonly panel = el('div', 'settings-block-panel settings-supported-sources-panel');
  private readonly list = el('ul', 'settings-block-list');
  private readonly summary = el('li', 'settings-block-list-item settings-supported-sources-summary');
  private readonly header = el('div', 'settings-block-list-item-content');
  private readonly title = el('span', 'settings-block-list-item-title');
  private readonly description = el('p', 'settings-block-list-item-description');
  private readonly actions = el('div', 'settings-block-list-item-control');
  private readonly actionGroup = el('div', 'settings-supported-sources-actions');
  private readonly editButton = buildButton({
    label: '',
    focusKey: 'settings.batch.sources.edit',
    onClick: async () => {
      if (this.isEditing) {
        const didSave = await this.props.onSaveBatchSources();
        if (!didSave) {
          return;
        }
        this.isEditing = false;
      } else {
        this.isEditing = true;
        this.isExpanded = true;
      }
      this.renderDisclosure();
      this.renderRows();
    },
  });
  private readonly toggleButton = buildButton({
    label: '',
    focusKey: 'settings.batch.sources.toggle',
    onClick: () => {
      this.isExpanded = !this.isExpanded;
      this.renderDisclosure();
    },
  });
  private readonly table = el('div', 'settings-supported-sources-table');
  private labels: SettingsPartLabels;
  private props: BatchSourcesWidgetProps;
  private isExpanded = false;
  private isEditing = false;

  constructor(props: BatchSourcesWidgetProps) {
    this.props = props;
    this.labels = props.labels;
    this.header.append(this.title, this.description);
    this.actionGroup.append(this.editButton, this.toggleButton);
    this.actions.append(this.actionGroup);
    this.summary.append(this.header, this.actions);
    this.list.append(this.summary);
    this.panel.append(this.list, this.table);
    this.element.append(this.panel);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: BatchSourcesWidgetProps) {
    this.props = props;
    this.labels = props.labels;
    this.title.textContent = props.labels.settingsPageUrl;
    this.description.textContent = props.labels.settingsPageUrlHint;

    if (!this.isEditing || this.table.childElementCount !== props.batchSources.length) {
      this.renderRows();
    }
    this.renderDisclosure();
  }

  private renderRows() {
    this.table.replaceChildren(...this.props.batchSources.map((source, index) => {
      const row = el('div', 'settings-supported-source-row');
      const url = el('span', 'settings-supported-source-url');
      url.textContent = source.url.replace(/^https?:\/\//i, '');
      url.title = source.url;
      const journalCell = el('div', 'settings-supported-source-journal-cell');
      const journalTitle = this.isEditing
        ? this.renderJournalInput(source, index)
        : this.renderJournalTitle(source);
      journalCell.append(journalTitle);
      row.append(url, journalCell);
      return row;
    }));
  }

  private renderJournalTitle(source: BatchSource) {
    const journalTitle = el('span', 'settings-supported-source-journal');
    journalTitle.textContent = source.journalTitle.trim();
    journalTitle.title = journalTitle.textContent;
    return journalTitle;
  }

  private renderJournalInput(source: BatchSource, index: number) {
    const inputBox = buildInput({
      value: source.journalTitle,
      className: 'settings-input-control settings-supported-source-journal-input',
      focusKey: `settings.batch.sources.${index}.journalTitle`,
      placeholder: this.props.labels.batchJournalTitlePlaceholder,
      disabled: this.props.isSettingsSaving,
      onInput: (value) => this.props.onBatchSourceJournalTitleChange(index, value),
    });
    return inputBox.element;
  }

  private renderDisclosure() {
    const editLabel = this.isEditing
      ? this.labels.settingsBatchSourcesDone
      : this.labels.settingsBatchSourcesEdit;
    const label = this.isExpanded
      ? this.labels.settingsBatchSourcesHide
      : this.labels.settingsBatchSourcesShow;
    this.editButton.textContent = editLabel;
    this.editButton.ariaLabel = editLabel;
    this.editButton.disabled = this.props.isSettingsSaving;
    this.toggleButton.textContent = label;
    this.toggleButton.ariaLabel = label;
    this.toggleButton.setAttribute('aria-expanded', String(this.isExpanded));
    this.table.hidden = !this.isExpanded;
    this.table.setAttribute('aria-hidden', String(!this.isExpanded));
    this.panel.classList.toggle('expanded', this.isExpanded);
  }
}
