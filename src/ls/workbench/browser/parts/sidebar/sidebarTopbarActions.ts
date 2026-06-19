import { createActionBarView, type ActionBarItem } from 'ls/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';

import 'ls/workbench/browser/parts/sidebar/media/sidebarTopbarActions.css';

export type SidebarTopbarActionsProps = {
  isPrimarySidebarVisible?: boolean;
  primarySidebarToggleLabel?: string;
  addressBarLabel?: string;
  onTogglePrimarySidebar?: () => void;
  onFocusAddressBar?: () => void;
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

export class SidebarTopbarActionsView {
  private readonly actionBarView = createActionBarView({
    className: 'sidebar-topbar-actions',
    ariaRole: 'group',
  });
  private readonly hostElement = createElement('div', 'sidebar-topbar-actions-host');

  constructor(props?: SidebarTopbarActionsProps) {
    this.hostElement.append(this.actionBarView.getElement());
    if (props) {
      this.setProps(props);
    }
  }

  getElement() {
    return this.hostElement;
  }

  setProps(props: SidebarTopbarActionsProps) {
    const topbarItems: ActionBarItem[] = [];
    if (props.onTogglePrimarySidebar && props.primarySidebarToggleLabel) {
      topbarItems.push({
        label: props.primarySidebarToggleLabel,
        title: props.primarySidebarToggleLabel,
        mode: 'icon',
        buttonClassName: 'sidebar-topbar-toggle-btn',
        content: createLxIcon(
          props.isPrimarySidebarVisible === false
            ? 'layout-sidebar-left-off'
            : 'layout-sidebar-left',
        ),
        onClick: () => props.onTogglePrimarySidebar?.(),
      });
    }
    if (props.addressBarLabel) {
      topbarItems.push({
        label: props.addressBarLabel,
        title: props.addressBarLabel,
        mode: 'icon',
        buttonClassName: 'sidebar-topbar-search-btn',
        content: createLxIcon('search'),
        onClick: () => props.onFocusAddressBar?.(),
      });
    }

    this.actionBarView.setProps({
      className: 'sidebar-topbar-actions',
      ariaRole: 'group',
      items: topbarItems,
    });
  }

  dispose() {
    this.actionBarView.dispose();
    this.hostElement.replaceChildren();
  }
}
