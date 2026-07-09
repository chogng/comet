import {
  createActionBarView,
  type ActionBarItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';

export type EditorTitlebarActionsViewProps = {
  isEditorCollapsed: boolean;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  labels: Pick<
    EditorPartLabels,
    | 'expandEditor'
    | 'collapseEditor'
  >;
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
    const actionItems: ActionBarItem[] = [];
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
