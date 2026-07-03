import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'ls/workbench/browser/layout';
import { Sidebar } from 'ls/workbench/browser/parts/sidebar/sidebar';
import type { SidebarProps } from 'ls/workbench/browser/parts/sidebar/sidebar';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';

export type { SidebarLabels, SidebarProps } from 'ls/workbench/browser/parts/sidebar/sidebar';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

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

export class SidebarPartView {
  private readonly element = createElement(
    'section',
    [
      'panel',
      'sidebar-panel',
      'sidebar-part-panel',
      `sidebar-platform-${WINDOW_CHROME_LAYOUT.platform}`,
    ].join(' '),
  );
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
