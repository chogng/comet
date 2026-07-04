import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type {
  EditorStatusItem,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';
import { $ } from 'cs/base/browser/dom';

const hoverService = getHoverService();function renderStatusItem(item: EditorStatusItem) {
  const element = $<HTMLElementTagNameMap['span']>('span', { class: ['comet-editor-statusbar-item', item.tone ? `is-${item.tone}` : '']
      .filter(Boolean)
      .join(' ') });
  const label = $<HTMLElementTagNameMap['span']>('span.comet-editor-statusbar-item-label');
  label.textContent = item.label;
  const value = $<HTMLElementTagNameMap['span']>('span.comet-editor-statusbar-item-value');
  hoverService.applyHover(value, item.value);
  value.textContent = item.value;
  element.append(label, value);
  return element;
}

export class EditorStatusView {
  private readonly element = $<HTMLElementTagNameMap['footer']>('footer');

  constructor(status: EditorStatusState) {
    this.setStatus(status);
  }

  getElement() {
    return this.element;
  }

  setStatus(status: EditorStatusState) {
    this.element.className = ['comet-editor-statusbar', `comet-is-pane-mode-${status.paneMode}`].join(' ');
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-label', status.ariaLabel);

    const primary = $<HTMLElementTagNameMap['div']>('div.comet-editor-statusbar-group.comet-is-primary');
    if (status.modeLabel) {
      const mode = $<HTMLElementTagNameMap['span']>('span.comet-editor-statusbar-mode-pill');
      mode.textContent = status.modeLabel;
      primary.append(mode);
    }
    if (status.summary) {
      const summary = $<HTMLElementTagNameMap['span']>('span.comet-editor-statusbar-summary');
      hoverService.applyHover(summary, status.summary);
      summary.textContent = status.summary;
      primary.append(summary);
    }
    for (const item of status.leftItems) {
      primary.append(renderStatusItem(item));
    }

const secondary = $<HTMLElementTagNameMap['div']>('div.comet-editor-statusbar-group.comet-is-secondary');
    for (const item of status.rightItems) {
      secondary.append(renderStatusItem(item));
    }

    this.element.replaceChildren(primary, secondary);
  }
}

export default EditorStatusView;
