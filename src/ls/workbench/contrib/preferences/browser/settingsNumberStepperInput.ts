import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
import {
  buildSettingsInput,
  createSettingsElement,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';

export function buildSettingsNumberStepperInput(config: {
  value: string | number;
  className: string;
  focusKey: string;
  min?: string;
  max?: string;
  inputMode?: HTMLInputElement['inputMode'];
  step?: string;
  onInput?: (value: string) => void;
  disabled?: boolean;
}) {
  const stepper = createSettingsElement(
    'div',
    `settings-number-stepper ${config.className}`.trim(),
  );
  const decrementButton = createSettingsElement(
    'button',
    'settings-number-stepper-button settings-number-stepper-button-decrement',
  );
  decrementButton.type = 'button';
  decrementButton.append(
    createLxIcon(
      lxIconSemanticMap.settings.decrement,
      'settings-number-stepper-button-icon',
    ),
  );
  decrementButton.ariaLabel = 'Decrease value';
  const inputBox = buildSettingsInput({
    type: 'number',
    value: config.value,
    className: 'settings-number-stepper-input',
    focusKey: config.focusKey,
    min: config.min,
    max: config.max,
    step: config.step,
    inputMode: config.inputMode ?? 'decimal',
    disabled: config.disabled,
    onInput: config.onInput,
  });
  const incrementButton = createSettingsElement(
    'button',
    'settings-number-stepper-button settings-number-stepper-button-increment',
  );
  incrementButton.type = 'button';
  incrementButton.append(
    createLxIcon(
      lxIconSemanticMap.settings.increment,
      'settings-number-stepper-button-icon',
    ),
  );
  incrementButton.ariaLabel = 'Increase value';
  const syncButtonsDisabled = () => {
    const disabled = inputBox.inputElement.disabled || inputBox.inputElement.readOnly;
    decrementButton.disabled = disabled;
    incrementButton.disabled = disabled;
  };
  const nudgeValue = (direction: 'up' | 'down') => {
    const input = inputBox.inputElement;
    if (input.disabled || input.readOnly) {
      return;
    }
    const previous = input.value;
    try {
      if (direction === 'up') {
        input.stepUp();
      } else {
        input.stepDown();
      }
    } catch {
      return;
    }
    if (input.value !== previous) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus();
  };
  decrementButton.addEventListener('click', () => nudgeValue('down'));
  incrementButton.addEventListener('click', () => nudgeValue('up'));
  stepper.append(decrementButton, inputBox.element, incrementButton);
  const setDisabled = (disabled: boolean) => {
    inputBox.inputElement.disabled = disabled;
    syncButtonsDisabled();
  };
  syncButtonsDisabled();
  return {
    element: stepper,
    inputElement: inputBox.inputElement,
    setDisabled,
  };
}
