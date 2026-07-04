import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import { EditorPlaceholder } from 'cs/workbench/browser/parts/editor/editorPlaceholder';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';

export type EditorEmptyWorkspaceViewProps = {
  labels: Pick<
    EditorPartLabels,
    | 'emptyWorkspaceTitle'
    | 'emptyWorkspaceBody'
    | 'createDraft'
    | 'createBrowser'
    | 'createFile'
  >;
  onOpenEditor: EditorOpenHandler;
};

export class EditorEmptyWorkspaceView {
  private readonly placeholder: EditorPlaceholder;
  private onOpenEditor: EditorOpenHandler;

  constructor(props: EditorEmptyWorkspaceViewProps) {
    this.onOpenEditor = props.onOpenEditor;
    this.placeholder = new EditorPlaceholder({
      className: 'comet-editor-empty-workspace',
      title: props.labels.emptyWorkspaceTitle,
      body: props.labels.emptyWorkspaceBody,
      actions: [],
    });
    this.setProps(props);
  }

  getElement() {
    return this.placeholder.getElement();
  }

  setProps(props: EditorEmptyWorkspaceViewProps) {
    this.onOpenEditor = props.onOpenEditor;
    this.placeholder.setProps({
      className: 'comet-editor-empty-workspace',
      title: props.labels.emptyWorkspaceTitle,
      body: props.labels.emptyWorkspaceBody,
      actions: [
        {
          label: props.labels.createDraft,
          onRun: () => {
            void this.onOpenEditor({
              kind: 'draft',
              disposition: 'reveal-or-open',
            });
          },
          className: 'comet-editor-workspace-action-btn comet-btn-secondary comet-btn-md',
        },
        {
          label: props.labels.createBrowser,
          onRun: () => {
            void this.onOpenEditor({
              kind: 'browser',
              disposition: 'reveal-or-open',
            });
          },
          className: 'comet-editor-workspace-action-btn comet-btn-secondary comet-btn-md',
        },
        {
          label: props.labels.createFile,
          onRun: () => {
            void this.onOpenEditor({
              kind: 'pdf',
              disposition: 'reveal-or-open',
            });
          },
          className: 'comet-editor-workspace-action-btn comet-btn-secondary comet-btn-md',
        },
      ],
    });
  }
}

export function createEditorEmptyWorkspaceView(props: EditorEmptyWorkspaceViewProps) {
  return new EditorEmptyWorkspaceView(props);
}

export default EditorEmptyWorkspaceView;
