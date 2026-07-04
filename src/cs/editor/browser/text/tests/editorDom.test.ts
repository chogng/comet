import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { createEmptyWritingEditorDocument, createWritingEditorDocumentFromPlainText, writingEditorDocumentToPlainText } from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { getEditorDraftStyleCatalogSnapshot } from 'cs/editor/browser/text/editorDraftStyleCatalog';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let ProseMirrorEditor: typeof import('cs/editor/browser/text/editor').ProseMirrorEditor;
let DraftEditorToolbar: typeof import('cs/editor/browser/text/editorToolbar').DraftEditorToolbar;
let TextSelection: typeof import('prosemirror-state').TextSelection;
let DomScrollableElement: typeof import('cs/base/browser/ui/scrollbar/scrollableElement').DomScrollableElement;
let cleanupDomEnvironment: (() => void) | null = null;

const labels = {
  toolbarMore: 'More',
  textGroup: 'Text',
  formatGroup: 'Format',
  insertGroup: 'Insert',
  historyGroup: 'History',
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  fontFamily: 'Font',
  fontSize: 'Size',
  defaultTextStyle: 'Default',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  clearInlineStyles: 'Clear styles',
  bulletList: 'Bullets',
  orderedList: 'Numbers',
  blockquote: 'Quote',
  undo: 'Undo',
  redo: 'Redo',
  insertCitation: 'Citation',
  insertFigure: 'Figure',
  insertFigureRef: 'Figure Ref',
  citationPrompt: 'Citation',
  figureUrlPrompt: 'Figure URL',
  figureCaptionPrompt: 'Figure caption',
  figureRefPrompt: 'Figure ref',
  fontFamilyPrompt: 'Font family',
  fontSizePrompt: 'Font size',
};

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ ProseMirrorEditor } = await import('cs/editor/browser/text/editor'));
  ({ DraftEditorToolbar } = await import('cs/editor/browser/text/editorToolbar'));
  ({ TextSelection } = await import('prosemirror-state'));
  ({ DomScrollableElement } = await import('cs/base/browser/ui/scrollbar/scrollableElement'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createProps(
  document: WritingEditorDocument,
  onDocumentChange: (nextDocument: WritingEditorDocument) => void,
): import('cs/editor/browser/text/editor').WritingEditorSurfaceProps {
  return {
    document,
    placeholder: 'Write here',
    labels,
    statusLabels: {
      blockFigure: 'Figure',
    },
    onInsertCitation: () => {},
    onInsertFigure: () => {},
    onInsertFigureRef: () => {},
    onDocumentChange,
  };
}

function getEditableRoot(editor: InstanceType<typeof ProseMirrorEditor>) {
  const element = editor.getElement().querySelector('.ProseMirror');
  assert(element instanceof HTMLElement, 'Editable root was not rendered.');
  return element;
}

function getEditorText(editor: InstanceType<typeof ProseMirrorEditor>) {
  return (getEditableRoot(editor).textContent ?? '').replace(/\u200b/g, '').trim();
}

function getPlaceholderNode(editor: InstanceType<typeof ProseMirrorEditor>) {
  const element = editor.getElement().querySelector('.comet-pm-empty-paragraph');
  assert(element instanceof HTMLElement, 'Placeholder node was not rendered.');
  return element;
}

function getScrollableRoot(editor: InstanceType<typeof ProseMirrorEditor>) {
  const element = editor.getElement().querySelector('.comet-scrollable-element-root');
  assert(element instanceof HTMLElement, 'Scrollable root was not rendered.');
  return element;
}

function getLatestFigureWidth(document: WritingEditorDocument) {
  const figureNode = document.content?.find((node) => node.type === 'figure');
  assert(figureNode, 'Figure node was not found in the document.');
  return figureNode.attrs?.width;
}

function getToolbarButton(editor: InstanceType<typeof ProseMirrorEditor>, label: string) {
  const toolbarRoot = editor.getToolbarElement();
  const button = Array.from(toolbarRoot.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  assert(button instanceof HTMLButtonElement, `Toolbar button "${label}" was not found.`);
  return button;
}

function createCompositionEvent(type: 'compositionstart' | 'compositionend', data = '') {
  if (typeof CompositionEvent === 'function') {
    return new CompositionEvent(type, {
      bubbles: true,
      cancelable: true,
      data,
    });
  }

  return new Event(type, {
    bubbles: true,
    cancelable: true,
  });
}

function createDragPointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
) {
  const pointerEventConstructor = (
    window as Window & {
      PointerEvent?: typeof PointerEvent;
    }
  ).PointerEvent;

  if (typeof pointerEventConstructor === 'function') {
    return new pointerEventConstructor(type, {
      bubbles: true,
      clientX,
      pointerId: 1,
      pointerType: 'mouse',
    });
  }

  const fallbackType =
    type === 'pointerdown'
      ? 'mousedown'
      : type === 'pointermove'
        ? 'mousemove'
        : 'mouseup';
  return new MouseEvent(fallbackType, {
    bubbles: true,
    clientX,
  });
}

async function withEditor(
  run: (params: {
    editor: InstanceType<typeof ProseMirrorEditor>;
    changes: WritingEditorDocument[];
  }) => Promise<void> | void,
  initialDocument = createEmptyWritingEditorDocument(),
) {
  const changes: WritingEditorDocument[] = [];
  const editor = new ProseMirrorEditor(
    createProps(initialDocument, (nextDocument) => {
      changes.push(nextDocument);
    }),
  );

  document.body.append(editor.getElement());

  try {
    await run({ editor, changes });
  } finally {
    editor.dispose();
    document.body.replaceChildren();
  }
}

test('ProseMirrorEditor preserves the local DOM when stale props arrive before the model echo', async () => {
  await withEditor(({ editor, changes }) => {
    const initialDocument = createEmptyWritingEditorDocument();

    assert.equal(editor.insertPlainText('hello world'), true);
    assert.equal(changes.length, 1);
    assert.equal(writingEditorDocumentToPlainText(changes[0]), 'hello world');

    editor.setProps(createProps(initialDocument, (nextDocument) => {
      changes.push(nextDocument);
    }));

    assert.match(getEditorText(editor), /hello world/);
    assert.equal(changes.length, 1);
  });
});

test('ProseMirrorEditor defers document emission until compositionend', async () => {
  await withEditor(async ({ editor, changes }) => {
    const editableRoot = getEditableRoot(editor);

    editableRoot.dispatchEvent(createCompositionEvent('compositionstart'));
    assert.equal(editor.insertPlainText('你'), true);
    assert.equal(changes.length, 0);

    editableRoot.dispatchEvent(createCompositionEvent('compositionend', '你'));
    await delay(20);

    assert.equal(changes.length, 1);
    assert.equal(writingEditorDocumentToPlainText(changes[0]), '你');
  });
});

test('ProseMirrorEditor keeps composed text when stale props land during composition', async () => {
  await withEditor(async ({ editor, changes }) => {
    const editableRoot = getEditableRoot(editor);
    const initialDocument = createEmptyWritingEditorDocument();

    editableRoot.dispatchEvent(createCompositionEvent('compositionstart'));
    assert.equal(editor.insertPlainText('你好'), true);

    editor.setProps(createProps(initialDocument, (nextDocument) => {
      changes.push(nextDocument);
    }));

    assert.match(getEditorText(editor), /你好/);
    assert.equal(changes.length, 0);

    editableRoot.dispatchEvent(createCompositionEvent('compositionend', '你好'));
    await delay(20);

    assert.equal(changes.length, 1);
    assert.equal(writingEditorDocumentToPlainText(changes[0]), '你好');
  });
});

test('ProseMirrorEditor writes resized figure widths back to the document', async () => {
  await withEditor(({ editor, changes }) => {
    assert.equal(
      editor.insertFigure({
        src: 'https://example.com/figure.png',
        caption: 'Figure caption',
        width: 220,
      }),
      true,
    );
    assert.equal(changes.length, 1);
    assert.equal(getLatestFigureWidth(changes[0]), 220);

    const resizeHandle = editor.getElement().querySelector('.comet-pm-resizable-handle');
    assert(resizeHandle instanceof HTMLElement, 'Figure resize handle was not rendered.');

    resizeHandle.dispatchEvent(
      createDragPointerEvent('pointerdown', 220),
    );
    window.dispatchEvent(createDragPointerEvent('pointermove', 300));
    window.dispatchEvent(createDragPointerEvent('pointerup', 300));

    assert.equal(changes.length, 2);
    assert.equal(getLatestFigureWidth(changes[1]), 300);
  });
});

test('ProseMirrorEditor updates placeholder text without emitting a document change', async () => {
  const initialDocument = createEmptyWritingEditorDocument();

  await withEditor(({ editor, changes }) => {
    const placeholderBefore = getPlaceholderNode(editor);
    assert.equal(placeholderBefore.getAttribute('data-placeholder'), 'Write here');

    const nextProps = createProps(initialDocument, (nextDocument) => {
      changes.push(nextDocument);
    });
    nextProps.placeholder = 'Continue writing';
    editor.setProps(nextProps);

    const placeholderAfter = getPlaceholderNode(editor);
    assert.equal(placeholderAfter.getAttribute('data-placeholder'), 'Continue writing');
    assert.equal(changes.length, 0);
  }, initialDocument);
});

test('DraftEditorToolbar shows preset font labels for normalized browser font-family values', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: 'Times New Roman, Times, serif',
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const fontFamilyPrimary = Array.from(
      toolbar.getElement().querySelectorAll<HTMLButtonElement>(
        '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
      ),
    ).find((candidate) => candidate.getAttribute('aria-label') === 'Times New Roman');
    assert(fontFamilyPrimary instanceof HTMLButtonElement);
    assert.equal(fontFamilyPrimary.textContent?.trim(), 'Times New Roman');
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar shows Chinese named font-size presets for matching px values', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: '16px',
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const fontSizePrimary = Array.from(
      toolbar.getElement().querySelectorAll<HTMLButtonElement>(
        '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
      ),
    ).find((candidate) => candidate.getAttribute('aria-label') === '小四');
    assert(fontSizePrimary instanceof HTMLButtonElement);
    assert.equal(fontSizePrimary.textContent?.trim(), '小四');
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar orders Chinese named font-size presets from large to small', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const fontSizePrimary = Array.from(
      toolbar.getElement().querySelectorAll<HTMLButtonElement>(
        '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
      ),
    ).find((candidate) => candidate.getAttribute('aria-label') === '五号');
    assert(fontSizePrimary instanceof HTMLButtonElement);
    assert.equal(fontSizePrimary.textContent?.trim(), '五号');

    const splitDropdowns = toolbar.getElement().querySelectorAll('.comet-editor-draft-toolbar-split-dropdown');
    const fontSizeDropdown = Array.from(splitDropdowns).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.fontSize,
    );
    assert(fontSizeDropdown instanceof HTMLElement);
    fontSizeDropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'draft-toolbar-split');

    const menuItems = Array.from(document.body.querySelectorAll('.comet-dropdown-menu-item'));
    const menuItemLabels = menuItems
      .map((item) => item.textContent?.trim())
      .filter((value): value is string => Boolean(value));

    assert.equal(menuItemLabels.includes('Default'), false);
    assert.deepEqual(menuItemLabels.slice(0, 4), ['初号', '小初', '一号', '小一']);
    assert.deepEqual(menuItemLabels.slice(-4), ['五号', '小五', '六号', '小六']);
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('ProseMirrorEditor syncs default body style from editorDraftStyleService', async () => {
  editorDraftStyleService.resetToCatalog();
  const catalogSnapshot = getEditorDraftStyleCatalogSnapshot();
  const updatedSnapshot = {
    ...catalogSnapshot,
    defaultBodyStyle: {
      ...catalogSnapshot.defaultBodyStyle,
      fontFamilyValue: '"Times New Roman", Times, serif',
      fontSizeValue: '16px',
      lineHeight: 1.6,
      paragraphSpacingBeforePt: 12,
      paragraphSpacingAfterPt: 8,
      color: '#112233',
    },
  };

  try {
    await withEditor(({ editor }) => {
      const editorRoot = editor.getElement().querySelector('.comet-pm-editor-root');
      assert(editorRoot instanceof HTMLElement);
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-font-family').trim(),
        catalogSnapshot.defaultBodyStyle.fontFamilyValue,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-font-size').trim(),
        catalogSnapshot.defaultBodyStyle.fontSizeValue,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-line-height').trim(),
        String(catalogSnapshot.defaultBodyStyle.lineHeight),
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-color').trim(),
        catalogSnapshot.defaultBodyStyle.color,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-before').trim(),
        `${catalogSnapshot.defaultBodyStyle.paragraphSpacingBeforePt}pt`,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-after').trim(),
        `${catalogSnapshot.defaultBodyStyle.paragraphSpacingAfterPt}pt`,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-between').trim(),
        `${Math.max(
          catalogSnapshot.defaultBodyStyle.paragraphSpacingBeforePt,
          catalogSnapshot.defaultBodyStyle.paragraphSpacingAfterPt,
        )}pt`,
      );

      editorDraftStyleService.setSnapshot(updatedSnapshot);

      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-font-family').trim(),
        updatedSnapshot.defaultBodyStyle.fontFamilyValue,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-font-size').trim(),
        updatedSnapshot.defaultBodyStyle.fontSizeValue,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-line-height').trim(),
        String(updatedSnapshot.defaultBodyStyle.lineHeight),
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-color').trim(),
        updatedSnapshot.defaultBodyStyle.color,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-before').trim(),
        `${updatedSnapshot.defaultBodyStyle.paragraphSpacingBeforePt}pt`,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-after').trim(),
        `${updatedSnapshot.defaultBodyStyle.paragraphSpacingAfterPt}pt`,
      );
      assert.equal(
        editorRoot.style.getPropertyValue('--cs-editor-default-paragraph-spacing-between').trim(),
        `${Math.max(
          updatedSnapshot.defaultBodyStyle.paragraphSpacingBeforePt,
          updatedSnapshot.defaultBodyStyle.paragraphSpacingAfterPt,
        )}pt`,
      );

      const fontSizePrimary = Array.from(
        editor.getToolbarElement().querySelectorAll<HTMLButtonElement>(
          '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
        ),
      ).find(
        (candidate) => candidate.getAttribute('aria-label') === '小四',
      );
      assert(fontSizePrimary instanceof HTMLButtonElement);
      assert.equal(fontSizePrimary.textContent?.trim(), '小四');
    });
  } finally {
    editorDraftStyleService.resetToCatalog();
  }
});

test('DraftEditorToolbar uses DengXian as the implicit default font and hides Default menu item', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const fontFamilyPrimary = Array.from(
      toolbar.getElement().querySelectorAll<HTMLButtonElement>(
        '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
      ),
    ).find((candidate) => candidate.getAttribute('aria-label') === '等线');
    assert(fontFamilyPrimary instanceof HTMLButtonElement);
    assert.equal(fontFamilyPrimary.textContent?.trim(), '等线');

    const splitDropdowns = toolbar.getElement().querySelectorAll('.comet-editor-draft-toolbar-split-dropdown');
    const fontFamilyDropdown = Array.from(splitDropdowns).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.fontFamily,
    );
    assert(fontFamilyDropdown instanceof HTMLElement);
    fontFamilyDropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menuItems = Array.from(document.body.querySelectorAll('.comet-dropdown-menu-item'));
    const menuItemLabels = menuItems
      .map((item) => item.textContent?.trim())
      .filter((value): value is string => Boolean(value));

    assert.equal(menuItemLabels.includes('Default'), false);
    assert.equal(menuItemLabels.includes('等线'), true);
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar marks unavailable preset fonts in the dropdown', () => {
  const originalFonts = (
    document as Document & {
      fonts?: {
        check?: (font: string, text?: string) => boolean;
      };
    }
  ).fonts;

  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      check: (font: string) => !font.includes('"宋体"'),
    },
  });

  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const splitDropdowns = toolbar.getElement().querySelectorAll('.comet-editor-draft-toolbar-split-dropdown');
    const fontFamilyDropdown = Array.from(splitDropdowns).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.fontFamily,
    );
    assert(fontFamilyDropdown instanceof HTMLElement);
    fontFamilyDropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menuItems = Array.from(document.body.querySelectorAll('.comet-dropdown-menu-item'));
    const unavailableSongti = menuItems.find((item) => item.textContent?.includes('宋体 (未安装)'));

    assert(unavailableSongti instanceof HTMLElement);
    assert.equal(unavailableSongti.classList.contains('disabled'), true);
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: originalFonts,
    });
  }
});

test('DraftEditorToolbar disables figure-ref action when no figures are available', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const moreButton = Array.from(toolbar.getElement().querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.toolbarMore,
    );
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'draft-toolbar-overflow');
    const menuItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (candidate) => candidate.textContent?.includes(labels.insertFigureRef),
    );
    assert(menuItem instanceof HTMLElement);
    assert.equal(menuItem.classList.contains('disabled'), true);
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar opens the more menu and dispatches overflow actions', async () => {
  const calls: string[] = [];
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: true,
      canRedo: true,
      availableFigureIds: ['figure_1'],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {
        calls.push('clear');
      },
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {
        calls.push('blockquote');
      },
      undo: () => {
        calls.push('undo');
      },
      redo: () => {
        calls.push('redo');
      },
      insertCitation: () => {
        calls.push('citation');
      },
      insertFigure: () => {},
      insertFigureRef: () => {
        calls.push('figureRef');
      },
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const moreButton = toolbar.getElement().querySelector('[aria-label="More"]');
    assert(moreButton instanceof HTMLElement);

    for (const [label, call] of [
      ['Clear styles', 'clear'],
      ['Citation', 'citation'],
      ['Quote', 'blockquote'],
      ['Figure Ref', 'figureRef'],
      ['Undo', 'undo'],
      ['Redo', 'redo'],
    ] as const) {
      moreButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const menu = document.body.querySelector('.comet-dropdown-menu');
      assert(menu instanceof HTMLElement);
      const menuItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
        (node) => node.textContent?.includes(label),
      );
      assert(menuItem instanceof HTMLElement);
      menuItem.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(calls.at(-1), call);
    }
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar renders draft-specific toolbar content classes', () => {
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: () => {},
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const toolbarElement = toolbar.getElement();
    const toolbarContent = toolbarElement.querySelector(
      ':scope > .comet-editor-draft-toolbar-content',
    );
    const toolbarGroup = toolbarElement.querySelector(
      '.comet-editor-draft-toolbar-content > .comet-actionbar.comet-editor-draft-toolbar-group',
    );
    const toolbarMore = toolbarElement.querySelector(
      ':scope > .comet-editor-draft-toolbar-trailing .comet-editor-draft-toolbar-more',
    );
    const toolbarAction = toolbarElement.querySelector(
      '.comet-editor-draft-toolbar-group .comet-editor-draft-toolbar-btn.comet-actionbar-action',
    );
    const textStylePrimary = toolbarElement.querySelector(
      '.comet-editor-draft-toolbar-split .comet-editor-draft-toolbar-split-primary.comet-actionbar-action',
    );
    const textStyleDropdown = toolbarElement.querySelector(
      '.comet-editor-draft-toolbar-split .comet-editor-draft-toolbar-split-dropdown.comet-actionbar-action',
    );
    const fontSizePrimary = toolbarElement.querySelector(
      '.comet-editor-draft-toolbar-split-primary.comet-actionbar-action.comet-is-text',
    );
    const splitDropdownLabels = Array.from(
      toolbarElement.querySelectorAll('.comet-editor-draft-toolbar-split-dropdown.comet-actionbar-action'),
    ).map((button) => button.getAttribute('aria-label'));
    const actionOrder = Array.from(
      toolbarElement.querySelectorAll('.comet-editor-draft-toolbar-group .comet-actionbar-action[aria-label]'),
    ).map((button) => button.getAttribute('aria-label'));
    const boldIndex = actionOrder.indexOf(labels.bold);
    const fontFamilyDropdownIndex = actionOrder.indexOf(labels.fontFamily);
    const fontSizeDropdownIndex = actionOrder.indexOf(labels.fontSize);

    assert.equal(toolbarElement.classList.contains('comet-editor-draft-toolbar'), true);
    assert(toolbarContent instanceof HTMLElement);
    assert(toolbarGroup instanceof HTMLElement);
    assert(toolbarMore instanceof HTMLElement);
    assert(toolbarAction instanceof HTMLButtonElement);
    assert(textStylePrimary instanceof HTMLButtonElement);
    assert(textStyleDropdown instanceof HTMLElement);
    assert(fontSizePrimary instanceof HTMLButtonElement);
    assert.deepEqual(splitDropdownLabels, [labels.fontFamily, labels.fontSize, labels.textGroup]);
    assert.notEqual(boldIndex, -1);
    assert.notEqual(fontFamilyDropdownIndex, -1);
    assert.notEqual(fontSizeDropdownIndex, -1);
    assert(fontFamilyDropdownIndex < boldIndex);
    assert(fontSizeDropdownIndex < boldIndex);
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('DraftEditorToolbar moves overflowing action buttons into the more menu', async () => {
  const alignCalls: Array<'left' | 'center' | 'right'> = [];
  const toolbar = new DraftEditorToolbar({
    labels,
    toolbarState: {
      isParagraphActive: true,
      activeHeadingLevel: null,
      isBoldActive: false,
      isItalicActive: false,
      isUnderlineActive: false,
      fontFamily: null,
      fontSize: null,
      textAlign: 'left',
      isBulletListActive: false,
      isOrderedListActive: false,
      isBlockquoteActive: false,
      canUndo: false,
      canRedo: false,
      availableFigureIds: [],
    },
    actions: {
      setParagraph: () => {},
      toggleHeading: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
      setFontFamily: () => {},
      setFontSize: () => {},
      setTextAlign: (value) => {
        alignCalls.push(value);
      },
      clearInlineStyles: () => {},
      toggleBulletList: () => {},
      toggleOrderedList: () => {},
      toggleBlockquote: () => {},
      undo: () => {},
      redo: () => {},
      insertCitation: () => {},
      insertFigure: () => {},
      insertFigureRef: () => {},
    },
  });

  document.body.append(toolbar.getElement());

  try {
    const toolbarElement = toolbar.getElement();
    const contentElement = toolbarElement.querySelector(
      ':scope > .comet-editor-draft-toolbar-content',
    );
    const trailingElement = toolbarElement.querySelector(
      ':scope > .comet-editor-draft-toolbar-trailing',
    );
    assert(contentElement instanceof HTMLElement);
    assert(trailingElement instanceof HTMLElement);

    const createRect = (width: number, height: number) => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    });
    const narrowRect = createRect(220, 36);
    Object.defineProperty(toolbarElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => narrowRect,
    });
    Object.defineProperty(trailingElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => createRect(24, 24),
    });
    Object.defineProperty(contentElement, 'scrollWidth', {
      configurable: true,
      get: () => {
        const collapsibleActionButtons = contentElement.querySelectorAll(
          '.comet-editor-draft-toolbar-btn.comet-actionbar-action:not(.comet-editor-draft-toolbar-split-primary):not(.comet-editor-draft-toolbar-split-dropdown)',
        ).length;
        return 180 + (collapsibleActionButtons * 28);
      },
    });

    await delay(20);

    const inlineAlignRightButton = Array.from(toolbarElement.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.alignRight,
    );
    assert.equal(inlineAlignRightButton, undefined);

    const moreButton = Array.from(toolbarElement.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === labels.toolbarMore,
    );
    assert(moreButton instanceof HTMLButtonElement);
    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    const alignRightMenuItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (candidate) => candidate.textContent?.includes(labels.alignRight),
    );
    assert(alignRightMenuItem instanceof HTMLElement);
    alignRightMenuItem.click();
    await delay(0);

    assert.equal(alignCalls.at(-1), 'right');
  } finally {
    toolbar.dispose();
    document.body.replaceChildren();
  }
});

test('ProseMirrorEditor refreshes placeholder text during an external document replacement', async () => {
  const initialDocument = createWritingEditorDocumentFromPlainText('alpha');

  await withEditor(({ editor, changes }) => {
    const nextProps = createProps(createEmptyWritingEditorDocument(), (nextDocument) => {
      changes.push(nextDocument);
    });
    nextProps.placeholder = 'Continue writing';
    editor.setProps(nextProps);

    const placeholderAfter = getPlaceholderNode(editor);
    assert.equal(placeholderAfter.getAttribute('data-placeholder'), 'Continue writing');
    assert.equal(changes.length, 0);
  }, initialDocument);
});

test('ProseMirrorEditor mounts the editing surface inside the shared scrollable container', async () => {
  await withEditor(({ editor }) => {
    const scrollableRoot = getScrollableRoot(editor);
    const host = scrollableRoot.querySelector('.comet-pm-editor-host');
    assert(host instanceof HTMLElement);
    assert.equal(scrollableRoot.classList.contains('comet-pm-editor-scrollable'), true);
    assert.equal(host.classList.contains('comet-scrollable-content'), true);
  });
});

test('ProseMirrorEditor applies external document changes without echoing them back through onDocumentChange', async () => {
  await withEditor(({ editor, changes }) => {
    assert.equal(editor.insertPlainText('alpha'), true);
    assert.equal(changes.length, 1);

    const echoedLocalDocument = changes[0];
    editor.setProps(createProps(echoedLocalDocument, (nextDocument) => {
      changes.push(nextDocument);
    }));

    const externalDocument = createWritingEditorDocumentFromPlainText('beta');
    editor.setProps(createProps(externalDocument, (nextDocument) => {
      changes.push(nextDocument);
    }));

    assert.equal(getEditorText(editor), 'beta');
    assert.equal(changes.length, 1);
  });
});

test('ProseMirrorEditor exports a stable selection target for a single text unit', async () => {
  await withEditor(({ editor }) => {
    const initialDocument = createWritingEditorDocumentFromPlainText('alpha beta');
    editor.setProps(createProps(initialDocument, () => {}));

    const editorView = (editor as unknown as { view: import('prosemirror-view').EditorView | null }).view;
    assert(editorView);

    const selection = TextSelection.create(editorView.state.doc, 1, 6);
    editorView.dispatch(editorView.state.tr.setSelection(selection));

    const target = editor.getStableSelectionTarget();
    assert(target);
    assert.deepEqual(target, {
      blockId: target.blockId,
      kind: 'paragraph',
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 6,
      },
      startOffset: 0,
      endOffset: 5,
      selectedText: 'alpha',
      blockText: 'alpha beta',
      isCollapsed: false,
      isPlainTextEditable: true,
    });
    assert.match(target.blockId, /^block_/);
  });
});

test('ProseMirrorEditor returns null for multi-block selections', async () => {
  await withEditor(({ editor }) => {
    const initialDocument = createWritingEditorDocumentFromPlainText('alpha\n\nbeta');
    editor.setProps(createProps(initialDocument, () => {}));

    const editorView = (editor as unknown as { view: import('prosemirror-view').EditorView | null }).view;
    assert(editorView);

    const selection = TextSelection.create(editorView.state.doc, 2, 11);
    editorView.dispatch(editorView.state.tr.setSelection(selection));

    assert.equal(editor.getStableSelectionTarget(), null);
  });
});

test('ProseMirrorEditor restores draft view state with selection and scroll position', async () => {
  await withEditor(({ editor }) => {
    const initialDocument = createWritingEditorDocumentFromPlainText('alpha beta');
    editor.setProps(createProps(initialDocument, () => {}));

    const editorView = (editor as unknown as { view: import('prosemirror-view').EditorView | null }).view;
    const host = (editor as unknown as { hostWrapperElement: HTMLElement }).hostWrapperElement;
    assert(editorView);
    assert(host instanceof HTMLElement);

    const selection = TextSelection.create(editorView.state.doc, 1, 6);
    editorView.dispatch(editorView.state.tr.setSelection(selection));
    host.scrollTop = 48;
    host.dispatchEvent(new Event('scroll'));

    const viewState = editor.getViewState();
    assert(viewState);
    assert.equal(viewState.scrollPosition.scrollTop, 48);
    assert.equal(viewState.selectionTarget?.selectedText, 'alpha');

    const collapsedSelection = TextSelection.create(editorView.state.doc, 1, 1);
    editorView.dispatch(editorView.state.tr.setSelection(collapsedSelection));
    host.scrollTop = 0;
    host.dispatchEvent(new Event('scroll'));

    editor.restoreViewState(viewState);

    const restoredTarget = editor.getStableSelectionTarget();
    assert(restoredTarget);
    assert.equal(restoredTarget.selectedText, 'alpha');
    assert.equal(host.scrollTop, 48);
  });
});

test('ProseMirrorEditor clears undo history after an external document replacement', async () => {
  await withEditor(({ editor, changes }) => {
    assert.equal(editor.insertPlainText('alpha'), true);
    assert.equal(changes.length, 1);

    const echoedLocalDocument = changes[0];
    editor.setProps(createProps(echoedLocalDocument, (nextDocument) => {
      changes.push(nextDocument);
    }));

    editor.setProps(
      createProps(createWritingEditorDocumentFromPlainText('beta'), (nextDocument) => {
        changes.push(nextDocument);
      }),
    );

    const moreButton = getToolbarButton(editor, labels.toolbarMore);
    moreButton.click();

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    const undoItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (candidate) => candidate.textContent?.includes(labels.undo),
    );
    assert(undoItem instanceof HTMLElement);
    assert.equal(undoItem.classList.contains('disabled'), true);
  });
});

test('DomScrollableElement uses visibility controllers to reveal auto scrollbars on hover and scroll', async () => {
  const content = document.createElement('div');
  Object.defineProperties(content, {
    clientHeight: { configurable: true, value: 120 },
    clientWidth: { configurable: true, value: 120 },
    scrollHeight: { configurable: true, value: 360 },
    scrollWidth: { configurable: true, value: 120 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  });

  const scrollable = new DomScrollableElement(content, {
    vertical: ScrollbarVisibility.Auto,
    horizontal: ScrollbarVisibility.Hidden,
  });
  const root = scrollable.getDomNode();
  document.body.append(root);

  try {
    assert(root.querySelector('.comet-overlay-scrollbar-vertical'));
    assert(root.querySelector('.comet-overlay-scrollbar-horizontal'));
    assert.equal(root.classList.contains('comet-is-vertical-scrollbar-visible'), false);

    root.dispatchEvent(new Event('mouseenter'));
    await delay(0);
    assert.equal(root.classList.contains('comet-is-vertical-scrollbar-visible'), true);

    root.dispatchEvent(new Event('mouseleave'));
    await delay(550);
    assert.equal(root.classList.contains('comet-is-vertical-scrollbar-visible'), false);

    content.scrollTop = 48;
    content.dispatchEvent(new Event('scroll'));
    await delay(0);
    assert.equal(root.classList.contains('comet-is-vertical-scrollbar-visible'), true);

    await delay(550);
    assert.equal(root.classList.contains('comet-is-vertical-scrollbar-visible'), false);
  } finally {
    scrollable.dispose();
    document.body.replaceChildren();
  }
});
