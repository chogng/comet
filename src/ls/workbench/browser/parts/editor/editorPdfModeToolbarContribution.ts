import type { ActionBarItem } from 'ls/base/browser/ui/actionbar/actionbar';
import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
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

const EDITOR_PDF_TOOLBAR_MORE_MENU_DATA = 'editor-pdf-toolbar-more';
const PDF_PAGINATION_LABEL = 'Pagination';
const PDF_HIGHLIGHT_LABEL = 'Highlight';
const PDF_TRANSLATE_LABEL = 'Translate';

export class EditorPdfModeToolbarContribution
implements EditorModeToolbarContribution {
  readonly mode = 'pdf' as const;

  private context: EditorModeToolbarContributionContext;
  private readonly element = createElement(
    'div',
    'editor-mode-toolbar editor-pdf-toolbar',
  );
  private readonly rowElement = createElement('div', 'editor-pdf-toolbar-row');
  private readonly leadingHost = createElement('div', 'editor-pdf-toolbar-leading');
  private readonly trailingHost = createElement('div', 'editor-pdf-toolbar-trailing');
  private readonly leadingActionsView = createActionBarView({
    className: 'editor-pdf-toolbar-actions',
    ariaRole: 'group',
  });
  private readonly trailingActionsView = createActionBarView({
    className: 'editor-pdf-toolbar-actions',
    ariaRole: 'group',
  });

  constructor(context: EditorModeToolbarContributionContext) {
    this.context = context;
    this.leadingHost.append(this.leadingActionsView.getElement());
    this.trailingHost.append(this.trailingActionsView.getElement());
    this.rowElement.append(this.leadingHost, this.trailingHost);
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
    this.leadingActionsView.dispose();
    this.trailingActionsView.dispose();
    this.element.replaceChildren();
  }

  private render() {
    this.leadingActionsView.setProps({
      className: 'editor-pdf-toolbar-actions',
      ariaRole: 'group',
      items: this.createLeadingItems(),
    });
    this.trailingActionsView.setProps({
      className: 'editor-pdf-toolbar-actions',
      ariaRole: 'group',
      items: this.createTrailingItems(),
    });
  }

  private createLeadingItems(): ActionBarItem[] {
    return [
      {
        label: this.context.labels.toolbarSources,
        title: this.context.labels.toolbarSources,
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon('list-unordered'),
        onClick: this.context.onOpenSources,
      },
      {
        label: 'Zoom out',
        title: 'Zoom out',
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon('remove'),
        onClick: () => {},
      },
      {
        label: 'Zoom in',
        title: 'Zoom in',
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon('add'),
        onClick: () => {},
      },
      {
        label: PDF_PAGINATION_LABEL,
        title: PDF_PAGINATION_LABEL,
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfPagination),
        onClick: () => {},
      },
      {
        label: PDF_HIGHLIGHT_LABEL,
        title: PDF_HIGHLIGHT_LABEL,
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfHighlight),
        onClick: () => {},
      },
      {
        label: PDF_TRANSLATE_LABEL,
        title: PDF_TRANSLATE_LABEL,
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfTranslate),
        onClick: () => {},
      },
    ];
  }

  private createTrailingItems(): ActionBarItem[] {
    return [
      {
        label: 'Search',
        title: 'Search',
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon('search'),
        onClick: () => {},
      },
      createDropdownMenuActionViewItem({
        label: this.context.labels.toolbarMore,
        title: this.context.labels.toolbarMore,
        mode: 'icon',
        buttonClassName: 'editor-pdf-toolbar-btn',
        content: createLxIcon('more'),
        overlayAlignment: 'end',
        menuData: EDITOR_PDF_TOOLBAR_MORE_MENU_DATA,
        menu: [
          {
            label: `${this.context.labels.pdfTitle} actions coming soon`,
            disabled: true,
          },
        ],
      }),
    ];
  }
}

export function createEditorPdfModeToolbarContribution(
  context: EditorModeToolbarContributionContext,
) {
  return new EditorPdfModeToolbarContribution(context);
}
