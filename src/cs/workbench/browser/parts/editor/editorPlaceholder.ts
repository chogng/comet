import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { $ } from 'cs/base/browser/dom';

// EditorPlaceholder owns pane-level empty/loading/error surfaces inside the editor area.
// Document-internal placeholders, such as the ProseMirror writing hint, stay with the editor itself.
export type EditorPlaceholderAction = {
  label: string;
  onRun: () => void;
  className?: string;
};

export type EditorPlaceholderProps = {
  className?: string;
  title: string;
  body: string;
  actions?: readonly EditorPlaceholderAction[];
};

export class EditorPlaceholder {
  private readonly container = $<HTMLElementTagNameMap['div']>('div.comet-editor-placeholder');
  private readonly bodyScrollContent = $<HTMLElementTagNameMap['div']>('div.comet-editor-placeholder-scroll-content');
  private readonly titleElement = $<HTMLElementTagNameMap['h2']>('h2.comet-editor-placeholder-title');
  private readonly bodyElement = $<HTMLElementTagNameMap['p']>('p.comet-editor-placeholder-body');
  private readonly actionsElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-placeholder-actions');
  private readonly scrollable: DomScrollableElement;

  constructor(props: EditorPlaceholderProps) {
    this.bodyScrollContent.append(
      this.titleElement,
      this.bodyElement,
      this.actionsElement,
    );
    this.scrollable = new DomScrollableElement(this.bodyScrollContent, {
      className: 'comet-editor-placeholder-scrollable',
      vertical: ScrollbarVisibility.Auto,
      horizontal: ScrollbarVisibility.Hidden,
      useShadows: false,
    });
    this.container.append(this.scrollable.getDomNode());
    this.setProps(props);
  }

  getElement() {
    return this.container;
  }

  setProps(props: EditorPlaceholderProps) {
    this.container.className = ['comet-editor-placeholder', props.className ?? '']
      .filter(Boolean)
      .join(' ');
    this.titleElement.textContent = props.title;
    this.bodyElement.textContent = props.body;
    this.actionsElement.replaceChildren(
      ...(props.actions ?? []).map((action) => {
        const button = $<HTMLElementTagNameMap['button']>('button', { class: [
						'comet-editor-placeholder-action-btn',
            'comet-btn-base',
            action.className ?? 'comet-btn-secondary comet-btn-md',
          ].join(' ') });
        button.type = 'button';
        button.textContent = action.label;
        button.addEventListener('click', action.onRun);
        return button;
      }),
    );
    this.actionsElement.hidden = (props.actions?.length ?? 0) === 0;
    this.scrollable.scanDomNode();
  }

  dispose() {
    this.scrollable.dispose();
    this.container.replaceChildren();
  }
}

export function createEditorPlaceholder(props: EditorPlaceholderProps) {
  return new EditorPlaceholder(props);
}

export default EditorPlaceholder;
