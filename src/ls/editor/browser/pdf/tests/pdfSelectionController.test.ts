import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { PdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import { PdfSelectionController } from 'ls/editor/browser/pdf/pdfSelectionController';
import type { PdfReviewerPageInfo } from 'ls/editor/browser/pdf/pdfReviewerTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createPointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  options: {
    clientX: number;
    clientY: number;
    detail?: number;
  },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: options.clientX,
    clientY: options.clientY,
    detail: options.detail ?? 1,
  });
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: 1,
  });
  return event as PointerEvent;
}

function setElementRect(element: Element, rect: Partial<DOMRect>) {
  const fullRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    toJSON: () => ({}),
  };
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => fullRect,
  });
}

function createHarness(
  chars: PdfReviewerPageInfo['chars'] = [
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ],
) {
  const pagesElement = document.createElement('div');
  const pageElement = document.createElement('section');
  const canvas = document.createElement('canvas');
  const highlightLayer = document.createElement('div');
  const selections: Array<PdfSelection | null> = [];
  const hitTests: Array<Parameters<NonNullable<ConstructorParameters<typeof PdfSelectionController>[0]['onHitTestStatusChange']>>[0]> = [];
  const dragStates: boolean[] = [];

  pageElement.className = 'pdf-reader-page';
  pageElement.dataset.pdfPage = '1';
  canvas.style.width = '100px';
  canvas.style.height = '100px';
  highlightLayer.style.width = '100px';
  highlightLayer.style.height = '100px';
  pageElement.append(canvas, highlightLayer);
  pagesElement.append(pageElement);
  document.body.append(pagesElement);

  setElementRect(canvas, {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  setElementRect(highlightLayer, {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  setElementRect(pageElement, {
    left: 0,
    top: 0,
    width: 100,
    height: 120,
  });

  const info: PdfReviewerPageInfo = {
    page: 1,
    pageWidth: 100,
    pageHeight: 100,
    scale: 1,
    canvas,
    highlightLayer,
    chars,
  };

  const controller = new PdfSelectionController({
    pagesElement,
    pageInfoByPage: new Map([[1, info]]),
    onSelectionChange: (selection) => {
      selections.push(selection);
    },
    onHitTestStatusChange: (hitTest) => {
      hitTests.push(hitTest);
    },
    onSelectionDragChange: (isDragging) => {
      dragStates.push(isDragging);
    },
  });

  return {
    canvas,
    controller,
    highlightLayer,
    pageElement,
    pagesElement,
    hitTests,
    dragStates,
    selections,
    dispose: () => {
      controller.dispose();
      document.body.replaceChildren();
    },
  };
}

test('PdfSelectionController ignores pointer starts far from text rows', () => {
  const harness = createHarness();

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 90,
      clientY: 80,
    }));

    assert.equal(harness.selections.length, 0);
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController reports active drag state only for range selections', () => {
  const harness = createHarness();

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 6,
      clientY: 15,
    }));

    assert.deepEqual(harness.dragStates, [true, false]);

    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 12,
      clientY: 15,
      detail: 2,
    }));

    assert.deepEqual(harness.dragStates, [true, false]);
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController normalizes selection boxes to the text row height', () => {
  const harness = createHarness([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 82, width: 8, height: 6 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 20, y: 78, width: 8, height: 12 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 30, y: 82, width: 8, height: 6 },
    },
  ]);

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 15,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 15,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'a');
    assert.equal(selection.rects.length, 1);
    assert(selection.rects[0].height > 14);
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController snaps near-line drags to the visual line boundary', () => {
  const harness = createHarness();

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 27,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 27,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'ab');
    assert.deepEqual(selection.textRange, {
      startCharIndex: 0,
      endCharIndex: 1,
    });
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController finalizes a drag on pointerup without pointermove', () => {
  const harness = createHarness();

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 27,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'ab');
    assert.deepEqual(selection.textRange, {
      startCharIndex: 0,
      endCharIndex: 1,
    });
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController keeps unpositioned spaces in drag selections', () => {
  const harness = createHarness([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: ' ',
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ]);

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 38,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 38,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'a b');
    assert.deepEqual(selection.textRange, {
      startCharIndex: 0,
      endCharIndex: 2,
    });
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController extends multi-row drags as a PDFium text range', () => {
  const harness = createHarness([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'd',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
    {
      index: 4,
      char: 'e',
      rect: { x: 30, y: 68, width: 8, height: 10 },
    },
    {
      index: 5,
      char: 'f',
      rect: { x: 50, y: 68, width: 8, height: 10 },
    },
  ]);

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 25,
      clientY: 14,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 60,
      clientY: 28,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 60,
      clientY: 28,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'bcdef');
    assert.equal(selection.rects.length, 2);
    assert.deepEqual(selection.textRange, {
      startCharIndex: 1,
      endCharIndex: 5,
    });
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController reports hit-test diagnostics for the statusbar', () => {
  const harness = createHarness();

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 12,
      clientY: 15,
    }));

    const hitTest = harness.hitTests.at(-1);
    assert(hitTest);
    assert.equal(hitTest.page, 1);
    assert.equal(hitTest.lineIndex, 1);
    assert.equal(hitTest.lineId, 'pdf_line_1_1');
    assert.equal(hitTest.charOffset, 0);
    assert.equal(Math.round(hitTest.pdfX), 12);
    assert.equal(Math.round(hitTest.pdfY), 85);
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController uses page geometry after the rendered canvas is evicted', () => {
  const harness = createHarness();

  try {
    harness.canvas.remove();
    harness.pageElement.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 6,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 27,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 27,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'ab');
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController double click uses visual layout character offsets', () => {
  const harness = createHarness([
    {
      index: 0,
      char: 'd',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'o',
      rect: { x: 60, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'g',
      rect: { x: 70, y: 80, width: 8, height: 10 },
    },
    {
      index: 3,
      char: ' ',
    },
    {
      index: 4,
      char: 'c',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 5,
      char: 'a',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 6,
      char: 't',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ]);

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 12,
      clientY: 15,
      detail: 2,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'cat');
    assert.deepEqual(selection.textRange, {
      startCharIndex: 4,
      endCharIndex: 6,
    });
  } finally {
    harness.dispose();
  }
});

test('PdfSelectionController keeps disjoint PDFium text spans for visual selections', () => {
  const harness = createHarness([
    {
      index: 10,
      char: 'c',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 11,
      char: 'a',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 12,
      char: 't',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
    {
      index: 20,
      char: 'd',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 21,
      char: 'o',
      rect: { x: 60, y: 80, width: 8, height: 10 },
    },
    {
      index: 22,
      char: 'g',
      rect: { x: 70, y: 80, width: 8, height: 10 },
    },
  ]);

  try {
    harness.canvas.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 23,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 65,
      clientY: 15,
    }));
    harness.pagesElement.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 65,
      clientY: 15,
    }));

    const selection = harness.selections.at(-1);
    assert(selection);
    assert.equal(selection.text, 'atdo');
    assert.deepEqual(selection.textSpans, [
      { startTextIndex: 11, endTextIndex: 13 },
      { startTextIndex: 20, endTextIndex: 22 },
    ]);
    assert.deepEqual(selection.textRange, {
      startCharIndex: 11,
      endCharIndex: 21,
    });
  } finally {
    harness.dispose();
  }
});
