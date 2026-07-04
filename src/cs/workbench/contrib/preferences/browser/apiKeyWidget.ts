import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import {
  buildSettingsInput as buildInput,
  createSettingsElement as el,
  setSettingsFocusKey as setFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';

const hoverService = getHoverService();

export type ApiKeyWidgetProps = {
  title: string;
  subtitle?: string;
  value: string;
  placeholder: string;
  show: boolean;
  focusKey: string;
  toggleKey: string;
  toggleLabelShow: string;
  toggleLabelHide: string;
  onToggle: () => void;
  onInput: (value: string) => void;
  className?: string;
  hideToggleWhenEmpty?: boolean;
};

export class ApiKeyWidget {
  private props: ApiKeyWidgetProps;
  private readonly element = el('div', 'settings-field settings-llm-api-field settings-llm-span-2');
  private readonly header = el('div', 'settings-llm-api-header');
  private readonly titleWrap = el('div', 'settings-llm-api-title-wrap');
  private readonly title = el('span', 'settings-llm-api-title');
  private readonly subtitle = el('span', 'settings-llm-api-subtitle');
  private readonly row = el('div', 'settings-input-row settings-llm-api-row');
  private readonly inputWrap = el('div', 'settings-native-input-wrap settings-api-key-input');
  private readonly inputBox = buildInput({
    value: '',
    className: 'settings-input-control',
    focusKey: '',
    placeholder: '',
    onInput: (value) => this.props.onInput(value),
  });
  private readonly input = this.inputBox.inputElement;
  private readonly toggle = el('button', 'settings-password-toggle');

  constructor(props: ApiKeyWidgetProps) {
    this.props = props;
    this.toggle.type = 'button';
    this.toggle.addEventListener('click', () => this.props.onToggle());
    this.inputBox.element.append(this.toggle);
    this.inputWrap.append(this.inputBox.element);
    this.row.append(this.inputWrap);
    this.titleWrap.append(this.title, this.subtitle);
    this.header.append(this.titleWrap, this.row);
    this.element.append(this.header);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: ApiKeyWidgetProps) {
    this.props = props;
    this.element.className = props.className ?? 'settings-field settings-llm-api-field settings-llm-span-2';
    this.title.textContent = props.title;
    this.subtitle.textContent = props.subtitle ?? '';
    this.subtitle.hidden = !props.subtitle;
    setFocusKey(this.input, props.focusKey);
    this.input.type = props.show ? 'text' : 'password';
    this.inputBox.value = props.value;
    this.inputBox.setPlaceHolder(props.placeholder);
    setFocusKey(this.toggle, props.toggleKey);
    const shouldHideToggle = Boolean(props.hideToggleWhenEmpty && !props.value);
    this.toggle.hidden = shouldHideToggle;
    this.toggle.style.display = shouldHideToggle ? 'none' : '';
    this.element.classList.toggle('settings-api-key-empty', shouldHideToggle);
    if (!shouldHideToggle) {
      this.toggle.replaceChildren(createLxIcon(props.show ? 'hidden' : 'show'));
      hoverService.applyHover(this.toggle, props.show ? props.toggleLabelHide : props.toggleLabelShow);
      this.toggle.ariaLabel = props.show ? props.toggleLabelHide : props.toggleLabelShow;
    }
  }
}
