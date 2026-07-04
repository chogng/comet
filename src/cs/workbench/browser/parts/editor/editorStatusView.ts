import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type {
  EditorStatusItem,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';

const hoverService = getHoverService();

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

function renderStatusItem(item: EditorStatusItem) {
  const element = createElement(
    'span',
    ['comet-editor-statusbar-item', item.tone ? `is-${item.tone}` : '']
      .filter(Boolean)
      .join(' '),
  );
  const label = createElement('span', 'comet-editor-statusbar-item-label');
  label.textContent = item.label;
  const value = createElement('span', 'comet-editor-statusbar-item-value');
  hoverService.applyHover(value, item.value);
  value.textContent = item.value;
  element.append(label, value);
  return element;
}

export class EditorStatusView {
  private readonly element = createElement('footer');

  constructor(status: EditorStatusState) {
    this.setStatus(status);
  }

  getElement() {
    return this.element;
  }

  setStatus(status: EditorStatusState) {
    this.element.className = ['comet-editor-statusbar', `is-pane-mode-${status.paneMode}`].join(' ');
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-label', status.ariaLabel);

    const primary = createElement('div', 'comet-editor-statusbar-group is-primary');
    if (status.modeLabel) {
      const mode = createElement('span', 'comet-editor-statusbar-mode-pill');
      mode.textContent = status.modeLabel;
      primary.append(mode);
    }
    if (status.summary) {
      const summary = createElement('span', 'comet-editor-statusbar-summary');
      hoverService.applyHover(summary, status.summary);
      summary.textContent = status.summary;
      primary.append(summary);
    }
    for (const item of status.leftItems) {
      primary.append(renderStatusItem(item));
    }

    const secondary = createElement('div', 'comet-editor-statusbar-group is-secondary');
    for (const item of status.rightItems) {
      secondary.append(renderStatusItem(item));
    }

    this.element.replaceChildren(primary, secondary);
  }
}

export default EditorStatusView;
