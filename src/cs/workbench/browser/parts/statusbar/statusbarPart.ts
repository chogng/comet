import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { createStatusbarItemElement } from 'cs/workbench/browser/parts/statusbar/statusbarItem';
import { renderStatusbarMode } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import 'cs/workbench/browser/parts/statusbar/media/statusbar.css';

const hoverService = getHoverService();

function createTextElement(className: string, text: string, title?: string) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  if (title) {
    hoverService.applyHover(element, title);
  }

  return element;
}

export class StatusbarPart {
  private readonly container: HTMLElement;
  private readonly statusbarElement: HTMLElement;
  private readonly primaryGroupElement: HTMLDivElement;
  private readonly secondaryGroupElement: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('comet-statusbar-part');

    this.statusbarElement = document.createElement('footer');
    this.statusbarElement.className = 'comet-editor-statusbar is-pane-mode-empty';
    this.statusbarElement.setAttribute('role', 'status');
    this.statusbarElement.setAttribute('aria-label', '');

    this.primaryGroupElement = document.createElement('div');
    this.primaryGroupElement.className = 'comet-editor-statusbar-group is-primary';
    this.secondaryGroupElement = document.createElement('div');
    this.secondaryGroupElement.className = 'comet-editor-statusbar-group is-secondary';

    this.statusbarElement.append(
      this.primaryGroupElement,
      this.secondaryGroupElement,
    );
    this.container.replaceChildren(this.statusbarElement);
  }

  render(status: EditorStatusState) {
    this.statusbarElement.className = [
      'comet-editor-statusbar',
      `is-pane-mode-${status.paneMode}`,
    ].join(' ');
    this.statusbarElement.setAttribute('aria-label', status.ariaLabel);
    renderStatusbarMode(status, {
      primaryGroupElement: this.primaryGroupElement,
      secondaryGroupElement: this.secondaryGroupElement,
      createTextElement,
      createStatusbarItemElement,
    });
  }

  dispose() {
    this.container.replaceChildren();
    this.container.classList.remove('comet-statusbar-part');
  }
}

export default StatusbarPart;
