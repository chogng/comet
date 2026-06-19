import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAnchoredHorizontalLeft,
  resolveAnchoredOverlayAxisPosition,
  resolveAnchoredVerticalPlacement,
  resolveAnchoredVerticalPlacementWithFallback,
  resolveAnchoredVerticalTop,
} from 'ls/base/common/layout';

test('anchored overlay axis layout matches before/after behavior for zero-size anchors', () => {
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 0, size: 0, position: 'before' }),
    0,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 50, size: 0, position: 'before' }),
    50,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 200, size: 0, position: 'before' }),
    180,
  );

  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 0, size: 0, position: 'after' }),
    0,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 50, size: 0, position: 'after' }),
    30,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 200, size: 0, position: 'after' }),
    180,
  );
});

test('anchored overlay axis layout matches before/after behavior for sized anchors', () => {
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 0, size: 50, position: 'before' }),
    50,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 50, size: 50, position: 'before' }),
    100,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 150, size: 50, position: 'before' }),
    130,
  );

  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 0, size: 50, position: 'after' }),
    50,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 50, size: 50, position: 'after' }),
    30,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(200, 20, { offset: 150, size: 50, position: 'after' }),
    130,
  );
});

test('anchored overlay axis layout align mode keeps the overlay edge aligned to the anchor', () => {
  assert.equal(
    resolveAnchoredOverlayAxisPosition(
      200,
      40,
      { offset: 50, size: 30, position: 'before', mode: 'align' },
    ),
    50,
  );
  assert.equal(
    resolveAnchoredOverlayAxisPosition(
      200,
      40,
      { offset: 50, size: 30, position: 'after', mode: 'align' },
    ),
    40,
  );
});

test('anchored layout clamps horizontal start alignment into the viewport', () => {
  const left = resolveAnchoredHorizontalLeft({
    anchorRect: { x: 280, y: 24, width: 32, height: 24 },
    overlayWidth: 120,
    viewportWidth: 320,
    viewportMargin: 8,
    alignment: 'start',
  });

  assert.equal(left, 192);
});

test('anchored layout centers overlays when requested and space allows', () => {
  const left = resolveAnchoredHorizontalLeft({
    anchorRect: { x: 100, y: 24, width: 80, height: 24 },
    overlayWidth: 120,
    viewportWidth: 400,
    viewportMargin: 8,
    alignment: 'center',
  });

  assert.equal(left, 80);
});

test('anchored layout prefers below when it fits in auto mode', () => {
  const placement = resolveAnchoredVerticalPlacement({
    anchorRect: { x: 40, y: 60, width: 80, height: 24 },
    overlayHeight: 120,
    viewportHeight: 400,
    viewportMargin: 8,
    offset: 8,
    preference: 'auto',
  });

  assert.equal(placement.placement, 'below');
  assert.equal(placement.canFitBelow, true);
});

test('anchored layout flips above when below does not fit and above does', () => {
  const placement = resolveAnchoredVerticalPlacement({
    anchorRect: { x: 40, y: 320, width: 80, height: 24 },
    overlayHeight: 120,
    viewportHeight: 400,
    viewportMargin: 8,
    offset: 8,
    preference: 'auto',
  });

  assert.equal(placement.placement, 'above');
  assert.equal(placement.canFitAbove, true);
  assert.equal(placement.canFitBelow, false);
});

test('anchored layout preference falls back below when above cannot fit', () => {
  const placement = resolveAnchoredVerticalPlacement({
    anchorRect: { x: 40, y: 20, width: 80, height: 24 },
    overlayHeight: 120,
    viewportHeight: 300,
    viewportMargin: 8,
    offset: 8,
    preference: 'above',
  });
  const resolvedPlacement = resolveAnchoredVerticalPlacementWithFallback({
    preference: 'above',
    placement,
  });

  assert.equal(resolvedPlacement, 'below');
});

test('anchored layout preference falls back above when below cannot fit', () => {
  const placement = resolveAnchoredVerticalPlacement({
    anchorRect: { x: 40, y: 260, width: 80, height: 24 },
    overlayHeight: 120,
    viewportHeight: 300,
    viewportMargin: 8,
    offset: 8,
    preference: 'below',
  });
  const resolvedPlacement = resolveAnchoredVerticalPlacementWithFallback({
    preference: 'below',
    placement,
  });

  assert.equal(resolvedPlacement, 'above');
});

test('anchored layout clamps top when the overlay is taller than the available viewport', () => {
  const top = resolveAnchoredVerticalTop({
    anchorRect: { x: 40, y: 12, width: 80, height: 24 },
    overlayHeight: 300,
    viewportHeight: 240,
    viewportMargin: 8,
    offset: 8,
    placement: 'below',
  });

  assert.equal(top, 8);
});
