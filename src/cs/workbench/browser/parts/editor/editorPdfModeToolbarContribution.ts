import type { ActionBarItem } from 'cs/base/browser/ui/actionbar/actionbar';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import type {
  EditorModeToolbarContribution,
  EditorModeToolbarContributionContext,
} from 'cs/workbench/browser/parts/editor/editorModeToolbarContribution';

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
const PDF_ERASE_LABEL = 'Erase';
const PDF_NOTE_LABEL = 'Note';

export class EditorPdfModeToolbarContribution
implements EditorModeToolbarContribution {
  readonly mode = 'pdf' as const;

  private context: EditorModeToolbarContributionContext;
  private readonly element = createElement(
    'div',
    'comet-editor-mode-toolbar comet-editor-pdf-toolbar',
  );
  private readonly rowElement = createElement('div', 'comet-editor-pdf-toolbar-row');
  private readonly leadingHost = createElement('div', 'comet-editor-pdf-toolbar-leading');
  private readonly trailingHost = createElement('div', 'comet-editor-pdf-toolbar-trailing');
  private readonly leadingActionsView = createActionBarView({
    className: 'comet-editor-pdf-toolbar-actions',
    ariaRole: 'group',
  });
  private readonly trailingActionsView = createActionBarView({
    className: 'comet-editor-pdf-toolbar-actions',
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
      className: 'comet-editor-pdf-toolbar-actions',
      ariaRole: 'group',
      items: this.createLeadingItems(),
    });
    this.trailingActionsView.setProps({
      className: 'comet-editor-pdf-toolbar-actions',
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
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon('list-unordered'),
        onClick: this.context.onOpenSources,
      },
      {
        label: 'Zoom out',
        title: 'Zoom out',
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon('remove'),
        onClick: () => {},
      },
      {
        label: 'Zoom in',
        title: 'Zoom in',
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon('add'),
        onClick: () => {},
      },
      {
        label: PDF_PAGINATION_LABEL,
        title: PDF_PAGINATION_LABEL,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfPagination),
        onClick: () => {},
      },
      {
        label: PDF_HIGHLIGHT_LABEL,
        title: PDF_HIGHLIGHT_LABEL,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfHighlight),
        onClick: this.context.onPdfHighlightSelection,
      },
      {
        label: PDF_TRANSLATE_LABEL,
        title: PDF_TRANSLATE_LABEL,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfTranslate),
        onClick: () => {},
      },
      {
        label: PDF_ERASE_LABEL,
        title: PDF_ERASE_LABEL,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfErase),
        onClick: () => {},
      },
      {
        label: PDF_NOTE_LABEL,
        title: PDF_NOTE_LABEL,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon(lxIconSemanticMap.editor.pdfNote),
        onClick: this.context.onPdfNoteSelection,
      },
    ];
  }

  private createTrailingItems(): ActionBarItem[] {
    return [
      {
        label: 'Search',
        title: 'Search',
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
        content: createLxIcon('search'),
        onClick: () => {},
      },
      createDropdownMenuActionViewItem({
        label: this.context.labels.toolbarMore,
        title: this.context.labels.toolbarMore,
        mode: 'icon',
        buttonClassName: 'comet-editor-pdf-toolbar-btn',
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
