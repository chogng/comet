import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { GridBranchView, GridView, Orientation } from 'cs/base/browser/ui/grid/gridview';
import type { IGridView } from 'cs/base/browser/ui/grid/gridview';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

class TestGridLeaf implements IGridView {
  readonly element = document.createElement('div');
  width = 0;
  height = 0;

  constructor(
    readonly minimumWidth: number,
    readonly maximumWidth: number,
    readonly minimumHeight: number,
    readonly maximumHeight: number,
    readonly snap = false,
  ) {}

  layout(width: number, height: number) {
    this.width = width;
    this.height = height;
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

test('gridview nested branches preserve outer and inner comet-sash resizing', () => {
  const fetchLeaf = new TestGridLeaf(120, 420, 100, Number.POSITIVE_INFINITY);
  const primaryLeaf = new TestGridLeaf(160, 420, 100, Number.POSITIVE_INFINITY);
  const editorLeaf = new TestGridLeaf(240, Number.POSITIVE_INFINITY, 100, Number.POSITIVE_INFINITY);
  const auxiliaryLeaf = new TestGridLeaf(140, 360, 100, Number.POSITIVE_INFINITY);

  const leftBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: fetchLeaf, size: 220 },
    { view: primaryLeaf, size: 320 },
  ]);
  const rootBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: leftBranch, size: 550 },
    { view: editorLeaf, size: 420, flex: true },
    { view: auxiliaryLeaf, size: 200 },
  ]);
  const gridView = new GridView(rootBranch);
  document.body.append(gridView.element);

  try {
    gridView.layout(1200, 600);

    const rootSashContainer = rootBranch.element.querySelector(
      ':scope > .comet-split-view > .comet-sash-container',
    );
    assert(rootSashContainer);

    const outerSashes = rootSashContainer.querySelectorAll(':scope > .comet-sash.comet-vertical');
    assert.equal(outerSashes.length, 2);

    dispatchDrag(outerSashes[0], {
      startX: 550,
      startY: 12,
      endX: 610,
      endY: 12,
    });

    assert.equal(rootBranch.getChildSize(0), 610);
    assert.equal(rootBranch.getChildSize(1), 370);

    const innerSash = leftBranch.element.querySelector(
      ':scope > .comet-split-view > .comet-sash-container > .comet-sash.comet-vertical',
    );
    assert(innerSash);
    const initialFetchSize = leftBranch.getChildSize(0);
    const initialPrimarySize = leftBranch.getChildSize(1);

    dispatchDrag(innerSash, {
      startX: initialFetchSize,
      startY: 12,
      endX: initialFetchSize + 40,
      endY: 12,
    });

    assert.equal(leftBranch.getChildSize(0), initialFetchSize + 40);
    assert.equal(leftBranch.getChildSize(1), initialPrimarySize - 40);
    assert.equal(fetchLeaf.width, initialFetchSize + 40);
    assert.equal(primaryLeaf.width, initialPrimarySize - 40);
  } finally {
    gridView.dispose();
    gridView.element.remove();
  }
});

test('gridview exposes location-based sizing, visibility, and comet-sash events', () => {
  const fetchLeaf = new TestGridLeaf(120, 420, 100, Number.POSITIVE_INFINITY);
  const primaryLeaf = new TestGridLeaf(160, 420, 100, Number.POSITIVE_INFINITY);
  const editorLeaf = new TestGridLeaf(240, Number.POSITIVE_INFINITY, 100, Number.POSITIVE_INFINITY);
  const leftBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: fetchLeaf, size: 220 },
    { view: primaryLeaf, size: 320 },
  ]);
  const rootBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: leftBranch, size: 550 },
    { view: editorLeaf, size: 420, flex: true },
  ]);
  const gridView = new GridView(rootBranch);
  const sashEvents: number[][] = [];
  const disposeSashListener = gridView.onDidSashEnd((location) => {
    sashEvents.push(location);
  });
  document.body.append(gridView.element);

  try {
    gridView.layout(1000, 600);

    assert.equal(gridView.getViewSize([0]), 550);
    assert.equal(gridView.getViewSize([0, 0]), 220);
    assert.equal(gridView.isViewVisible([0, 1]), true);

    gridView.setViewSize([0, 0], 260);
    assert.equal(gridView.getViewSize([0, 0]), 260);

    gridView.setViewVisible([0, 1], false);
    assert.equal(gridView.isViewVisible([0, 1]), false);
    assert.equal(gridView.getViewSize([0, 0]), 550);

    gridView.setViewVisible([0, 1], true);
    assert.equal(gridView.getViewSize([0, 0]), 260);

    const innerSash = leftBranch.element.querySelector(
      ':scope > .comet-split-view > .comet-sash-container > .comet-sash.comet-vertical',
    );
    assert(innerSash);

    dispatchDrag(innerSash, {
      startX: 260,
      startY: 12,
      endX: 300,
      endY: 12,
    });

    assert.deepEqual(sashEvents, [[0, 0]]);
  } finally {
    disposeSashListener();
    gridView.dispose();
    gridView.element.remove();
  }
});

test('gridview can split a leaf location and collapse the wrapper after remove', () => {
  const editorLeaf = new TestGridLeaf(
    240,
    Number.POSITIVE_INFINITY,
    100,
    Number.POSITIVE_INFINITY,
  );
  const auxiliaryLeaf = new TestGridLeaf(140, 360, 100, Number.POSITIVE_INFINITY);
  const rootBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: editorLeaf, size: 600, flex: true },
  ]);
  const gridView = new GridView(rootBranch);
  document.body.append(gridView.element);

  try {
    gridView.layout(800, 600);

    gridView.addView(auxiliaryLeaf, 220, [0, 1], {
      splitOrientation: Orientation.VERTICAL,
    });

    const wrappedBranch = gridView.getView([0]);
    assert(wrappedBranch instanceof GridBranchView);
    assert.equal(gridView.getView([0, 0]), editorLeaf);
    assert.equal(gridView.getView([0, 1]), auxiliaryLeaf);
    assert.equal(gridView.getViewSize([0, 1]), 220);

    const removedView = gridView.removeView([0, 0]);
    assert.equal(removedView, editorLeaf);
    assert.equal(gridView.getView([0]), auxiliaryLeaf);
    assert.equal(gridView.getViewSize([0]), 800);
  } finally {
    gridView.dispose();
    gridView.element.remove();
  }
});

test('gridview surfaces snap events with root-relative locations', () => {
  const fetchLeaf = new TestGridLeaf(120, 420, 100, Number.POSITIVE_INFINITY, true);
  const editorLeaf = new TestGridLeaf(
    240,
    Number.POSITIVE_INFINITY,
    100,
    Number.POSITIVE_INFINITY,
  );
  const rootBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: fetchLeaf, size: 200 },
    { view: editorLeaf, size: 500, flex: true },
  ]);
  const gridView = new GridView(rootBranch);
  gridView.edgeSnapping = true;
  const snapEvents: Array<{ location: number[]; itemIndex: number; visible: boolean }> = [];
  const disposeSnapListener = gridView.onDidSashSnap((event) => {
    snapEvents.push({
      location: [...event.location],
      itemIndex: event.itemIndex,
      visible: event.visible,
    });
  });
  document.body.append(gridView.element);

  try {
    gridView.layout(900, 600);

    const sash = rootBranch.element.querySelector(
      ':scope > .comet-split-view > .comet-sash-container > .comet-sash.comet-vertical',
    );
    assert(sash);

    dispatchDrag(sash, {
      startX: 200,
      startY: 12,
      endX: 50,
      endY: 12,
    });

    assert.deepEqual(snapEvents, [
      {
        location: [0],
        itemIndex: 0,
        visible: false,
      },
    ]);
    assert.equal(gridView.isViewVisible([0]), false);
    assert.equal(gridView.getViewSize([0]), 200);
    assert.equal(gridView.getViewSize([1]), 900);

    dispatchDrag(sash, {
      startX: 0,
      startY: 12,
      endX: 70,
      endY: 12,
    });

    assert.deepEqual(snapEvents, [
      {
        location: [0],
        itemIndex: 0,
        visible: false,
      },
      {
        location: [0],
        itemIndex: 0,
        visible: true,
      },
    ]);
    assert.equal(gridView.isViewVisible([0]), true);
    assert.equal(gridView.getViewSize([0]), 120);
    assert.equal(gridView.getViewSize([1]), 770);
  } finally {
    disposeSnapListener();
    gridView.dispose();
    gridView.element.remove();
  }
});

test('gridview edge snapping controls whether an edge snap comet-sash stays enabled', () => {
  const fetchLeaf = new TestGridLeaf(120, 420, 100, Number.POSITIVE_INFINITY, true);
  const editorLeaf = new TestGridLeaf(
    240,
    Number.POSITIVE_INFINITY,
    100,
    Number.POSITIVE_INFINITY,
  );
  const rootBranch = new GridBranchView(Orientation.VERTICAL, 10, [
    { view: fetchLeaf, size: 200 },
    { view: editorLeaf, size: 500, flex: true },
  ]);
  const gridView = new GridView(rootBranch);
  document.body.append(gridView.element);

  try {
    gridView.layout(900, 600);
    gridView.setViewVisible([0], false);

    const sash = rootBranch.element.querySelector(
      ':scope > .comet-split-view > .comet-sash-container > .comet-sash.comet-vertical',
    );
    assert(sash);
    assert.equal(sash.classList.contains('comet-disabled'), true);

    gridView.edgeSnapping = true;

    assert.equal(sash.classList.contains('comet-disabled'), false);

    gridView.edgeSnapping = false;

    assert.equal(sash.classList.contains('comet-disabled'), true);
  } finally {
    gridView.dispose();
    gridView.element.remove();
  }
});
