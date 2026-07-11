import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/browser/parts/sidebar/media/sidebarFooterActions.css';

const MORE_ACTIONS_LABEL = 'More';
const MORE_LAYOUT_LABEL = 'Layout';
const MORE_LAYOUT_AGENT_LABEL = 'Agent';
const MORE_LAYOUT_FLOW_LABEL = 'Flow';

export type SidebarFooterLayoutMode = 'agent' | 'flow';

export type SidebarFooterActionsProps = {
  accountLabel?: string;
  moreLabel?: string;
  settingsLabel?: string;
  isSettingsActive?: boolean;
  activeLayoutMode?: SidebarFooterLayoutMode | null;
  onApplyLayoutAgent?: () => void;
  onApplyLayoutFlow?: () => void;
  onOpenSettings?: () => void;
};

export class SidebarFooterActionsView {
  private readonly hostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-actions-host');
  private readonly accountElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-account');
  private readonly avatarElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-avatar');
  private readonly accountLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-footer-account-label');
  private readonly actionBarView = createActionBarView({
    className: 'comet-sidebar-footer-actions',
    ariaRole: 'group',
  });

  constructor(
    private readonly dropdownServices: DropdownContextServices,
    props?: SidebarFooterActionsProps,
  ) {
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

  setProps(props: SidebarFooterActionsProps) {
    this.accountLabelElement.textContent = props.accountLabel?.trim() || '';
    const moreLabel = props.moreLabel?.trim() || MORE_ACTIONS_LABEL;
    this.actionBarView.setProps({
      className: 'comet-sidebar-footer-actions',
      ariaRole: 'group',
      items: [
        createDropdownMenuActionViewItem({
          ...this.dropdownServices,
          label: moreLabel,
          title: moreLabel,
          mode: 'icon',
          buttonClassName: 'comet-sidebar-footer-more-btn',
          content: createLxIcon('more-2'),
          menuClassName: 'comet-sidebar-footer-more-menu-overlay',
          minWidth: 160,
          menuData: 'comet-sidebar-footer-more',
          menu: [
            {
              id: 'comet-sidebar-footer-more-layout',
              label: MORE_LAYOUT_LABEL,
              icon: 'layout',
              submenu: [
                {
                  id: 'comet-sidebar-footer-more-layout-agent',
                  label: MORE_LAYOUT_AGENT_LABEL,
                  checked: props.activeLayoutMode === 'agent',
                  onClick: () => {
                    props.onApplyLayoutAgent?.();
                  },
                },
                {
                  id: 'comet-sidebar-footer-more-layout-flow',
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
          buttonClassName: 'comet-sidebar-footer-settings-btn',
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
