import type { ActionBarItem } from 'cs/base/browser/ui/actionbar/actionbar';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { $ } from 'cs/base/browser/dom';
const EDITOR_PDF_TOOLBAR_MORE_MENU_DATA = 'editor-pdf-toolbar-more';
const PDF_PAGINATION_LABEL = 'Pagination';
const PDF_HIGHLIGHT_LABEL = 'Highlight';
const PDF_TRANSLATE_LABEL = 'Translate';
const PDF_ERASE_LABEL = 'Erase';
const PDF_NOTE_LABEL = 'Note';

export type PdfEditorToolbarContext = {
  readonly labels: {
    readonly toolbarSources: string;
    readonly toolbarMore: string;
    readonly pdfTitle: string;
  };
  readonly sourcesDisabled: boolean;
  readonly onOpenSources: () => void;
  readonly onHighlightSelection: () => void;
  readonly onNoteSelection: () => void;
};

export class EditorPdfModeToolbarContribution {

  private context: PdfEditorToolbarContext;
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-editor-mode-toolbar.comet-editor-pdf-toolbar');
  private readonly rowElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-pdf-toolbar-row');
  private readonly leadingHost = $<HTMLElementTagNameMap['div']>('div.comet-editor-pdf-toolbar-leading');
  private readonly trailingHost = $<HTMLElementTagNameMap['div']>('div.comet-editor-pdf-toolbar-trailing');
  private readonly leadingActionsView = createActionBarView({
    className: 'comet-editor-pdf-toolbar-actions',
    ariaRole: 'group',
  });
  private readonly trailingActionsView = createActionBarView({
    className: 'comet-editor-pdf-toolbar-actions',
    ariaRole: 'group',
  });

  constructor(
    context: PdfEditorToolbarContext,
    private readonly dropdownServices: DropdownContextServices,
  ) {
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

  setContext(context: PdfEditorToolbarContext) {
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
		disabled: this.context.sourcesDisabled,
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
        onClick: this.context.onHighlightSelection,
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
        onClick: this.context.onNoteSelection,
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
        ...this.dropdownServices,
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
  context: PdfEditorToolbarContext,
  dropdownServices: DropdownContextServices,
) {
  return new EditorPdfModeToolbarContribution(context, dropdownServices);
}
