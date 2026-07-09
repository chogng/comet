import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnchorAlignment,
  AnchorAxisAlignment,
  AnchorPosition,
  LayoutAnchorPosition,
  layout,
  layout2d,
} from 'cs/base/common/layout';

test('layout positions a view after a before anchor when space allows', () => {
  assert.deepEqual(
    layout(200, 20, {
      offset: 50,
      size: 30,
      position: LayoutAnchorPosition.Before,
    }),
    { position: 80, result: 'ok' },
  );
});

test('layout flips a before anchor when only the opposite side fits', () => {
  assert.deepEqual(
    layout(100, 40, {
      offset: 70,
      size: 20,
      position: LayoutAnchorPosition.Before,
    }),
    { position: 30, result: 'flipped' },
  );
});

test('layout positions a view before an after anchor when space allows', () => {
  assert.deepEqual(
    layout(200, 20, {
      offset: 50,
      size: 30,
      position: LayoutAnchorPosition.After,
    }),
    { position: 30, result: 'ok' },
  );
});

test('layout2d flips vertical placement when below does not fit', () => {
  const result = layout2d(
    { top: 0, left: 0, width: 320, height: 240 },
    { width: 120, height: 80 },
    { top: 200, left: 40, width: 80, height: 24 },
    {
      anchorAlignment: AnchorAlignment.LEFT,
      anchorPosition: AnchorPosition.BELOW,
      anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
    },
  );

  assert.equal(result.top, 120);
  assert.equal(result.left, 40);
  assert.equal(result.anchorPosition, AnchorPosition.ABOVE);
});
