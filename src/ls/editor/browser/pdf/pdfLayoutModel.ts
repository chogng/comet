import type {
  PdfRect,
  PdfReviewerPageInfo,
  PdfTextChar,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';

export type PdfTextBoundary = {
  page: number;
  charOffset: number;
};

export type PdfTextIndexBoundary = {
  page: number;
  charIndex: number;
};

export type PdfTextHitTest = {
  page: number;
  lineId: string;
  lineIndex: number;
  lineText: string;
  charOffset: number;
  point: {
    x: number;
    y: number;
  };
  lineCenterY: number;
};

export type PdfLayoutChar = PdfTextChar & {
  lineId?: string;
  layoutX?: number;
  layoutWidth?: number;
};

export type PdfLayoutLine = {
  id: string;
  page: number;
  startCharOffset: number;
  endCharOffset: number;
  text: string;
  rect: PdfRect;
  selectionRect: PdfRect;
  readingOrder: number;
};

export type PdfLayoutSelectionRange = {
  page: number;
  startCharOffset: number;
  endCharOffset: number;
  text: string;
  rects: readonly PdfRect[];
  lineIds: readonly string[];
  textSpans: readonly PdfLayoutTextSpan[];
  textRange: {
    startCharIndex: number;
    endCharIndex: number;
  };
};

export type PdfLayoutTextSpan = {
  startTextIndex: number;
  endTextIndex: number;
};

export type PdfLayoutPage = {
  page: number;
  width: number;
  height: number;
  chars: readonly PdfLayoutChar[];
  lines: readonly PdfLayoutLine[];
};

type MutablePdfLayoutChar = PdfLayoutChar;

type PositionedPdfLayoutChar = MutablePdfLayoutChar & { rect: PdfRect };

type MutablePdfLayoutLine = Omit<PdfLayoutLine, 'text' | 'selectionRect'> & {
  text: string;
  chars: MutablePdfLayoutChar[];
  centerY: number;
  averageHeight: number;
  selectionCenterY?: number;
  selectionHeight?: number;
  selectionBaseHeight?: number;
  selectionRect?: PdfRect;
};

function cloneRect(rect: PdfRect): PdfRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function getRectRight(rect: PdfRect) {
  return rect.x + rect.width;
}

function getRectTop(rect: PdfRect) {
  return rect.y + rect.height;
}

function unionRects(rects: readonly PdfRect[]): PdfRect | null {
  const first = rects[0];
  if (!first) {
    return null;
  }

  let left = first.x;
  let right = getRectRight(first);
  let bottom = first.y;
  let top = getRectTop(first);

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x);
    right = Math.max(right, getRectRight(rect));
    bottom = Math.min(bottom, rect.y);
    top = Math.max(top, getRectTop(rect));
  }

  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
  };
}

function getRectCenterY(rect: PdfRect) {
  return rect.y + rect.height / 2;
}

function getMedian(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function hasCharRect(char: MutablePdfLayoutChar): char is PositionedPdfLayoutChar {
  return Boolean(char.rect);
}

function getCharLayoutX(char: PdfLayoutChar) {
  return char.layoutX ?? char.rect?.x ?? 0;
}

function getCharLayoutRight(char: PdfLayoutChar) {
  return getCharLayoutX(char) + (char.layoutWidth ?? char.rect?.width ?? 0);
}

function compareCharsVisually(a: PdfLayoutChar, b: PdfLayoutChar) {
  return getCharLayoutX(a) - getCharLayoutX(b) || a.index - b.index;
}

function compareLinesVisually(a: MutablePdfLayoutLine, b: MutablePdfLayoutLine) {
  return getRectCenterY(b.rect) - getRectCenterY(a.rect) || a.rect.x - b.rect.x;
}

type PdfLayoutColumn = {
  left: number;
  right: number;
  lines: MutablePdfLayoutLine[];
};

function getLineHorizontalTolerance(line: MutablePdfLayoutLine, pageWidth: number) {
  return Math.max(pageWidth * 0.025, line.averageHeight * 1.5, 4);
}

function overlapsColumn(line: MutablePdfLayoutLine, column: PdfLayoutColumn, pageWidth: number) {
  const tolerance = getLineHorizontalTolerance(line, pageWidth);
  return getRectRight(line.rect) >= column.left - tolerance &&
    line.rect.x <= column.right + tolerance;
}

function createLayoutColumns(lines: readonly MutablePdfLayoutLine[], pageWidth: number) {
  const columnCandidates = lines
    .filter((line) => line.rect.width <= pageWidth * 0.58)
    .sort((a, b) => a.rect.x - b.rect.x || getRectCenterY(b.rect) - getRectCenterY(a.rect));
  const columns: PdfLayoutColumn[] = [];

  for (const line of columnCandidates) {
    const column = columns.find((candidate) => overlapsColumn(line, candidate, pageWidth));
    if (!column) {
      columns.push({
        left: line.rect.x,
        right: getRectRight(line.rect),
        lines: [line],
      });
      continue;
    }

    column.left = Math.min(column.left, line.rect.x);
    column.right = Math.max(column.right, getRectRight(line.rect));
    column.lines.push(line);
  }

  const significantColumns = columns.filter((column) => column.lines.length >= 2);
  const readableColumns = significantColumns.length >= 2
    ? significantColumns
    : columns.length >= 2
      ? columns
      : [];
  return readableColumns.sort((a, b) => a.left - b.left);
}

function getLineColumnIndex(
  line: MutablePdfLayoutLine,
  columns: readonly PdfLayoutColumn[],
  pageWidth: number,
) {
  const overlappingColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => overlapsColumn(line, column, pageWidth));
  if (overlappingColumns.length === 1) {
    return overlappingColumns[0].index;
  }

  return -1;
}

function sortColumnLinesByReadingOrder(
  lines: readonly MutablePdfLayoutLine[],
  columns: readonly PdfLayoutColumn[],
  pageWidth: number,
) {
  const linesByColumn = columns.map(() => [] as MutablePdfLayoutLine[]);
  for (const line of lines) {
    const columnIndex = getLineColumnIndex(line, columns, pageWidth);
    if (columnIndex >= 0) {
      linesByColumn[columnIndex].push(line);
    }
  }

  return linesByColumn.flatMap((columnLines) => {
    return columnLines.sort(compareLinesVisually);
  });
}

function sortLinesByReadingOrder(lines: readonly MutablePdfLayoutLine[], pageWidth: number) {
  const visualLines = [...lines].sort(compareLinesVisually);
  const columns = createLayoutColumns(visualLines, pageWidth);
  if (columns.length < 2) {
    return visualLines;
  }

  const orderedLines: MutablePdfLayoutLine[] = [];
  let pendingColumnLines: MutablePdfLayoutLine[] = [];
  for (const line of visualLines) {
    if (getLineColumnIndex(line, columns, pageWidth) >= 0) {
      pendingColumnLines.push(line);
      continue;
    }

    orderedLines.push(
      ...sortColumnLinesByReadingOrder(pendingColumnLines, columns, pageWidth),
      line,
    );
    pendingColumnLines = [];
  }

  orderedLines.push(...sortColumnLinesByReadingOrder(pendingColumnLines, columns, pageWidth));
  return orderedLines;
}

function canAppendToLine(line: MutablePdfLayoutLine, rect: PdfRect) {
  const lineCenterY = line.centerY;
  const rectCenterY = getRectCenterY(rect);
  const lineHeight = Math.max(line.averageHeight, rect.height, 1);
  const centerDistance = Math.abs(lineCenterY - rectCenterY);
  const horizontalGap = Math.max(
    0,
    rect.x - getRectRight(line.rect),
    line.rect.x - getRectRight(rect),
  );
  if (centerDistance <= lineHeight * 0.85 && horizontalGap <= lineHeight * 3) {
    return true;
  }

  const smallerHeight = Math.min(line.averageHeight, rect.height);
  const isSmallGlyphNearLine =
    smallerHeight <= lineHeight * 0.65 &&
    centerDistance <= lineHeight * 1.15 &&
    rect.x <= getRectRight(line.rect) + lineHeight * 1.2 &&
    getRectRight(rect) >= line.rect.x - lineHeight * 1.2;
  return isSmallGlyphNearLine;
}

function appendCharToLine(line: MutablePdfLayoutLine, char: PositionedPdfLayoutChar) {
  const nextCount = line.chars.length + 1;
  line.centerY = (line.centerY * line.chars.length + getRectCenterY(char.rect)) / nextCount;
  line.averageHeight = (line.averageHeight * line.chars.length + char.rect.height) / nextCount;
  line.chars.push(char);
  line.rect = unionRects([line.rect, char.rect]) ?? line.rect;
}

function getLineByPositionedCharIndex(lines: readonly MutablePdfLayoutLine[]) {
  const lineByCharIndex = new Map<number, MutablePdfLayoutLine>();
  for (const line of lines) {
    for (const char of line.chars) {
      if (hasCharRect(char)) {
        lineByCharIndex.set(char.index, line);
      }
    }
  }

  return lineByCharIndex;
}

function findPreviousPositionedChar(
  chars: readonly MutablePdfLayoutChar[],
  startIndex: number,
) {
  for (let index = startIndex; index >= 0; index -= 1) {
    const char = chars[index];
    if (char && hasCharRect(char)) {
      return char;
    }
  }

  return undefined;
}

function findNextPositionedChar(
  chars: readonly MutablePdfLayoutChar[],
  startIndex: number,
) {
  for (let index = startIndex; index < chars.length; index += 1) {
    const char = chars[index];
    if (char && hasCharRect(char)) {
      return char;
    }
  }

  return undefined;
}

function assignUnpositionedRunToLine(
  run: readonly MutablePdfLayoutChar[],
  targetLine: MutablePdfLayoutLine,
  previousChar: PositionedPdfLayoutChar | undefined,
  nextChar: PositionedPdfLayoutChar | undefined,
) {
  const fallbackStep = Math.max(targetLine.averageHeight * 0.32, 1);
  const startX = previousChar ? getRectRight(previousChar.rect) : undefined;
  const endX = nextChar?.rect.x;

  for (let index = 0; index < run.length; index += 1) {
    const char = run[index];
    if (startX !== undefined && endX !== undefined) {
      char.layoutX = startX + ((endX - startX) * (index + 1)) / (run.length + 1);
    } else if (startX !== undefined) {
      char.layoutX = startX + fallbackStep * (index + 1);
    } else if (endX !== undefined) {
      char.layoutX = endX - fallbackStep * (run.length - index);
    } else {
      char.layoutX = targetLine.rect.x + fallbackStep * index;
    }
    char.layoutWidth = fallbackStep;
    targetLine.chars.push(char);
  }
}

function appendUnpositionedCharsToLines(
  chars: readonly MutablePdfLayoutChar[],
  lines: readonly MutablePdfLayoutLine[],
) {
  const lineByCharIndex = getLineByPositionedCharIndex(lines);
  let index = 0;
  while (index < chars.length) {
    if (hasCharRect(chars[index])) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < chars.length && !hasCharRect(chars[index])) {
      index += 1;
    }

    const run = chars.slice(runStart, index);
    const previousChar = findPreviousPositionedChar(chars, runStart - 1);
    const nextChar = findNextPositionedChar(chars, index);
    const previousLine = previousChar ? lineByCharIndex.get(previousChar.index) : undefined;
    const nextLine = nextChar ? lineByCharIndex.get(nextChar.index) : undefined;
    const hasNonWhitespace = run.some((char) => /\S/u.test(char.char));
    const targetLine = previousLine && previousLine === nextLine
      ? previousLine
      : hasNonWhitespace
        ? previousLine ?? nextLine
        : undefined;

    if (targetLine) {
      assignUnpositionedRunToLine(
        run,
        targetLine,
        previousLine === targetLine ? previousChar : undefined,
        nextLine === targetLine ? nextChar : undefined,
      );
    }
  }
}

function expandLineSelectionRect(
  line: MutablePdfLayoutLine,
  pageHeight: number,
  previousLine: MutablePdfLayoutLine | undefined,
  nextLine: MutablePdfLayoutLine | undefined,
): PdfRect {
  const lineHeight = line.selectionHeight ?? line.averageHeight;
  const centerY = line.selectionCenterY ?? getRectCenterY(line.rect);
  let bottom = Math.max(0, centerY - lineHeight / 2);
  let top = Math.min(pageHeight, centerY + lineHeight / 2);

  if (previousLine) {
    const previousCenterY = previousLine.selectionCenterY ?? getRectCenterY(previousLine.rect);
    if (previousCenterY > centerY) {
      top = Math.min(top, (previousCenterY + centerY) / 2);
    }
  }

  if (nextLine) {
    const nextCenterY = nextLine.selectionCenterY ?? getRectCenterY(nextLine.rect);
    if (nextCenterY < centerY) {
      bottom = Math.max(bottom, (nextCenterY + centerY) / 2);
    }
  }

  if (top < bottom) {
    const collapsedY = centerY;
    bottom = collapsedY;
    top = collapsedY;
  }

  return {
    x: line.rect.x,
    y: bottom,
    width: line.rect.width,
    height: top - bottom,
  };
}

function getLineSelectionMetrics(line: MutablePdfLayoutLine) {
  const positionedChars = line.chars.filter(hasCharRect);
  const heights = positionedChars.map((char) => char.rect.height);
  const medianHeight = getMedian(heights);
  const dominantChars = medianHeight > 0
    ? positionedChars.filter((char) => char.rect.height >= medianHeight * 0.7)
    : positionedChars;
  const metricChars = dominantChars.length > 0 ? dominantChars : positionedChars;
  const metricHeights = metricChars.map((char) => char.rect.height);
  const metricMedianHeight = getMedian(metricHeights);
  const bounds = unionRects(metricChars.map((char) => char.rect));
  const boundsHeight = bounds?.height ?? line.rect.height ?? 0;
  const centerY = bounds
    ? getRectCenterY(bounds)
    : metricChars.length > 0
      ? metricChars.reduce((sum, char) => sum + getRectCenterY(char.rect), 0) / metricChars.length
      : getRectCenterY(line.rect);

  const baseHeight = Math.max(boundsHeight, metricMedianHeight, line.averageHeight, 1);
  const inset = Math.min(baseHeight * 0.28, 3.5);

  return {
    centerY,
    baseHeight,
    // Row highlight should be thicker than glyph boxes so it reads as a stable line band.
    height: Math.max(baseHeight + inset * 2, line.averageHeight * 1.4, 1),
  };
}

function createLineId(page: number, index: number) {
  return `pdf_line_${page}_${index + 1}`;
}

function createSelectionRectForLineRange(
  page: PdfLayoutPage,
  line: PdfLayoutLine,
  lineStart: number,
  lineEnd: number,
): PdfRect | null {
  const selectedChars = page.chars.slice(lineStart, lineEnd);
  if (selectedChars.length === 0) {
    return null;
  }

  const left = Math.min(...selectedChars.map((char) => char.rect?.x ?? getCharLayoutX(char)));
  const right = Math.max(...selectedChars.map((char) => char.rect ? getRectRight(char.rect) : getCharLayoutRight(char)));
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
    return null;
  }

  const horizontalInset = Math.min(line.selectionRect.height * 0.08, 1.6);
  return {
    x: Math.max(0, left - horizontalInset),
    y: line.selectionRect.y,
    width: right - left + horizontalInset * 2,
    height: line.selectionRect.height,
  };
}

function createTextSpansForChars(chars: readonly PdfLayoutChar[]): readonly PdfLayoutTextSpan[] {
  const orderedIndices = chars
    .map((char) => char.index)
    .filter((index) => Number.isFinite(index));
  const firstIndex = orderedIndices[0];
  if (firstIndex === undefined) {
    return [];
  }

  const spans: PdfLayoutTextSpan[] = [];
  let spanStart = firstIndex;
  let spanEnd = firstIndex + 1;
  for (const index of orderedIndices.slice(1)) {
    if (index === spanEnd) {
      spanEnd = index + 1;
      continue;
    }

    spans.push({
      startTextIndex: spanStart,
      endTextIndex: spanEnd,
    });
    spanStart = index;
    spanEnd = index + 1;
  }

  spans.push({
    startTextIndex: spanStart,
    endTextIndex: spanEnd,
  });
  return spans;
}

export function createPdfLayoutPage(info: PdfReviewerPageInfo): PdfLayoutPage {
  const lineClusters: MutablePdfLayoutLine[] = [];
  const sourceChars: MutablePdfLayoutChar[] = info.chars.map((char) => ({
    ...char,
    layoutX: char.rect?.x,
    layoutWidth: char.rect?.width,
  }));
  const positionedChars = sourceChars
    .filter(hasCharRect)
    .sort((a, b) =>
      getRectCenterY(b.rect) - getRectCenterY(a.rect) ||
      a.rect.x - b.rect.x ||
      a.index - b.index,
    );

  for (const char of positionedChars) {
    let bestLine: MutablePdfLayoutLine | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of lineClusters) {
      if (!canAppendToLine(line, char.rect)) {
        continue;
      }
      const distance = Math.abs(getRectCenterY(line.rect) - getRectCenterY(char.rect));
      if (distance < bestDistance) {
        bestLine = line;
        bestDistance = distance;
      }
    }

    if (!bestLine) {
      lineClusters.push({
        id: '',
        page: info.page,
        startCharOffset: 0,
        endCharOffset: 0,
        text: '',
        chars: [char],
        centerY: getRectCenterY(char.rect),
        averageHeight: char.rect.height,
        rect: cloneRect(char.rect),
        readingOrder: 0,
      });
      continue;
    }

    appendCharToLine(bestLine, char);
  }

  appendUnpositionedCharsToLines(sourceChars, lineClusters);

  const lines = sortLinesByReadingOrder(lineClusters, info.pageWidth)
    .map((line, index): MutablePdfLayoutLine => {
      const orderedChars = line.chars.sort(compareCharsVisually);
      const metrics = getLineSelectionMetrics({
        ...line,
        chars: orderedChars,
      });
      return {
        ...line,
        id: createLineId(info.page, index),
        chars: orderedChars,
        text: orderedChars.map((char) => char.char).join(''),
        centerY: line.centerY,
        averageHeight: line.averageHeight,
        selectionCenterY: metrics.centerY,
        selectionHeight: metrics.height,
        selectionBaseHeight: metrics.baseHeight,
        readingOrder: index,
      };
    });

  // Bump selection band heights towards typical line spacing (within a cap) to avoid visible
  // gaps between adjacent selection rows in PDFs with loose line spacing.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.selectionHeight || !line.selectionCenterY) {
      continue;
    }

    const previousLine = lines[index - 1];
    const nextLine = lines[index + 1];
    const distances: number[] = [];

    if (previousLine?.selectionCenterY !== undefined) {
      distances.push(Math.abs(previousLine.selectionCenterY - line.selectionCenterY));
    }
    if (nextLine?.selectionCenterY !== undefined) {
      distances.push(Math.abs(line.selectionCenterY - nextLine.selectionCenterY));
    }

    const nearestDistance = Math.min(...distances.filter((value) => Number.isFinite(value) && value > 0));
    if (!Number.isFinite(nearestDistance)) {
      continue;
    }

    const baseHeight = line.selectionBaseHeight ?? line.averageHeight ?? 0;
    const capHeight = Math.max(baseHeight * 2.4, line.selectionHeight);
    line.selectionHeight = Math.max(line.selectionHeight, Math.min(nearestDistance, capHeight));
  }

  const chars = lines.flatMap((line, lineIndex) => {
    const startCharOffset = lines
      .slice(0, lineIndex)
      .reduce((offset, previousLine) => offset + previousLine.chars.length, 0);
    line.startCharOffset = startCharOffset;
    line.endCharOffset = startCharOffset + line.chars.length;
    for (const char of line.chars) {
      char.lineId = line.id;
    }
    return line.chars;
  });

  const finalizedLines = lines.map((line, index): PdfLayoutLine => {
    const selectionRect = expandLineSelectionRect(
      line,
      info.pageHeight,
      lines[index - 1],
      lines[index + 1],
    );
    return {
      id: line.id,
      page: line.page,
      startCharOffset: line.startCharOffset,
      endCharOffset: line.endCharOffset,
      text: line.text,
      rect: line.rect,
      readingOrder: line.readingOrder,
      selectionRect,
    };
  });

  return {
    page: info.page,
    width: info.pageWidth,
    height: info.pageHeight,
    chars,
    lines: finalizedLines,
  };
}

export function viewportPointToPdfPoint(
  page: PdfLayoutPage,
  scale: number,
  point: { x: number; y: number },
) {
  return {
    x: point.x / scale,
    y: page.height - point.y / scale,
  };
}

function findNearestLine(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  strict: boolean,
) {
  let nearestLine: PdfLayoutLine | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestMatchedLine: PdfLayoutLine | null = null;
  let nearestMatchedDistance = Number.POSITIVE_INFINITY;

  for (const line of page.lines) {
    const yTolerance = Math.max(line.selectionRect.height * 0.75, 5);
    const xTolerance = Math.max(line.selectionRect.height * 0.9, 8);
    const lineTop = getRectTop(line.selectionRect);
    const lineRight = getRectRight(line.selectionRect);
    const inYBand = point.y >= line.selectionRect.y - yTolerance && point.y <= lineTop + yTolerance;
    const inXBand = point.x >= line.selectionRect.x - xTolerance && point.x <= lineRight + xTolerance;
    const lineDistance = Math.abs(getRectCenterY(line.selectionRect) - point.y);

    if (inYBand && (!strict || inXBand)) {
      if (lineDistance < nearestMatchedDistance) {
        nearestMatchedLine = line;
        nearestMatchedDistance = lineDistance;
      }
    }

    const clampedX = Math.min(Math.max(point.x, line.selectionRect.x), lineRight);
    const clampedY = Math.min(Math.max(point.y, line.selectionRect.y), lineTop);
    const distance = Math.hypot(point.x - clampedX, point.y - clampedY);
    if (distance < nearestDistance) {
      nearestLine = line;
      nearestDistance = distance;
    }
  }

  return nearestMatchedLine ?? (strict ? null : nearestLine);
}

export function findPdfTextBoundaryAtPoint(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  options: { strict?: boolean } = {},
): PdfTextBoundary | null {
  const line = findNearestLine(page, point, options.strict === true);
  if (!line) {
    return null;
  }

  let nearestBoundary: PdfTextBoundary = {
    page: page.page,
    charOffset: point.x <= line.selectionRect.x
      ? line.startCharOffset
      : line.endCharOffset,
  };
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let position = line.startCharOffset; position < line.endCharOffset; position += 1) {
    const char = page.chars[position];
    if (!char) {
      continue;
    }

    const charLeft = char.rect?.x ?? getCharLayoutX(char);
    const charRight = char.rect ? getRectRight(char.rect) : getCharLayoutRight(char);
    const charBottom = char.rect?.y ?? line.selectionRect.y;
    const charTop = char.rect ? getRectTop(char.rect) : getRectTop(line.selectionRect);
    const centerX = (charLeft + charRight) / 2;
    const contains =
      point.x >= charLeft &&
      point.x <= charRight &&
      point.y >= charBottom &&
      point.y <= charTop;
    if (contains) {
      return {
        page: page.page,
        charOffset: position + (point.x < centerX ? 0 : 1),
      };
    }

    const centerY = char.rect ? getRectCenterY(char.rect) : getRectCenterY(line.selectionRect);
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    if (distance < nearestDistance) {
      nearestBoundary = {
        page: page.page,
        charOffset: position + (point.x < centerX ? 0 : 1),
      };
      nearestDistance = distance;
    }
  }

  return nearestBoundary;
}

export function findPdfTextIndexBoundaryAtPoint(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  options: { strict?: boolean } = {},
): PdfTextIndexBoundary | null {
  const line = findNearestLine(page, point, options.strict === true);
  if (!line) {
    return null;
  }

  const firstChar = page.chars[line.startCharOffset];
  const lastChar = page.chars[line.endCharOffset - 1];
  let nearestBoundary: PdfTextIndexBoundary = {
    page: page.page,
    charIndex: point.x <= line.selectionRect.x
      ? firstChar?.index ?? 0
      : (lastChar?.index ?? 0) + 1,
  };
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let position = line.startCharOffset; position < line.endCharOffset; position += 1) {
    const char = page.chars[position];
    if (!char) {
      continue;
    }

    const charLeft = char.rect?.x ?? getCharLayoutX(char);
    const charRight = char.rect ? getRectRight(char.rect) : getCharLayoutRight(char);
    const charBottom = char.rect?.y ?? line.selectionRect.y;
    const charTop = char.rect ? getRectTop(char.rect) : getRectTop(line.selectionRect);
    const centerX = (charLeft + charRight) / 2;
    const contains =
      point.x >= charLeft &&
      point.x <= charRight &&
      point.y >= charBottom &&
      point.y <= charTop;
    if (contains) {
      return {
        page: page.page,
        charIndex: char.index + (point.x < centerX ? 0 : 1),
      };
    }

    const centerY = char.rect ? getRectCenterY(char.rect) : getRectCenterY(line.selectionRect);
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    if (distance < nearestDistance) {
      nearestBoundary = {
        page: page.page,
        charIndex: char.index + (point.x < centerX ? 0 : 1),
      };
      nearestDistance = distance;
    }
  }

  return nearestBoundary;
}

export function findPdfTextHitTestAtPoint(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  options: { strict?: boolean } = {},
): PdfTextHitTest | null {
  const line = findNearestLine(page, point, options.strict === true);
  if (!line) {
    return null;
  }

  const boundary = findPdfTextBoundaryAtPoint(page, point, options);
  if (!boundary) {
    return null;
  }

  return {
    page: page.page,
    lineId: line.id,
    lineIndex: line.readingOrder + 1,
    lineText: line.text,
    charOffset: boundary.charOffset,
    point,
    lineCenterY: getRectCenterY(line.selectionRect),
  };
}

export function findPdfTextCharAtPoint(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  options: { strict?: boolean } = {},
) {
  const line = findNearestLine(page, point, options.strict === true);
  if (!line) {
    return null;
  }

  let nearest: PdfLayoutChar | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let position = line.startCharOffset; position < line.endCharOffset; position += 1) {
    const char = page.chars[position];
    if (!char) {
      continue;
    }

    const charLeft = char.rect?.x ?? getCharLayoutX(char);
    const charRight = char.rect ? getRectRight(char.rect) : getCharLayoutRight(char);
    const charBottom = char.rect?.y ?? line.selectionRect.y;
    const charTop = char.rect ? getRectTop(char.rect) : getRectTop(line.selectionRect);
    const contains =
      point.x >= charLeft &&
      point.x <= charRight &&
      point.y >= charBottom &&
      point.y <= charTop;
    if (contains) {
      return char;
    }

    const centerX = (charLeft + charRight) / 2;
    const centerY = char.rect ? getRectCenterY(char.rect) : getRectCenterY(line.selectionRect);
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    if (distance < nearestDistance) {
      nearest = char;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function createPdfLayoutSelectionRange(
  page: PdfLayoutPage,
  startCharOffset: number,
  endCharOffset: number,
): PdfLayoutSelectionRange | null {
  const start = Math.max(0, Math.min(startCharOffset, endCharOffset));
  const end = Math.min(page.chars.length, Math.max(startCharOffset, endCharOffset));
  const chars = page.chars.slice(start, end);
  if (chars.length === 0) {
    return null;
  }

  const rects: PdfRect[] = [];
  const lineIds: string[] = [];

  for (const line of page.lines) {
    const lineStart = Math.max(start, line.startCharOffset);
    const lineEnd = Math.min(end, line.endCharOffset);
    if (lineStart >= lineEnd) {
      continue;
    }

    const selectionRect = createSelectionRectForLineRange(page, line, lineStart, lineEnd);
    if (selectionRect) {
      rects.push(selectionRect);
    }
    lineIds.push(line.id);
  }

  return {
    page: page.page,
    startCharOffset: start,
    endCharOffset: end,
    text: chars.map((char) => char.char).join(''),
    rects,
    lineIds,
    textSpans: createTextSpansForChars(chars),
    textRange: {
      startCharIndex: Math.min(...chars.map((char) => char.index)),
      endCharIndex: Math.max(...chars.map((char) => char.index)),
    },
  };
}

export function createPdfLayoutTextIndexSelectionRange(
  page: PdfLayoutPage,
  startCharIndex: number,
  endCharIndex: number,
): PdfLayoutSelectionRange | null {
  const startIndex = Math.min(startCharIndex, endCharIndex);
  const endIndex = Math.max(startCharIndex, endCharIndex);
  if (startIndex === endIndex) {
    return null;
  }

  const selectedEntries: Array<{ char: PdfLayoutChar; offset: number }> = [];
  for (let offset = 0; offset < page.chars.length; offset += 1) {
    const char = page.chars[offset];
    if (char.index >= startIndex && char.index < endIndex) {
      selectedEntries.push({ char, offset });
    }
  }

  if (selectedEntries.length === 0) {
    return null;
  }

  const selectedTextChars = selectedEntries
    .map(({ char }) => char)
    .sort((a, b) => a.index - b.index);
  const selectedLayoutChars = selectedEntries
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map(({ char }) => char);
  const rects: PdfRect[] = [];
  const lineIds: string[] = [];

  for (const line of page.lines) {
    let hasSelectedLineChar = false;
    let lineStart = Number.POSITIVE_INFINITY;
    let lineEnd = Number.NEGATIVE_INFINITY;
    for (let offset = line.startCharOffset; offset < line.endCharOffset; offset += 1) {
      const char = page.chars[offset];
      if (char.index < startIndex || char.index >= endIndex) {
        continue;
      }

      hasSelectedLineChar = true;
      lineStart = Math.min(lineStart, offset);
      lineEnd = Math.max(lineEnd, offset + 1);
    }

    if (!hasSelectedLineChar) {
      continue;
    }

    const selectionRect = createSelectionRectForLineRange(page, line, lineStart, lineEnd);
    if (selectionRect) {
      rects.push(selectionRect);
    }
    lineIds.push(line.id);
  }

  const firstChar = selectedTextChars[0];
  const lastChar = selectedTextChars.at(-1);
  if (!firstChar || !lastChar) {
    return null;
  }

  const selectedOffsets = selectedEntries.map(({ offset }) => offset);
  const startCharOffset = Math.min(...selectedOffsets);
  const endCharOffset = Math.max(...selectedOffsets) + 1;

  return {
    page: page.page,
    startCharOffset,
    endCharOffset,
    text: selectedLayoutChars.map((char) => char.char).join(''),
    rects,
    lineIds,
    textSpans: [{
      startTextIndex: startIndex,
      endTextIndex: endIndex,
    }],
    textRange: {
      startCharIndex: firstChar.index,
      endCharIndex: lastChar.index,
    },
  };
}
