import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { SelectBox } from 'cs/base/browser/ui/selectbox/selectBox';
import { createSwitchView } from 'cs/base/browser/ui/switch/switch';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type { IHoverService } from 'cs/platform/hover/browser/hover';
import { ZIndex } from 'cs/platform/layout/browser/zIndexRegistry';

export const settingsPopupContextViewLayer = ZIndex.ModalDialog - 2575;

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

export function buildSettingsHint(value: string, className = 'comet-settings-hint') {
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
}, disposables: DisposableStore) {
  const host = createSettingsElement('div');
  const inputBox = new InputBox(host, undefined, {
    className: `comet-settings-inputbox ${config.className}`.trim(),
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
	disposables.add(inputBox);
  setSettingsFocusKey(inputBox.inputElement, config.focusKey);
  const onInput = config.onInput;
  if (onInput) {
	disposables.add(inputBox.onDidChange((value) => onInput(value)));
  }
  return inputBox;
}

export function buildSettingsSecretInput(config: {
  title: string;
  subtitle?: string;
  value: string;
  placeholder: string;
  configured?: boolean;
  focusKey: string;
  configuredLabel: string;
  notConfiguredLabel: string;
  setLabel: string;
  updateLabel: string;
  clearLabel: string;
  disabled?: boolean;
  onSubmit: (value: string) => void;
  onClear?: () => void;
  className?: string;
}, hoverService: IHoverService, disposables: DisposableStore) {
  const element = createSettingsElement(
    'div',
    config.className ?? 'comet-settings-field comet-settings-llm-api-field comet-settings-llm-span-2',
  );
  const isConfigured = config.configured ?? Boolean(config.value.trim());
  const header = createSettingsElement('div', 'comet-settings-llm-api-header');
  const titleWrap = createSettingsElement('div', 'comet-settings-llm-api-title-wrap');
  const title = createSettingsElement('span', 'comet-settings-llm-api-title');
  const subtitle = createSettingsElement('span', 'comet-settings-llm-api-subtitle');
  const status = createSettingsElement('span', 'comet-settings-api-key-status');
  const row = createSettingsElement('div', 'comet-settings-input-row comet-settings-llm-api-row');
  const inputWrap = createSettingsElement('div', 'comet-settings-native-input-wrap comet-settings-api-key-input');
  let pendingValue = config.value;
  const inputBox = buildSettingsInput({
    type: 'password',
    value: config.value,
    className: 'comet-settings-input-control',
    focusKey: config.focusKey,
    placeholder: config.placeholder,
    disabled: config.disabled,
  }, disposables);
  const actions = createSettingsElement('div', 'comet-settings-api-key-actions');
  const submitButton = buildSettingsButton({
    label: isConfigured ? config.updateLabel : config.setLabel,
    focusKey: `${config.focusKey}.submit`,
    disabled: config.disabled || !pendingValue.trim(),
    onClick: () => {
      const value = pendingValue.trim();
      if (value) {
        config.onSubmit(value);
        inputBox.value = '';
        pendingValue = '';
        submitButton.disabled = true;
      }
    },
  }, hoverService, disposables);

  title.textContent = config.title;
  subtitle.textContent = config.subtitle ?? '';
  subtitle.hidden = !config.subtitle;
  status.textContent = isConfigured ? config.configuredLabel : config.notConfiguredLabel;
  element.classList.toggle('comet-settings-api-key-empty', !isConfigured);
	disposables.add(inputBox.onDidChange((value) => {
    pendingValue = value;
    submitButton.disabled = Boolean(config.disabled) || !value.trim();
  }));
	const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || submitButton.disabled) {
      return;
    }
    event.preventDefault();
    submitButton.click();
	};
	inputBox.inputElement.addEventListener('keydown', handleKeyDown);
	disposables.add(toDisposable(() => inputBox.inputElement.removeEventListener('keydown', handleKeyDown)));
  actions.append(submitButton);
  if (isConfigured && config.onClear) {
    actions.append(buildSettingsButton({
      label: config.clearLabel,
      focusKey: `${config.focusKey}.clear`,
      disabled: config.disabled,
      onClick: config.onClear,
    }, hoverService, disposables));
  }
  inputWrap.append(inputBox.element);
  row.append(inputWrap, actions);
  titleWrap.append(title, subtitle, status);
  header.append(titleWrap, row);
  element.append(header);
  return element;
}

export function buildSettingsSelect(
  options: readonly SettingsSelectOption[],
  value: string,
  focusKey: string,
  onChange: (value: string) => void,
  contextViewProvider: IContextViewProvider,
  className: string,
  disposables: DisposableStore,
) {
  const selectBox = new SelectBox(
    options.map((option) => ({
      text: option.label,
      value: option.value,
      title: option.title ?? option.label,
      isDisabled: option.isDisabled,
    })),
    Math.max(0, options.findIndex((option) => option.value === value)),
    contextViewProvider,
    {},
    {
      useCustomDrawn: true,
      className: `comet-settings-select-trigger ${className}`.trim(),
      contextViewLayer: settingsPopupContextViewLayer,
    },
  );
	disposables.add(selectBox);
  const host = createSettingsElement('div');
  selectBox.render(host);
	disposables.add(selectBox.onDidSelect(({ selected }) => onChange(selected)));
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
}, hoverService: IHoverService, disposables: DisposableStore) {
  const extraClasses = (config.className ?? '').trim();
  const isIconButton = extraClasses.includes('comet-settings-btn-icon');
	const buttonView = disposables.add(new ButtonView({
		className: ['comet-settings-btn', extraClasses].filter(Boolean).join(' '),
		variant: 'secondary',
		size: isIconButton ? 'sm' : 'md',
		mode: isIconButton ? 'icon' : 'text',
		children: config.icon ? createLxIcon(config.icon) : config.label,
		disabled: config.disabled,
		title: config.title ?? config.label,
		ariaLabel: config.title ?? config.label,
		hoverService,
		onClick: config.onClick,
	}));
	return setSettingsFocusKey(buttonView.getElement(), config.focusKey);
}

export function buildSettingsSwitch(config: {
  checked: boolean;
  focusKey: string;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}, disposables: DisposableStore) {
  const view = createSwitchView({
    checked: config.checked,
    disabled: config.disabled,
    className: 'comet-settings-toggle-switch',
    title: config.title,
    animationKey: config.focusKey,
    onChange: config.onChange,
  });
	disposables.add(view);
  const element = view.getElement();
  setSettingsFocusKey(view.getInputElement(), config.focusKey);
  return element;
}

export function buildSettingsCheckbox(config: {
  checked: boolean;
  className: string;
  focusKey: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}, disposables: DisposableStore) {
  const input = setSettingsFocusKey(
    createSettingsElement('input', config.className),
    config.focusKey,
  );
  input.type = 'checkbox';
  input.checked = config.checked;
  input.disabled = Boolean(config.disabled);
	const handleChange = () => config.onChange(input.checked);
	input.addEventListener('change', handleChange);
	disposables.add(toDisposable(() => input.removeEventListener('change', handleChange)));
  return input;
}
