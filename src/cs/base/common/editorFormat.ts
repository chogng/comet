const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'math',
  'emoji',
  'fangsong',
]);

export type EditorNamedFontSizeName =
  | '初号'
  | '小初'
  | '一号'
  | '小一'
  | '二号'
  | '小二'
  | '三号'
  | '小三'
  | '四号'
  | '小四'
  | '五号'
  | '小五'
  | '六号'
  | '小六';

export type EditorNamedFontSizePreset = {
  name: EditorNamedFontSizeName;
  cssPx: number;
  pointSize: number;
  docxHalfPoints: number;
};

export const EDITOR_NAMED_FONT_SIZE_PRESETS: readonly EditorNamedFontSizePreset[] = [
  { name: '初号', cssPx: 56, pointSize: 42, docxHalfPoints: 84 },
  { name: '小初', cssPx: 48, pointSize: 36, docxHalfPoints: 72 },
  { name: '一号', cssPx: 35, pointSize: 26, docxHalfPoints: 52 },
  { name: '小一', cssPx: 32, pointSize: 24, docxHalfPoints: 48 },
  { name: '二号', cssPx: 29, pointSize: 22, docxHalfPoints: 44 },
  { name: '小二', cssPx: 24, pointSize: 18, docxHalfPoints: 36 },
  { name: '三号', cssPx: 21, pointSize: 16, docxHalfPoints: 32 },
  { name: '小三', cssPx: 20, pointSize: 15, docxHalfPoints: 30 },
  { name: '四号', cssPx: 19, pointSize: 14, docxHalfPoints: 28 },
  { name: '小四', cssPx: 16, pointSize: 12, docxHalfPoints: 24 },
  { name: '五号', cssPx: 14, pointSize: 10.5, docxHalfPoints: 21 },
  { name: '小五', cssPx: 12, pointSize: 9, docxHalfPoints: 18 },
  { name: '六号', cssPx: 10, pointSize: 7.5, docxHalfPoints: 15 },
  { name: '小六', cssPx: 9, pointSize: 6.5, docxHalfPoints: 13 },
] as const;

export const DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_NAME: EditorNamedFontSizeName = '五号';
const DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_CANDIDATE = EDITOR_NAMED_FONT_SIZE_PRESETS.find(
  (preset) => preset.name === DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_NAME,
);
if (!DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_CANDIDATE) {
  throw new Error(
    `Missing default editor body font-size preset: ${DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_NAME}`,
  );
}
export const DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET = DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET_CANDIDATE;
export const DEFAULT_EDITOR_BODY_FONT_SIZE_VALUE = `${DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET.cssPx}px`;

export type EditorResolvedFontSize = {
  cssPx: number;
  pointSize: number;
  docxHalfPoints: number;
  presetName: EditorNamedFontSizeName | null;
};

export type EditorParagraphVariant =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'figcaption';

export type EditorTypographySpec = {
  fontSizePx: number;
  lineHeight: number;
  bold: boolean;
  color: string;
};

export const DEFAULT_EDITOR_DOCX_FONT_ASCII = 'IBM Plex Serif';
export const DEFAULT_EDITOR_DOCX_FONT_EAST_ASIA = 'Source Han Serif SC';
export const DEFAULT_EDITOR_DOCX_BODY_FONT_SIZE_PX = DEFAULT_EDITOR_BODY_FONT_SIZE_PRESET.cssPx;
export const DEFAULT_EDITOR_DOCX_FIGCAPTION_FONT_SIZE_PX = 14.25;
export const DEFAULT_EDITOR_DOCX_HEADING_FONT_SIZE_PX = {
  1: 27.2,
  2: 21.6,
  3: 18.4,
} as const;

export const EDITOR_TYPOGRAPHY_SPEC: Readonly<Record<EditorParagraphVariant, EditorTypographySpec>> = {
  paragraph: {
    fontSizePx: DEFAULT_EDITOR_DOCX_BODY_FONT_SIZE_PX,
    lineHeight: 1.8,
    bold: false,
    color: '203040',
  },
  heading1: {
    fontSizePx: DEFAULT_EDITOR_DOCX_HEADING_FONT_SIZE_PX[1],
    lineHeight: 1.3,
    bold: true,
    color: '16283D',
  },
  heading2: {
    fontSizePx: DEFAULT_EDITOR_DOCX_HEADING_FONT_SIZE_PX[2],
    lineHeight: 1.3,
    bold: true,
    color: '16283D',
  },
  heading3: {
    fontSizePx: DEFAULT_EDITOR_DOCX_HEADING_FONT_SIZE_PX[3],
    lineHeight: 1.3,
    bold: true,
    color: '16283D',
  },
  figcaption: {
    fontSizePx: DEFAULT_EDITOR_DOCX_FIGCAPTION_FONT_SIZE_PX,
    lineHeight: 1.8,
    bold: false,
    color: '4F6277',
  },
} as const;

export const EDITOR_LAYOUT_SPEC = {
  topLevelBlockGapPx: DEFAULT_EDITOR_DOCX_BODY_FONT_SIZE_PX * 0.9,
  figureContentGapPx: 10,
  figurePaddingPx: 12,
  figureBorderWidthPx: 1,
  figureBorderColor: 'D8E2ED',
  figureBackgroundColor: 'F7FAFD',
  inlineChipFontScale: 0.88,
  inlineChipBorderWidthPx: 0.5,
  inlineChipBorderSpacePt: 2,
  citationBackgroundColor: 'E5EDF2',
  figureRefBackgroundColor: 'F8EEDB',
  listIndentPx: DEFAULT_EDITOR_DOCX_BODY_FONT_SIZE_PX * 1.6,
  listLevelOffsetPx: DEFAULT_EDITOR_DOCX_BODY_FONT_SIZE_PX * 1.6,
  listHangingPx: 12,
  blockquotePaddingLeftPx: 14,
  blockquoteBorderWidthPx: 3,
  blockquoteBorderColor: 'BFD3E6',
  blockquoteTextColor: '52667B',
  citationTextColor: '0F5C84',
  figureRefTextColor: '7A4E00',
} as const;

export function getEditorNamedFontSizePreset(name: EditorNamedFontSizeName) {
  return EDITOR_NAMED_FONT_SIZE_PRESETS.find((preset) => preset.name === name);
}

export function getEditorNamedFontSizeCssPx(name: EditorNamedFontSizeName) {
  const preset = getEditorNamedFontSizePreset(name);
  if (!preset) {
    throw new Error(`Unknown editor font size: ${name}`);
  }

  return preset.cssPx;
}

export function getEditorNamedFontSizeDocxHalfPoints(name: EditorNamedFontSizeName) {
  const preset = getEditorNamedFontSizePreset(name);
  if (!preset) {
    throw new Error(`Unknown editor font size: ${name}`);
  }

  return preset.docxHalfPoints;
}

export function cssPxToPointSize(cssPx: number) {
  return cssPx * 0.75;
}

export function cssPxToDocxHalfPoints(cssPx: number) {
  return Math.max(1, Math.round(cssPxToPointSize(cssPx) * 2));
}

export function cssPxToTwips(cssPx: number) {
  return Math.max(0, Math.round(cssPxToPointSize(cssPx) * 20));
}

export function cssPxToBorderEighthPoints(cssPx: number) {
  return Math.max(0, Math.round(cssPxToPointSize(cssPx) * 8));
}

export function resolveEditorFontSize(value: string | null | undefined): EditorResolvedFontSize | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return null;
  }

  const preset = EDITOR_NAMED_FONT_SIZE_PRESETS.find((candidate) => candidate.name === normalized);
  if (preset) {
    return {
      cssPx: preset.cssPx,
      pointSize: preset.pointSize,
      docxHalfPoints: preset.docxHalfPoints,
      presetName: preset.name,
    };
  }

  const pxMatch = normalized.match(/^(\d+(?:\.\d+)?)px$/i);
  if (pxMatch) {
    const cssPx = Number(pxMatch[1]);
    if (Number.isFinite(cssPx) && cssPx > 0) {
      return {
        cssPx,
        pointSize: cssPxToPointSize(cssPx),
        docxHalfPoints: cssPxToDocxHalfPoints(cssPx),
        presetName: null,
      };
    }
  }

  const ptMatch = normalized.match(/^(\d+(?:\.\d+)?)pt$/i);
  if (ptMatch) {
    const pointSize = Number(ptMatch[1]);
    if (Number.isFinite(pointSize) && pointSize > 0) {
      const cssPx = pointSize / 0.75;
      return {
        cssPx,
        pointSize,
        docxHalfPoints: Math.max(1, Math.round(pointSize * 2)),
        presetName: null,
      };
    }
  }

  return null;
}

export function resolvePrimaryFontFamily(value: string | null | undefined) {
  const families = String(value ?? '')
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' '))
    .filter(Boolean);

  const preferredFamily = families.find(
    (family) => !GENERIC_FONT_FAMILIES.has(family.toLowerCase()),
  );

  return preferredFamily ?? families[0] ?? null;
}

export function getEditorTypographySpec(variant: EditorParagraphVariant) {
  return EDITOR_TYPOGRAPHY_SPEC[variant];
}
