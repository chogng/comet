import { $ } from 'cs/base/browser/dom';
import { createLxIcon, type LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import type { EditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';

export type EditorEmptyWorkspaceViewProps = {
  creationActions: readonly EditorCreationAction[];
  commandService: IWorkbenchCommandService;
};

export class EditorEmptyWorkspaceView {
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-editor-empty-workspace');
  private readonly actionsElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-empty-workspace-actions');
  private commandService: IWorkbenchCommandService;

  constructor(props: EditorEmptyWorkspaceViewProps) {
    this.commandService = props.commandService;
    this.element.append(this.actionsElement);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: EditorEmptyWorkspaceViewProps) {
    this.commandService = props.commandService;
    this.actionsElement.replaceChildren(
			...props.creationActions.map(action => this.createActionCard({
				label: action.label,
				icon: action.icon,
				onRun: () => {
					void this.commandService.executeCommand(action.commandId);
				},
			})),
    );
  }

  private createActionCard(options: {
    label: string;
    icon: LxIconName;
    onRun: () => void;
  }) {
    const button = $<HTMLElementTagNameMap['button']>('button.comet-editor-empty-workspace-action');
    const label = $<HTMLElementTagNameMap['span']>('span.comet-editor-empty-workspace-action-label');

    button.type = 'button';
    button.append(createLxIcon(options.icon, 'comet-editor-empty-workspace-action-icon'), label);
    label.textContent = options.label;
    button.setAttribute('aria-label', options.label);
    button.addEventListener('click', options.onRun);

    return button;
  }
}

export function createEditorEmptyWorkspaceView(props: EditorEmptyWorkspaceViewProps) {
  return new EditorEmptyWorkspaceView(props);
}

export default EditorEmptyWorkspaceView;
