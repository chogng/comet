import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import { $ } from 'cs/base/browser/dom';
import { createLxIcon, type LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { CreateDraftEditorCommandId, CreatePdfEditorCommandId } from 'cs/workbench/common/editor/editorResources';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';

export type EditorEmptyWorkspaceViewProps = {
  labels: Pick<
    EditorPartLabels,
    | 'createDraft'
    | 'createBrowser'
    | 'createFile'
  >;
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
      this.createActionCard({
        label: props.labels.createDraft,
        icon: 'draft',
        onRun: () => {
          void this.commandService.executeCommand(CreateDraftEditorCommandId);
        },
      }),
      this.createActionCard({
        label: props.labels.createBrowser,
        icon: 'browser',
        onRun: () => {
          void this.commandService.executeCommand(BrowserViewCommandId.NewTab);
        },
      }),
      this.createActionCard({
        label: props.labels.createFile,
        icon: 'file-text',
        onRun: () => {
          void this.commandService.executeCommand(CreatePdfEditorCommandId);
        },
      }),
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
