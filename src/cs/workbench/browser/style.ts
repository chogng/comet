import './media/style.css';
import { themeService } from 'cs/platform/theme/browser/themeService';

const WORKBENCH_STYLE_ELEMENT_ID = 'cs-workbench-browser-style';

function getOrCreateStyleElement() {
  let element = document.getElementById(WORKBENCH_STYLE_ELEMENT_ID);
  if (element instanceof HTMLStyleElement) {
    return element;
  }

  element = document.createElement('style');
  element.id = WORKBENCH_STYLE_ELEMENT_ID;
  document.head.append(element);
  return element as HTMLStyleElement;
}

export function applyWorkbenchBrowserStyles() {
  const styleElement = getOrCreateStyleElement();
  const toolbarHoverBackground =
    themeService.getColor('sideBar.actionHoverBackground') ??
    'rgba(0, 0, 0, 0.05)';
  const toolbarActiveBackground =
    themeService.getColor('sideBar.actionActiveBackground') ??
    'rgba(0, 0, 0, 0.1)';

  styleElement.textContent = `
.actionbar-split {
  transition: background-color 0.15s ease;
  border-radius: 6px;
}

.actionbar-split:hover,
.actionbar-split:focus-within {
  background: ${toolbarHoverBackground};
}

.actionbar-split .actionbar-action:hover:not(:disabled),
.actionbar-split .actionbar-item.is-active .actionbar-action,
.actionbar-split .actionbar-item.is-active .actionbar-action:hover:not(:disabled),
.actionbar-split .actionbar-item.is-checked .actionbar-action,
.actionbar-split .actionbar-item.is-checked .actionbar-action:hover:not(:disabled) {
  background: transparent;
}

.actionbar-split:active {
  background: ${toolbarActiveBackground};
}
`.trim();
}
