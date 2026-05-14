import type { BatchSource } from 'ls/workbench/services/config/configSchema';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import {
  buildSettingsButton as buildButton,
  createSettingsElement as el,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';

export type BatchSourcesWidgetProps = {
  labels: SettingsPartLabels;
  batchSources: BatchSource[];
  isSettingsSaving: boolean;
  onBatchSourceUrlChange: (index: number, url: string) => void;
  onBatchSourceJournalTitleChange: (index: number, journalTitle: string) => void;
  onAddBatchSource: () => void;
  onRemoveBatchSource: (index: number) => void;
  onMoveBatchSource: (index: number, direction: 'up' | 'down') => void;
};

export class BatchSourcesWidget {
  private readonly element = el('section', 'settings-supported-sources-card');
  private readonly summary = el('div', 'settings-supported-sources-summary');
  private readonly header = el('div', 'settings-supported-sources-header');
  private readonly title = el('h3', 'settings-supported-sources-title');
  private readonly description = el('p', 'settings-supported-sources-description');
  private readonly actions = el('div', 'settings-supported-sources-actions');
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
  private isExpanded = false;

  constructor(props: BatchSourcesWidgetProps) {
    this.labels = props.labels;
    this.header.append(this.title, this.description);
    this.actions.append(this.toggleButton);
    this.summary.append(this.header, this.actions);
    this.element.append(this.summary, this.table);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: BatchSourcesWidgetProps) {
    this.labels = props.labels;
    this.title.textContent = props.labels.settingsPageUrl;
    this.description.textContent = props.labels.settingsPageUrlHint;

    this.table.replaceChildren(...props.batchSources.map((source) => {
      const row = el('div', 'settings-supported-source-row');
      const url = el('span', 'settings-supported-source-url');
      const journalTitle = el('span', 'settings-supported-source-journal');
      url.textContent = source.url;
      url.title = source.url;
      journalTitle.textContent = source.journalTitle.trim() || props.labels.settingsBatchSourceOptimized;
      journalTitle.title = journalTitle.textContent;
      row.append(url, journalTitle);
      return row;
    }));
    this.renderDisclosure();
  }

  private renderDisclosure() {
    const label = this.isExpanded
      ? this.labels.settingsBatchSourcesHide
      : this.labels.settingsBatchSourcesShow;
    this.toggleButton.textContent = label;
    this.toggleButton.ariaLabel = label;
    this.table.hidden = !this.isExpanded;
    this.element.classList.toggle('expanded', this.isExpanded);
  }
}
