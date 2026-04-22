import {
  createActionBarView,
  type ActionBarItem,
  type ActionBarMenuItem,
} from 'ls/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import { createFilterMenuHeader } from 'ls/base/browser/ui/dropdown/dropdownSearchHeader';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'ls/workbench/services/editor/common/editorOpenTypes';

const EDITOR_TOPBAR_ADD_MENU_DATA = 'editor-topbar-add';
const ADD_MENU_SEARCH_PLACEHOLDER = 'Search add actions';
const ADD_MENU_SEARCH_ARIA_LABEL = 'Search add actions';
const ADD_MENU_EMPTY_LABEL = 'No matching actions';

export type EditorTopbarActionsViewProps = {
  isEditorCollapsed: boolean;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  labels: Pick<
    EditorPartLabels,
    | 'topbarAddAction'
    | 'createDraft'
    | 'createBrowser'
    | 'createFile'
    | 'expandEditor'
    | 'collapseEditor'
  >;
  onOpenEditor: EditorOpenHandler;
  onToggleEditorCollapse: () => void;
  onToggleAgentSidebar?: () => void;
};

export class EditorTopbarActionsView {
  private props: EditorTopbarActionsViewProps;
  private readonly actionsView = createActionBarView({
    className: 'sidebar-topbar-actions',
    ariaRole: 'group',
  });

  constructor(props: EditorTopbarActionsViewProps) {
    this.props = props;
    this.render();
  }

  getElement() {
    return this.actionsView.getElement();
  }

  setProps(props: EditorTopbarActionsViewProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.actionsView.dispose();
  }

  private createAddMenuItems(query: string): ActionBarMenuItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    const allItems: ActionBarMenuItem[] = [
      {
        label: this.props.labels.createDraft,
        icon: 'draft',
        onClick: () => {
          void this.props.onOpenEditor({
            kind: 'draft',
            disposition: 'reveal-or-open',
          });
        },
      },
      {
        label: this.props.labels.createBrowser,
        icon: 'link-external',
        onClick: () => {
          void this.props.onOpenEditor({
            kind: 'browser',
            disposition: 'reveal-or-open',
          });
        },
      },
      {
        label: this.props.labels.createFile,
        icon: 'file-text',
        onClick: () => {
          void this.props.onOpenEditor({
            kind: 'pdf',
            disposition: 'reveal-or-open',
          });
        },
      },
    ];
    const filteredItems = normalizedQuery
      ? allItems.filter((item) =>
          item.label.toLowerCase().includes(normalizedQuery),
        )
      : allItems;

    if (filteredItems.length > 0) {
      return filteredItems;
    }

    return [
      {
        label: ADD_MENU_EMPTY_LABEL,
        disabled: true,
      },
    ];
  }

  private render() {
    const actionItems: ActionBarItem[] = [
      createDropdownMenuActionViewItem({
        label: this.props.labels.topbarAddAction,
        title: this.props.labels.topbarAddAction,
        content: createLxIcon('add'),
        buttonClassName: 'editor-topbar-add-btn',
        overlayAlignment: 'end',
        menuData: EDITOR_TOPBAR_ADD_MENU_DATA,
        menu: this.createAddMenuItems(''),
        menuHeader: createFilterMenuHeader({
          placeholder: ADD_MENU_SEARCH_PLACEHOLDER,
          ariaLabel: ADD_MENU_SEARCH_ARIA_LABEL,
          getMenuItems: (query) => this.createAddMenuItems(query),
        }),
      }),
    ];
    if (this.props.showAgentSidebarToggle && this.props.agentSidebarToggleLabel) {
      actionItems.push({
        label: this.props.agentSidebarToggleLabel,
        title: this.props.agentSidebarToggleLabel,
        mode: 'icon' as const,
        buttonClassName: 'editor-topbar-agent-btn',
        content: createLxIcon(
          this.props.isAgentSidebarVisible ? 'agent-filled' : 'agent',
        ),
        onClick: () => this.props.onToggleAgentSidebar?.(),
      });
    }
    actionItems.push({
      label: this.props.isEditorCollapsed
        ? this.props.labels.expandEditor
        : this.props.labels.collapseEditor,
      title: this.props.isEditorCollapsed
        ? this.props.labels.expandEditor
        : this.props.labels.collapseEditor,
      mode: 'icon' as const,
      buttonClassName: 'editor-topbar-toggle-editor-btn',
      content: createLxIcon(
        this.props.isEditorCollapsed
          ? 'layout-sidebar-right-off'
          : 'layout-sidebar-right',
      ),
      onClick: this.props.onToggleEditorCollapse,
    });

    this.actionsView.setProps({
      className: 'sidebar-topbar-actions',
      ariaRole: 'group',
      items: actionItems,
    });
  }
}

export function createEditorTopbarActionsView(props: EditorTopbarActionsViewProps) {
  return new EditorTopbarActionsView(props);
}
