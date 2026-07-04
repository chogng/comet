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
.comet-actionbar-split {
  transition: background-color 0.15s ease;
  border-radius: 6px;
}

.comet-actionbar-split:hover,
.comet-actionbar-split:focus-within {
  background: ${toolbarHoverBackground};
}

.comet-actionbar-split .comet-actionbar-action:hover:not(:disabled),
.comet-actionbar-split .comet-actionbar-item.comet-is-active .comet-actionbar-action,
.comet-actionbar-split .comet-actionbar-item.comet-is-active .comet-actionbar-action:hover:not(:disabled),
.comet-actionbar-split .comet-actionbar-item.comet-is-checked .comet-actionbar-action,
.comet-actionbar-split .comet-actionbar-item.comet-is-checked .comet-actionbar-action:hover:not(:disabled) {
  background: transparent;
}

.comet-actionbar-split:active {
  background: ${toolbarActiveBackground};
}
`.trim();
}
