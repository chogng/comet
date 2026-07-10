import {
  createActionBarView,
  type ActionBarItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';

export type EditorTitlebarActionsViewProps = {
  isEditorCollapsed: boolean;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  labels: Pick<
    EditorPartLabels,
    | 'headerAddAction'
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

export class EditorTitlebarActionsView {
  private props: EditorTitlebarActionsViewProps;
  private readonly actionsView = createActionBarView({
    className: 'comet-editor-titlebar-actionbar',
    ariaRole: 'group',
  });

  constructor(props: EditorTitlebarActionsViewProps) {
    this.props = props;
    this.render();
  }

  getElement() {
    return this.actionsView.getElement();
  }

  setProps(props: EditorTitlebarActionsViewProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.actionsView.dispose();
  }

  private render() {
    const actionItems: ActionBarItem[] = [
      createDropdownMenuActionViewItem({
        label: this.props.labels.headerAddAction,
        title: this.props.labels.headerAddAction,
        content: createLxIcon('add'),
        buttonClassName: 'comet-editor-titlebar-add-btn',
        overlayAlignment: 'end',
        menuData: 'editor-titlebar-add',
        menu: [
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
        ],
      }),
    ];
    if (this.props.showAgentSidebarToggle && this.props.onToggleAgentSidebar) {
      actionItems.push({
        label: this.props.agentSidebarToggleLabel ?? '',
        title: this.props.agentSidebarToggleLabel ?? '',
        mode: 'icon' as const,
        buttonClassName: 'comet-editor-titlebar-agent-btn',
        content: createLxIcon(
          this.props.isAgentSidebarVisible ? 'agent-filled' : 'agent',
        ),
        onClick: this.props.onToggleAgentSidebar,
      });
    }
    actionItems.push({
      id: 'toggleEditorCollapsed',
      label: this.props.isEditorCollapsed
        ? this.props.labels.expandEditor
        : this.props.labels.collapseEditor,
      title: this.props.isEditorCollapsed
        ? this.props.labels.expandEditor
        : this.props.labels.collapseEditor,
      mode: 'icon' as const,
      buttonClassName: 'comet-editor-titlebar-toggle-editor-btn',
      content: createLxIcon(
        this.props.isEditorCollapsed
          ? 'layout-sidebar-right-off'
          : 'layout-sidebar-right',
      ),
      onClick: this.props.onToggleEditorCollapse,
    });

    this.actionsView.setProps({
      className: 'comet-editor-titlebar-actionbar',
      ariaRole: 'group',
      items: actionItems,
    });
  }
}

export function createEditorTitlebarActionsView(props: EditorTitlebarActionsViewProps) {
  return new EditorTitlebarActionsView(props);
}
