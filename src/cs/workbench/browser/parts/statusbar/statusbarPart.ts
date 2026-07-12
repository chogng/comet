/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { createStatusbarItemElement } from 'cs/workbench/browser/parts/statusbar/statusbarItem';
import { renderStatusbarMode } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import 'cs/workbench/browser/parts/statusbar/media/statusbar.css';

const hoverService = getHoverService();

function createTextElement(className: string, text: string, title?: string) {
	const element = $<HTMLSpanElement>('span', { class: className });
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

  constructor(
    container: HTMLElement,
    private readonly commandService: IWorkbenchCommandService,
  ) {
    this.container = container;
    this.container.classList.add('comet-statusbar-part');

		this.statusbarElement = $<HTMLElementTagNameMap['footer']>('footer.comet-editor-statusbar.comet-is-pane-mode-empty');
    this.statusbarElement.setAttribute('role', 'status');
    this.statusbarElement.setAttribute('aria-label', '');

		this.primaryGroupElement = $<HTMLDivElement>('div.comet-editor-statusbar-group.comet-is-primary');
		this.secondaryGroupElement = $<HTMLDivElement>('div.comet-editor-statusbar-group.comet-is-secondary');

    this.statusbarElement.append(
      this.primaryGroupElement,
      this.secondaryGroupElement,
    );
    this.container.replaceChildren(this.statusbarElement);
  }

  render(status: EditorStatusState) {
    this.statusbarElement.className = [
      'comet-editor-statusbar',
      `comet-is-pane-mode-${status.paneMode}`,
    ].join(' ');
    this.statusbarElement.setAttribute('aria-label', status.ariaLabel);
    renderStatusbarMode(status, {
      primaryGroupElement: this.primaryGroupElement,
      secondaryGroupElement: this.secondaryGroupElement,
      createTextElement,
      createStatusbarItemElement: item => createStatusbarItemElement(item, this.commandService),
    });
  }

  dispose() {
    this.container.replaceChildren();
    this.container.classList.remove('comet-statusbar-part');
  }
}

export default StatusbarPart;
