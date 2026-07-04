import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { Orientation, SplitView } from 'cs/base/browser/ui/splitview/splitview';
import type { IView } from 'cs/base/browser/ui/splitview/splitview';
import { Pane, PaneView } from 'cs/base/browser/ui/splitview/paneview';

let cleanupDomEnvironment: (() => void) | null = null;

class TestView implements IView {
  readonly element = document.createElement('div');
  lastLayoutSize = 0;

  constructor(
    readonly minimumSize: number,
    readonly maximumSize: number,
    readonly snap = false,
  ) {}

  layout(size: number) {
    this.lastLayoutSize = size;
  }
}

class ReentrantLayoutView extends TestView {
  constructor(
    minimumSize: number,
    maximumSize: number,
    private readonly onLayoutHook: () => void,
  ) {
    super(minimumSize, maximumSize);
  }

  layout(size: number) {
    super.layout(size);
    this.onLayoutHook();
  }
}

function createPointerEvent(
  type: string,
  coordinates: {
    x: number;
    y: number;
  },
) {
  const EventCtor =
    typeof window.PointerEvent !== 'undefined' ? window.PointerEvent : window.MouseEvent;
  return new EventCtor(type, {
    bubbles: true,
    button: 0,
    clientX: coordinates.x,
    clientY: coordinates.y,
  });
}

function dispatchDrag(
  sash: Element,
  coordinates: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  },
) {
  const isPointer = typeof window.PointerEvent !== 'undefined';
  sash.dispatchEvent(
    createPointerEvent(isPointer ? 'pointerdown' : 'mousedown', {
      x: coordinates.startX,
      y: coordinates.startY,
    }),
  );
  window.dispatchEvent(
    createPointerEvent(isPointer ? 'pointermove' : 'mousemove', {
      x: coordinates.endX,
      y: coordinates.endY,
    }),
  );
  window.dispatchEvent(
    createPointerEvent(isPointer ? 'pointerup' : 'mouseup', {
      x: coordinates.endX,
      y: coordinates.endY,
    }),
  );
}

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('splitview sash drag resizes adjacent views', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);
  const trailingView = new TestView(160, 360);

  splitView.addView(leadingView, 200);
  splitView.addView(centerView, 400, { flex: true });
  splitView.addView(trailingView, 300);
  document.body.append(splitView.element);

  try {
    splitView.layout(1000, 640);

    const firstSash = splitView.element.querySelector('.sash.vertical');
    assert(firstSash);
    assert.equal(splitView.getViewSize(0), 200);
    assert.equal(splitView.getViewSize(1), 480);

    dispatchDrag(firstSash, {
      startX: 200,
      startY: 12,
      endX: 260,
      endY: 12,
    });

    assert.equal(splitView.getViewSize(0), 260);
    assert.equal(splitView.getViewSize(1), 420);
    assert.equal(leadingView.lastLayoutSize, 260);
    assert.equal(centerView.lastLayoutSize, 420);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview restores cached size after a hidden view becomes visible again', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);

  splitView.addView(leadingView, 260);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);

    splitView.setViewVisible(0, false);
    assert.equal(splitView.isViewVisible(0), false);
    assert.equal(splitView.getViewSize(0), 260);

    splitView.setViewVisible(0, true);
    splitView.layout(900, 520);

    assert.equal(splitView.isViewVisible(0), true);
    assert.equal(splitView.getViewSize(0), 260);
    assert.equal(leadingView.lastLayoutSize, 260);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview collapses a snap-enabled view after dragging past its minimum', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420, true);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);
  let snappedItemIndex: number | null = null;
  const disposeSnapListener = splitView.onDidSashSnap((event) => {
    snappedItemIndex = event.itemIndex;
  });

  splitView.addView(leadingView, 200);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);

    const firstSash = splitView.element.querySelector('.sash.vertical');
    assert(firstSash);

    dispatchDrag(firstSash, {
      startX: 200,
      startY: 12,
      endX: 70,
      endY: 12,
    });

    assert.equal(snappedItemIndex, null);
    assert.equal(splitView.isViewVisible(0), true);
    assert.equal(splitView.getViewSize(0), 120);
    assert.equal(splitView.getViewSize(1), 770);

    dispatchDrag(firstSash, {
      startX: 200,
      startY: 12,
      endX: 50,
      endY: 12,
    });

    assert.equal(snappedItemIndex, 0);
    assert.equal(splitView.isViewVisible(0), false);
    assert.equal(splitView.getViewSize(0), 120);
    assert.equal(splitView.getViewSize(1), 900);
    assert.equal(centerView.lastLayoutSize, 900);
  } finally {
    disposeSnapListener();
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview re-expands a snapped view only after crossing the reopen hysteresis', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420, true);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);
  const snapEvents: boolean[] = [];
  const disposeSnapListener = splitView.onDidSashSnap((event) => {
    snapEvents.push(event.visible);
  });

  splitView.addView(leadingView, 200);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);
    splitView.setViewVisible(0, false);

    const firstSash = splitView.element.querySelector('.sash.vertical');
    assert(firstSash);

    dispatchDrag(firstSash, {
      startX: 0,
      startY: 12,
      endX: 50,
      endY: 12,
    });

    assert.equal(splitView.isViewVisible(0), false);
    assert.deepEqual(snapEvents, []);

    dispatchDrag(firstSash, {
      startX: 0,
      startY: 12,
      endX: 70,
      endY: 12,
    });

    assert.equal(splitView.isViewVisible(0), true);
    assert.equal(splitView.getViewSize(0), 120);
    assert.equal(splitView.getViewSize(1), 770);
    assert.deepEqual(snapEvents, [true]);
  } finally {
    disposeSnapListener();
    splitView.dispose();
    splitView.element.remove();
  }
});

test('paneview bottom pane header remains clickable without reserved sash space', () => {
  const paneView = new PaneView({
    orientation: Orientation.HORIZONTAL,
    reserveSashSpace: false,
  });
  const topPane = new Pane({
    title: 'Top',
    minimumBodySize: 120,
    expanded: true,
  });
  const bottomPane = new Pane({
    title: 'Bottom',
    minimumBodySize: 120,
    expanded: true,
  });
  paneView.addPane(topPane, 200, { flex: true });
  paneView.addPane(bottomPane, 200, { flex: true });
  document.body.append(paneView.element);

  try {
    paneView.layout(320, 400);

    const toggle = bottomPane.element.querySelector<HTMLButtonElement>('.pane-header-toggle');
    assert(toggle);
    const body = bottomPane.element.querySelector<HTMLElement>('.pane-body');
    assert(body);

    toggle.click();

    assert.equal(bottomPane.isExpanded(), false);
    assert.equal(body.isConnected, false);

    toggle.click();

    assert.equal(bottomPane.isExpanded(), true);
    assert.equal(body.isConnected, true);
  } finally {
    paneView.dispose();
    paneView.element.remove();
  }
});

test('splitview disables snapped edge sash when start snapping is turned off', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420, true);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);

  splitView.addView(leadingView, 200);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);
    splitView.setViewVisible(0, false);

    const firstSash = splitView.element.querySelector('.sash.vertical');
    assert(firstSash);
    assert.equal(firstSash.classList.contains('disabled'), false);

    splitView.startSnappingEnabled = false;

    assert.equal(firstSash.classList.contains('disabled'), true);

    splitView.startSnappingEnabled = true;

    assert.equal(firstSash.classList.contains('disabled'), false);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview separator is visible only when there is a visible view after the left view', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);

  splitView.addView(leadingView, 260);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);

    const separator = splitView.element.querySelector<HTMLElement>(
      '.split-view-separator.vertical',
    );
    assert(separator);
    assert.equal(separator.classList.contains('visible'), true);

    splitView.setViewVisible(1, false);

    assert.equal(separator.classList.contains('visible'), false);

    splitView.setViewVisible(1, true);
    splitView.layout(900, 520);

    assert.equal(separator.classList.contains('visible'), true);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview keeps a single separator between non-adjacent visible views', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420);
  const centerView = new TestView(220, Number.POSITIVE_INFINITY);
  const trailingView = new TestView(120, 520);

  splitView.addView(leadingView, 220);
  splitView.addView(centerView, 320, { flex: true });
  splitView.addView(trailingView, 220, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);

    const separators = Array.from(
      splitView.element.querySelectorAll<HTMLElement>('.split-view-separator.vertical'),
    );
    assert.equal(separators.length, 2);
    assert.equal(separators[0]?.classList.contains('visible'), true);
    assert.equal(separators[1]?.classList.contains('visible'), true);

    splitView.setViewVisible(1, false);
    splitView.layout(900, 520);

    const visibleSeparators = separators.filter((separator) =>
      separator.classList.contains('visible'),
    );
    assert.equal(visibleSeparators.length, 1);
    assert.equal(visibleSeparators[0], separators[0]);

    splitView.setViewVisible(1, true);
    splitView.layout(900, 520);

    assert.equal(separators[0]?.classList.contains('visible'), true);
    assert.equal(separators[1]?.classList.contains('visible'), true);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});

test('splitview sash change does not crash when layout side effects clear drag state', () => {
  const splitView = new SplitView(Orientation.VERTICAL, 10);
  const leadingView = new TestView(120, 420);
  let shouldRemoveViewOnLayout = false;
  const centerView = new ReentrantLayoutView(220, Number.POSITIVE_INFINITY, () => {
    if (!shouldRemoveViewOnLayout || splitView.length < 2) {
      return;
    }

    shouldRemoveViewOnLayout = false;
    splitView.removeView(0);
  });

  splitView.addView(leadingView, 200);
  splitView.addView(centerView, 500, { flex: true });
  document.body.append(splitView.element);

  try {
    splitView.layout(900, 520);

    const firstSash = splitView.element.querySelector('.sash.vertical');
    assert(firstSash);

    shouldRemoveViewOnLayout = true;
    assert.doesNotThrow(() => {
      dispatchDrag(firstSash, {
        startX: 200,
        startY: 12,
        endX: 250,
        endY: 12,
      });
    });
    assert.equal(splitView.length, 1);
  } finally {
    splitView.dispose();
    splitView.element.remove();
  }
});
