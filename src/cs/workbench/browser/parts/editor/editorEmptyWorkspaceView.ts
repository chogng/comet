import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';
import { $ } from 'cs/base/browser/dom';
import { createLxIcon, type LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';

export type EditorEmptyWorkspaceViewProps = {
  labels: Pick<
    EditorPartLabels,
    | 'createDraft'
    | 'createBrowser'
    | 'createFile'
  >;
  onOpenEditor: EditorOpenHandler;
};

export class EditorEmptyWorkspaceView {
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-editor-empty-workspace');
  private readonly actionsElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-empty-workspace-actions');
  private onOpenEditor: EditorOpenHandler;

  constructor(props: EditorEmptyWorkspaceViewProps) {
    this.onOpenEditor = props.onOpenEditor;
    this.element.append(this.actionsElement);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: EditorEmptyWorkspaceViewProps) {
    this.onOpenEditor = props.onOpenEditor;
    this.actionsElement.replaceChildren(
      this.createActionCard({
        label: props.labels.createDraft,
        icon: 'draft',
        onRun: () => {
          void this.onOpenEditor({
            kind: 'draft',
            disposition: 'new-tab',
          });
        },
      }),
      this.createActionCard({
        label: props.labels.createBrowser,
        icon: 'browser',
        onRun: () => {
          void this.onOpenEditor({
            kind: 'browser',
            disposition: 'reveal-or-open',
          });
        },
      }),
      this.createActionCard({
        label: props.labels.createFile,
        icon: 'file-text',
        onRun: () => {
          void this.onOpenEditor({
            kind: 'pdf',
            disposition: 'reveal-or-open',
          });
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
