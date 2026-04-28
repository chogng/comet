import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';

import 'ls/workbench/browser/parts/primarybar/media/primarybarFooterActions.css';

const MORE_ACTIONS_LABEL = 'More';
const MORE_LAYOUT_LABEL = 'Layout';
const MORE_LAYOUT_AGENT_LABEL = 'Agent';
const MORE_LAYOUT_FLOW_LABEL = 'Flow';

export type PrimaryBarFooterLayoutMode = 'agent' | 'flow';

export type PrimaryBarFooterActionsProps = {
  accountLabel?: string;
  moreLabel?: string;
  settingsLabel?: string;
  isSettingsActive?: boolean;
  activeLayoutMode?: PrimaryBarFooterLayoutMode | null;
  onApplyLayoutAgent?: () => void;
  onApplyLayoutFlow?: () => void;
  onOpenSettings?: () => void;
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

export class PrimaryBarFooterActionsView {
  private readonly hostElement = createElement(
    'div',
    'primarybar-footer-actions-host',
  );
  private readonly accountElement = createElement(
    'div',
    'primarybar-footer-account',
  );
  private readonly avatarElement = createElement(
    'div',
    'primarybar-footer-avatar',
  );
  private readonly accountLabelElement = createElement(
    'span',
    'primarybar-footer-account-label',
  );
  private readonly actionBarView = createActionBarView({
    className: 'primarybar-footer-actions',
    ariaRole: 'group',
  });

  constructor(props?: PrimaryBarFooterActionsProps) {
    this.avatarElement.append(createLxIcon('account'));
    this.accountElement.append(this.avatarElement, this.accountLabelElement);
    this.hostElement.append(this.accountElement, this.actionBarView.getElement());
    if (props) {
      this.setProps(props);
    }
  }

  getElement() {
    return this.hostElement;
  }

  setProps(props: PrimaryBarFooterActionsProps) {
    this.accountLabelElement.textContent = props.accountLabel?.trim() || '';
    const moreLabel = props.moreLabel?.trim() || MORE_ACTIONS_LABEL;
    this.actionBarView.setProps({
      className: 'primarybar-footer-actions',
      ariaRole: 'group',
      items: [
        createDropdownMenuActionViewItem({
          label: moreLabel,
          title: moreLabel,
          mode: 'icon',
          buttonClassName: 'primarybar-footer-more-btn',
          content: createLxIcon('more-2'),
          menuClassName: 'primarybar-footer-more-menu-overlay',
          minWidth: 160,
          menuData: 'primarybar-footer-more',
          menu: [
            {
              id: 'primarybar-footer-more-layout',
              label: MORE_LAYOUT_LABEL,
              icon: 'layout',
              submenu: [
                {
                  id: 'primarybar-footer-more-layout-agent',
                  label: MORE_LAYOUT_AGENT_LABEL,
                  checked: props.activeLayoutMode === 'agent',
                  onClick: () => {
                    props.onApplyLayoutAgent?.();
                  },
                },
                {
                  id: 'primarybar-footer-more-layout-flow',
                  label: MORE_LAYOUT_FLOW_LABEL,
                  checked: props.activeLayoutMode === 'flow',
                  onClick: () => {
                    props.onApplyLayoutFlow?.();
                  },
                },
              ],
            },
          ],
        }),
        {
          label: props.settingsLabel ?? '',
          title: props.settingsLabel ?? '',
          mode: 'icon',
          active: props.isSettingsActive === true,
          buttonClassName: 'primarybar-footer-settings-btn',
          content: createLxIcon('gear'),
          onClick: () => props.onOpenSettings?.(),
        },
      ],
    });
  }

  dispose() {
    this.actionBarView.dispose();
    this.hostElement.replaceChildren();
  }
}
