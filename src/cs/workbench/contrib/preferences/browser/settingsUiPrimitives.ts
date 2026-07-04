import { applyHover } from 'cs/base/browser/ui/hover/hover';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { SelectBox } from 'cs/base/browser/ui/selectbox/selectBox';
import { createSwitchView } from 'cs/base/browser/ui/switch/switch';

type SettingsSelectOption = {
  value: string;
  label: string;
  title?: string;
  isDisabled?: boolean;
};

export function createSettingsElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

export function createSettingsText(value: string | number) {
  return document.createTextNode(String(value));
}

export function setSettingsFocusKey<T extends HTMLElement>(node: T, key: string) {
  node.dataset.focusKey = key;
  return node;
}

export function buildSettingsHint(value: string, className = 'settings-hint') {
  const hint = createSettingsElement('p', className);
  hint.textContent = value;
  return hint;
}

export function buildSettingsInput(config: {
  type?: string;
  value: string | number;
  className: string;
  focusKey: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  step?: string;
  inputMode?: HTMLInputElement['inputMode'];
  onInput?: (value: string) => void;
}) {
  const host = createSettingsElement('div');
  const inputBox = new InputBox(host, undefined, {
    className: `settings-inputbox ${config.className}`.trim(),
    type: config.type ?? 'text',
    value: String(config.value),
    placeholder: config.placeholder ?? '',
    inputAttributes: {
      readOnly: config.readOnly,
      disabled: config.disabled,
      min: config.min,
      max: config.max,
      step: config.step,
      inputMode: config.inputMode,
    },
  });
  setSettingsFocusKey(inputBox.inputElement, config.focusKey);
  const onInput = config.onInput;
  if (onInput) {
    inputBox.onDidChange((value) => onInput(value));
  }
  return inputBox;
}

export function buildSettingsSelect(
  options: readonly SettingsSelectOption[],
  value: string,
  focusKey: string,
  onChange: (value: string) => void,
  className: string,
) {
  const selectBox = new SelectBox(
    options.map((option) => ({
      text: option.label,
      value: option.value,
      title: option.title ?? option.label,
      isDisabled: option.isDisabled,
    })),
    Math.max(0, options.findIndex((option) => option.value === value)),
    undefined,
    {},
    {
      useCustomDrawn: true,
      className: `settings-select-trigger ${className}`.trim(),
    },
  );
  const host = createSettingsElement('div');
  selectBox.render(host);
  selectBox.onDidSelect(({ selected }) => onChange(selected));
  setSettingsFocusKey(selectBox.domNode, focusKey);
  return host;
}

export function buildSettingsButton(config: {
  label: string;
  icon?: LxIconName;
  className?: string;
  focusKey: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const extraClasses = (config.className ?? '').trim();
  const isIconButton = extraClasses.includes('settings-btn-icon');
  const buttonClassName = [
    'settings-btn',
    'btn-base',
    'btn-secondary',
    isIconButton ? 'btn-mode-icon btn-sm' : 'btn-md',
    extraClasses,
  ]
    .filter(Boolean)
    .join(' ');
  const button = setSettingsFocusKey(
    createSettingsElement('button', buttonClassName),
    config.focusKey,
  );
  button.type = 'button';
  if (config.icon) {
    button.append(createLxIcon(config.icon));
  } else {
    button.textContent = config.label;
  }
  applyHover(button, config.title ?? config.label);
  button.ariaLabel = config.title ?? config.label;
  button.disabled = Boolean(config.disabled);
  button.addEventListener('click', () => config.onClick());
  return button;
}

export function buildSettingsSwitch(config: {
  checked: boolean;
  focusKey: string;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  const view = createSwitchView({
    checked: config.checked,
    disabled: config.disabled,
    className: 'settings-toggle-switch',
    title: config.title,
    animationKey: config.focusKey,
    onChange: config.onChange,
  });
  const element = view.getElement();
  const input = element.querySelector<HTMLInputElement>('.switch-input');
  if (input) {
    setSettingsFocusKey(input, config.focusKey);
  } else {
    setSettingsFocusKey(element, config.focusKey);
  }
  return element;
}

export function buildSettingsCheckbox(config: {
  checked: boolean;
  className: string;
  focusKey: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const input = setSettingsFocusKey(
    createSettingsElement('input', config.className),
    config.focusKey,
  );
  input.type = 'checkbox';
  input.checked = config.checked;
  input.disabled = Boolean(config.disabled);
  input.addEventListener('change', () => config.onChange(input.checked));
  return input;
}
