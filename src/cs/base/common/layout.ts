import { Range } from 'cs/base/common/range';

export interface IAnchor {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export const enum AnchorAlignment {
  LEFT,
  RIGHT,
}

export const enum AnchorPosition {
  BELOW,
  ABOVE,
}

export const enum AnchorAxisAlignment {
  VERTICAL,
  HORIZONTAL,
}

interface IPosition {
  readonly top: number;
  readonly left: number;
}

interface ISize {
  readonly width: number;
  readonly height: number;
}

export interface IRect extends IPosition, ISize {}

export type AnchoredAlignment = 'start' | 'end' | 'center';
export type AnchoredPlacement = 'above' | 'below';
export type AnchoredPlacementPreference = 'auto' | AnchoredPlacement;

export type AnchoredRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnchoredVerticalPlacementResult = {
  placement: AnchoredPlacement;
  canFitAbove: boolean;
  canFitBelow: boolean;
  spaceAbove: number;
  spaceBelow: number;
};

export type AnchoredOverlayAxisMode = 'align' | 'avoid';
export type AnchoredOverlayAxisPosition = 'before' | 'after';

export type AnchoredOverlayAxisAnchor = {
  offset: number;
  size: number;
  mode?: AnchoredOverlayAxisMode;
  position: AnchoredOverlayAxisPosition;
};

export const enum LayoutAnchorPosition {
  Before,
  After,
}

export enum LayoutAnchorMode {
  AVOID,
  ALIGN,
}

export interface ILayoutAnchor {
  offset: number;
  size: number;
  mode?: LayoutAnchorMode;
  position: LayoutAnchorPosition;
}

export interface ILayoutResult {
  position: number;
  result: 'ok' | 'flipped' | 'overlap';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveAnchoredOverlayAxisBoundaries(anchor: AnchoredOverlayAxisAnchor) {
  const mode = anchor.mode ?? 'avoid';
  return {
    afterBoundary: mode === 'align' ? anchor.offset : anchor.offset + anchor.size,
    beforeBoundary: mode === 'align' ? anchor.offset + anchor.size : anchor.offset,
  };
}

export function resolveAnchoredOverlayAxisPosition(
  viewportSize: number,
  overlaySize: number,
  anchor: AnchoredOverlayAxisAnchor,
) {
  const {
    afterBoundary,
    beforeBoundary,
  } = resolveAnchoredOverlayAxisBoundaries(anchor);

  if (anchor.position === 'before') {
    if (overlaySize <= viewportSize - afterBoundary) {
      return afterBoundary;
    }

    if (overlaySize <= beforeBoundary) {
      return beforeBoundary - overlaySize;
    }

    return Math.max(viewportSize - overlaySize, 0);
  }

  if (overlaySize <= beforeBoundary) {
    return beforeBoundary - overlaySize;
  }

  if (overlaySize <= viewportSize - afterBoundary) {
    return afterBoundary;
  }

  return 0;
}

export function resolveAnchoredHorizontalLeft(options: {
  anchorRect: AnchoredRect;
  overlayWidth: number;
  viewportWidth: number;
  viewportMargin: number;
  alignment?: AnchoredAlignment;
}) {
  const {
    anchorRect,
    overlayWidth,
    viewportWidth,
    viewportMargin,
    alignment = 'start',
  } = options;

  const preferredLeft =
    alignment === 'center'
      ? anchorRect.x + (anchorRect.width - overlayWidth) / 2
      : alignment === 'end'
        ? anchorRect.x + anchorRect.width - overlayWidth
        : anchorRect.x;

  return clamp(
    preferredLeft,
    viewportMargin,
    Math.max(viewportMargin, viewportWidth - overlayWidth - viewportMargin),
  );
}

export function resolveAnchoredVerticalPlacement(options: {
  anchorRect: AnchoredRect;
  overlayHeight: number;
  viewportHeight: number;
  viewportMargin: number;
  offset: number;
  preference?: AnchoredPlacementPreference;
}): AnchoredVerticalPlacementResult {
  const {
    anchorRect,
    overlayHeight,
    viewportHeight,
    viewportMargin,
    offset,
    preference = 'auto',
  } = options;

  const spaceBelow =
    viewportHeight - anchorRect.y - anchorRect.height - viewportMargin;
  const spaceAbove = anchorRect.y - viewportMargin;
  const canFitBelow = spaceBelow >= overlayHeight + offset;
  const canFitAbove = spaceAbove >= overlayHeight + offset;

  const placement =
    preference === 'above'
      ? 'above'
      : preference === 'below'
        ? 'below'
        : canFitBelow || !canFitAbove
          ? 'below'
          : 'above';

  return {
    placement,
    canFitAbove,
    canFitBelow,
    spaceAbove,
    spaceBelow,
  };
}

export function resolveAnchoredVerticalPlacementWithFallback(options: {
  preference?: AnchoredPlacementPreference;
  placement: Pick<
    AnchoredVerticalPlacementResult,
    'placement' | 'canFitAbove' | 'canFitBelow'
  >;
}) {
  const {
    preference = 'auto',
    placement,
  } = options;

  if (preference === 'above') {
    return placement.canFitAbove || !placement.canFitBelow ? 'above' : 'below';
  }

  if (preference === 'below') {
    return placement.canFitBelow || !placement.canFitAbove ? 'below' : 'above';
  }

  return placement.placement;
}

export function resolveAnchoredVerticalTop(options: {
  anchorRect: AnchoredRect;
  overlayHeight: number;
  viewportHeight: number;
  viewportMargin: number;
  offset: number;
  placement: AnchoredPlacement;
}) {
  const {
    anchorRect,
    overlayHeight,
    viewportHeight,
    viewportMargin,
    offset,
    placement,
  } = options;

  const nextTop =
    placement === 'above'
      ? anchorRect.y - overlayHeight - offset
      : anchorRect.y + anchorRect.height + offset;

  const maxTop = Math.max(
    viewportMargin,
    viewportHeight - overlayHeight - viewportMargin,
  );

  return clamp(
    nextTop,
    viewportMargin,
    maxTop,
  );
}

export function layout(
  viewportSize: number,
  viewSize: number,
  anchor: ILayoutAnchor,
): ILayoutResult {
  const layoutAfterAnchorBoundary =
    anchor.mode === LayoutAnchorMode.ALIGN ? anchor.offset : anchor.offset + anchor.size;
  const layoutBeforeAnchorBoundary =
    anchor.mode === LayoutAnchorMode.ALIGN ? anchor.offset + anchor.size : anchor.offset;

  if (anchor.position === LayoutAnchorPosition.Before) {
    if (viewSize <= viewportSize - layoutAfterAnchorBoundary) {
      return { position: layoutAfterAnchorBoundary, result: 'ok' };
    }

    if (viewSize <= layoutBeforeAnchorBoundary) {
      return { position: layoutBeforeAnchorBoundary - viewSize, result: 'flipped' };
    }

    return { position: Math.max(viewportSize - viewSize, 0), result: 'overlap' };
  }

  if (viewSize <= layoutBeforeAnchorBoundary) {
    return { position: layoutBeforeAnchorBoundary - viewSize, result: 'ok' };
  }

  if (
    viewSize <= viewportSize - layoutAfterAnchorBoundary &&
    layoutBeforeAnchorBoundary < viewSize / 2
  ) {
    return { position: layoutAfterAnchorBoundary, result: 'flipped' };
  }

  return { position: 0, result: 'overlap' };
}

interface ILayout2DOptions {
  readonly anchorAlignment?: AnchorAlignment;
  readonly anchorPosition?: AnchorPosition;
  readonly anchorAxisAlignment?: AnchorAxisAlignment;
}

export interface ILayout2DResult {
  top: number;
  left: number;
  bottom: number;
  right: number;
  anchorAlignment: AnchorAlignment;
  anchorPosition: AnchorPosition;
}

export function layout2d(
  viewport: IRect,
  view: ISize,
  anchor: IRect,
  options?: ILayout2DOptions,
): ILayout2DResult {
  let anchorAlignment = options?.anchorAlignment ?? AnchorAlignment.LEFT;
  let anchorPosition = options?.anchorPosition ?? AnchorPosition.BELOW;
  const anchorAxisAlignment =
    options?.anchorAxisAlignment ?? AnchorAxisAlignment.VERTICAL;

  let top: number;
  let left: number;

  if (anchorAxisAlignment === AnchorAxisAlignment.VERTICAL) {
    const verticalAnchor: ILayoutAnchor = {
      offset: anchor.top - viewport.top,
      size: anchor.height,
      position:
        anchorPosition === AnchorPosition.BELOW
          ? LayoutAnchorPosition.Before
          : LayoutAnchorPosition.After,
    };
    const horizontalAnchor: ILayoutAnchor = {
      offset: anchor.left,
      size: anchor.width,
      position:
        anchorAlignment === AnchorAlignment.LEFT
          ? LayoutAnchorPosition.Before
          : LayoutAnchorPosition.After,
      mode: LayoutAnchorMode.ALIGN,
    };

    const verticalLayoutResult = layout(viewport.height, view.height, verticalAnchor);
    top = verticalLayoutResult.position + viewport.top;

    if (verticalLayoutResult.result === 'flipped') {
      anchorPosition =
        anchorPosition === AnchorPosition.BELOW
          ? AnchorPosition.ABOVE
          : AnchorPosition.BELOW;
    }

    if (
      Range.intersects(
        { start: top, end: top + view.height },
        { start: verticalAnchor.offset, end: verticalAnchor.offset + verticalAnchor.size },
      )
    ) {
      horizontalAnchor.mode = LayoutAnchorMode.AVOID;
    }

    const horizontalLayoutResult = layout(viewport.width, view.width, horizontalAnchor);
    left = horizontalLayoutResult.position;

    if (horizontalLayoutResult.result === 'flipped') {
      anchorAlignment =
        anchorAlignment === AnchorAlignment.LEFT
          ? AnchorAlignment.RIGHT
          : AnchorAlignment.LEFT;
    }
  } else {
    const horizontalAnchor: ILayoutAnchor = {
      offset: anchor.left,
      size: anchor.width,
      position:
        anchorAlignment === AnchorAlignment.LEFT
          ? LayoutAnchorPosition.Before
          : LayoutAnchorPosition.After,
    };
    const verticalAnchor: ILayoutAnchor = {
      offset: anchor.top,
      size: anchor.height,
      position:
        anchorPosition === AnchorPosition.BELOW
          ? LayoutAnchorPosition.Before
          : LayoutAnchorPosition.After,
      mode: LayoutAnchorMode.ALIGN,
    };

    const horizontalLayoutResult = layout(viewport.width, view.width, horizontalAnchor);
    left = horizontalLayoutResult.position;

    if (horizontalLayoutResult.result === 'flipped') {
      anchorAlignment =
        anchorAlignment === AnchorAlignment.LEFT
          ? AnchorAlignment.RIGHT
          : AnchorAlignment.LEFT;
    }

    if (
      Range.intersects(
        { start: left, end: left + view.width },
        { start: horizontalAnchor.offset, end: horizontalAnchor.offset + horizontalAnchor.size },
      )
    ) {
      verticalAnchor.mode = LayoutAnchorMode.AVOID;
    }

    const verticalLayoutResult = layout(viewport.height, view.height, verticalAnchor);
    top = verticalLayoutResult.position + viewport.top;

    if (verticalLayoutResult.result === 'flipped') {
      anchorPosition =
        anchorPosition === AnchorPosition.BELOW
          ? AnchorPosition.ABOVE
          : AnchorPosition.BELOW;
    }
  }

  const right = viewport.width - (left + view.width);
  const bottom = viewport.height - (top + view.height);

  return { top, left, bottom, right, anchorAlignment, anchorPosition };
}
