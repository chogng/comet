import { createSettingsElement as el } from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';

function classNames(...names: Array<string | undefined>) {
  return names
    .map((className) => className?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

export type SettingsSection = {
  element: HTMLElement;
  panel: HTMLDivElement;
  list: HTMLUListElement;
};

export type CreateSettingsSectionOptions = {
  sectionClassName?: string;
  title?: string;
  titleClassName?: string;
  description?: string;
  descriptionClassName?: string;
  panelClassName?: string;
  listClassName?: string;
};

export function createSettingsSection(
  options: CreateSettingsSectionOptions = {},
): SettingsSection {
  const section = el(
    'section',
    classNames('settings-block-section', options.sectionClassName),
  );

  if (options.title) {
    const title = el(
      'h3',
      classNames('settings-block-title', options.titleClassName),
    );
    title.textContent = options.title;
    section.append(title);
  }

  if (options.description) {
    const description = el(
      'p',
      classNames('settings-block-description', options.descriptionClassName),
    );
    description.textContent = options.description;
    section.append(description);
  }

  const panel = el(
    'div',
    classNames('settings-block-panel', options.panelClassName),
  );
  const list = el(
    'ul',
    classNames('settings-block-list', options.listClassName),
  );
  panel.append(list);
  section.append(panel);

  return {
    element: section,
    panel,
    list,
  };
}

export type CreateSettingsRowOptions = {
  title: string;
  description?: string;
  control: HTMLElement;
  itemClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  contentClassName?: string;
  controlClassName?: string;
};

export function createSettingsRow(
  options: CreateSettingsRowOptions,
): HTMLLIElement {
  const item = el(
    'li',
    classNames('settings-block-list-item', options.itemClassName),
  );
  const content = el(
    'div',
    classNames('settings-block-list-item-content', options.contentClassName),
  );
  const title = el(
    'span',
    classNames('settings-block-list-item-title', options.titleClassName),
  );
  title.textContent = options.title;
  content.append(title);
  if (options.description) {
    const description = el(
      'p',
      classNames(
        'settings-block-list-item-description',
        options.descriptionClassName,
      ),
    );
    description.textContent = options.description;
    content.append(description);
  }
  const control = el(
    'div',
    classNames('settings-block-list-item-control', options.controlClassName),
  );
  control.append(options.control);
  item.append(content, control);
  return item;
}

export type CreateSettingsSwitchRowOptions = {
  title: string;
  hint?: string;
  control: HTMLElement;
  rowClassName?: string;
  textBlockClassName?: string;
  labelClassName?: string;
  hintClassName?: string;
};

export function createSettingsSwitchRow(
  options: CreateSettingsSwitchRowOptions,
): HTMLDivElement {
  const row = el(
    'div',
    classNames('settings-toggle-row', options.rowClassName),
  );
  const textBlock = el('div', options.textBlockClassName);
  const label = el('span', options.labelClassName ?? 'settings-hint');
  label.textContent = options.title;
  textBlock.append(label);
  if (options.hint) {
    const hint = el(
      'p',
      options.hintClassName ?? 'settings-hint settings-toggle-subtitle',
    );
    hint.textContent = options.hint;
    textBlock.append(hint);
  }
  row.append(textBlock, options.control);
  return row;
}
