import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { Sidebar } from 'cs/workbench/browser/parts/sidebar/sidebar';
import type { SidebarProps } from 'cs/workbench/browser/parts/sidebar/sidebar';
import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import { $ } from 'cs/base/browser/dom';

export type { SidebarLabels, SidebarProps } from 'cs/workbench/browser/parts/sidebar/sidebar';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export class SidebarPartView {
  private readonly element = $<HTMLElementTagNameMap['section']>('section', { class: [
      'comet-panel',
      'comet-sidebar-panel',
      'comet-sidebar-part-panel',
      `comet-sidebar-platform-${WINDOW_CHROME_LAYOUT.platform}`,
    ].join(' ') });
  private readonly bar: Sidebar;

  constructor(props: SidebarProps) {
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, this.element);
    this.bar = new Sidebar(props);
    this.element.append(this.bar.getElement());
  }

  getElement() {
    return this.element;
  }

  setProps(props: SidebarProps) {
    this.bar.setProps(props);
  }

  dispose() {
    this.bar.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, null);
    this.element.replaceChildren();
  }
}

export function createSidebarPartView(props: SidebarProps) {
  return new SidebarPartView(props);
}
