import type { ActionBarMenuItem } from 'cs/base/browser/ui/actionbar/actionbar';
import type {
  DropdownMenuHeader,
  DropdownMenuHeaderContext,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';

import 'cs/base/browser/ui/dropdown/dropdownSearchHeader.css';

type DropdownSearchInputViewOptions = {
  className?: string;
  inputClassName?: string;
  placeholder: string;
  ariaLabel: string;
  type?: HTMLInputElement['type'];
  value?: string;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  onChange?: (value: string) => void;
  onEscape?: () => void;
};

type CreateFilterMenuHeaderOptions = {
  className?: string;
  inputClassName?: string;
  placeholder: string;
  ariaLabel: string;
  getMenuItems: (query: string) => readonly ActionBarMenuItem[];
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function composeClassName(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(' ');
}

export function createDropdownSearchInputView(
  options: DropdownSearchInputViewOptions,
) {
  const header = createElement(
    'div',
    composeClassName([
      'dropdown-menu-search-header',
      options.className,
    ]),
  );
  const inputHost = createElement('div');
  const inputBox = new InputBox(inputHost, undefined, {
    className: composeClassName([
      'dropdown-menu-search-input',
      options.inputClassName,
    ]),
    type: options.type ?? 'search',
    value: options.value ?? '',
    placeholder: options.placeholder,
    ariaLabel: options.ariaLabel,
  });
  inputBox.onDidChange((value) => {
    options.onChange?.(value);
  });
  inputBox.inputElement.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    options.onEscape?.();
  });
  header.append(inputHost);

  queueMicrotask(() => {
    if (options.autoFocus === false) {
      return;
    }
    inputBox.focus();
    if (options.selectOnFocus !== false) {
      inputBox.select();
    }
  });

  return {
    element: header,
    inputBox,
  };
}

export function createFilterMenuHeader(
  options: CreateFilterMenuHeaderOptions,
): DropdownMenuHeader {
  return {
    autoFocusOnShow: true,
    render: (context: DropdownMenuHeaderContext) => {
      const searchInput = createDropdownSearchInputView({
        className: options.className,
        inputClassName: options.inputClassName,
        placeholder: options.placeholder,
        ariaLabel: options.ariaLabel,
        onChange: (value) => {
          context.updateMenu(options.getMenuItems(value));
        },
        onEscape: () => {
          context.hide();
        },
      });
      return searchInput.element;
    },
  };
}
