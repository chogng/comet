import type {
  EditorModeToolbarContribution,
  EditorModeToolbarContributionContext,
} from 'ls/workbench/browser/parts/editor/editorModeToolbarContribution';

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

export class EditorPdfModeToolbarContribution
implements EditorModeToolbarContribution {
  readonly mode = 'pdf' as const;

  private context: EditorModeToolbarContributionContext;
  private readonly element = createElement(
    'div',
    'editor-mode-toolbar editor-pdf-toolbar',
  );
  private readonly rowElement = createElement('div', 'editor-pdf-toolbar-row');
  private readonly placeholderElement = createElement(
    'span',
    'editor-pdf-toolbar-placeholder',
  );

  constructor(context: EditorModeToolbarContributionContext) {
    this.context = context;
    this.rowElement.append(this.placeholderElement);
    this.element.append(this.rowElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  setContext(context: EditorModeToolbarContributionContext) {
    this.context = context;
    this.render();
  }

  dispose() {
    this.element.replaceChildren();
  }

  private render() {
    this.placeholderElement.textContent = `${this.context.labels.pdfTitle} toolbar coming soon`;
  }
}

export function createEditorPdfModeToolbarContribution(
  context: EditorModeToolbarContributionContext,
) {
  return new EditorPdfModeToolbarContribution(context);
}
