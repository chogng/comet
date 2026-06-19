import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';

import {
  DEFAULT_EDITOR_DOCX_FONT_ASCII,
  DEFAULT_EDITOR_DOCX_FONT_EAST_ASIA,
  EDITOR_LAYOUT_SPEC,
  cssPxToBorderEighthPoints,
  cssPxToDocxHalfPoints,
  cssPxToTwips,
  getEditorTypographySpec,
  type EditorParagraphVariant,
  resolveEditorFontSize,
  resolvePrimaryFontFamily,
} from 'ls/base/common/editorFormat';
import {
  normalizeEditorDraftStyleSettings,
  type EditorDraftStyleSettings,
} from 'ls/base/common/editorDraftStyle';
import { buildDocxBuffer, escapeXml, type DocxContentTypeDefault, type DocxContentTypeOverride, type DocxRelationship, type ZipEntry } from 'ls/code/electron-main/document/docxPackage';
import { defaultDocxExportConfig } from 'ls/code/electron-main/document/docxConfig';
import { resolveDocxExportCopy } from 'ls/code/electron-main/document/docxCopy';
import type { SupportedLocale } from 'ls/code/electron-main/document/docxCopy';
import {
  collectWritingEditorDerivedLabels,
  getWritingEditorLeafText,
  normalizeWritingEditorDocument,
  type WritingEditorDerivedLabels,
  type WritingEditorDocument,
} from 'ls/editor/common/writingEditorDocument';
import type {
  BlockNodeAttrs,
  FigureNodeAttrs,
  FigureRefNodeAttrs,
  TextStyleMarkAttrs,
} from 'ls/editor/browser/text/schema';
import { writingEditorSchema } from 'ls/editor/browser/text/schema';

type EditorDocxListInfo = {
  kind: 'bullet' | 'ordered';
  level: number;
  continuation: boolean;
};

type EditorDocxRun = {
  kind: 'text' | 'break';
  text?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: string | null;
  fontSizeHalfPoints: number;
  color: string | null;
  backgroundColor: string | null;
  borderColor: string | null;
  borderSizeEighthPoints: number | null;
  borderSpacePoints: number | null;
  hyperlinkAnchor?: string | null;
};

type EditorDocxParagraphBlock = {
  kind: 'paragraph';
  variant: EditorParagraphVariant;
  runs: EditorDocxRun[];
  textAlign: 'left' | 'center' | 'right' | null;
  list: EditorDocxListInfo | null;
  blockquoteDepth: number;
  spacingBeforeTwips: number;
};

type EditorDocxImageBlock = {
  kind: 'image';
  figureId: string | null;
  src: string | null;
  alt: string;
  title: string;
  requestedWidthPx: number | null;
  list: EditorDocxListInfo | null;
  blockquoteDepth: number;
  spacingBeforeTwips: number;
};

type EditorDocxBlock = EditorDocxParagraphBlock | EditorDocxImageBlock;

type ResolvedEditorDocxImage = {
  fileName: string;
  relationshipId: string;
  contentType: string;
  extension: string;
  data: Buffer;
  widthEmu: number;
  heightEmu: number;
  alt: string;
  title: string;
};

type ImageSourceData = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  widthPx: number;
  heightPx: number;
};

type BuildEditorDocxBufferOptions = {
  document: WritingEditorDocument;
  editorDraftStyle?: EditorDraftStyleSettings;
  title?: string | null;
  locale?: SupportedLocale;
};

type ResolvedEditorDocxDraftStyle = {
  paragraphLineSpacingTwips: number;
  paragraphSpacingBeforeTwips: number;
  paragraphSpacingAfterTwips: number;
};

const DOCX_RELATIONSHIP_TYPE_NUMBERING =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const DOCX_RELATIONSHIP_TYPE_IMAGE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const DOCX_NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const EMU_PER_CSS_PIXEL = 9525;
type BlockContainerKind = 'doc' | 'blockquote' | 'list_item' | 'figure';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function ptToTwips(value: number) {
  return Math.round(value * 20);
}

function resolveEditorDocxDraftStyle(
  editorDraftStyle: EditorDraftStyleSettings | null | undefined,
): ResolvedEditorDocxDraftStyle {
  const normalizedStyle = normalizeEditorDraftStyleSettings(editorDraftStyle);
  const paragraphSpec = getEditorTypographySpec('paragraph');
  const paragraphFontSize =
    resolveEditorFontSize(normalizedStyle.defaultBodyStyle.fontSizeValue)?.cssPx
    ?? paragraphSpec.fontSizePx;

  return {
    paragraphLineSpacingTwips: cssPxToTwips(
      paragraphFontSize * normalizedStyle.defaultBodyStyle.lineHeight,
    ),
    paragraphSpacingBeforeTwips: ptToTwips(
      normalizedStyle.defaultBodyStyle.paragraphSpacingBeforePt,
    ),
    paragraphSpacingAfterTwips: ptToTwips(
      normalizedStyle.defaultBodyStyle.paragraphSpacingAfterPt,
    ),
  };
}

function createParagraphStyleDefaults(
  variant: EditorDocxParagraphBlock['variant'],
  draftStyle?: ResolvedEditorDocxDraftStyle,
) {
  const spec = getEditorTypographySpec(variant);
  return {
    fontSizeHalfPoints: cssPxToDocxHalfPoints(spec.fontSizePx),
    lineSpacing: variant === 'paragraph' && draftStyle
      ? draftStyle.paragraphLineSpacingTwips
      : cssPxToTwips(spec.fontSizePx * spec.lineHeight),
    bold: spec.bold,
    color: spec.color,
  };
}

function hashBookmarkSource(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildFigureBookmarkName(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }

  // Word 书签名不能直接吃任意 figureId，这里保留可读前缀，再拼稳定 hash 避免冲突。
  const base = normalized.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'target';
  return `fig_${base.slice(0, 20)}_${hashBookmarkSource(normalized)}`;
}

function hasXmlSpacePreserve(text: string) {
  return /^\s|\s$/.test(text);
}

function buildTextRunXml(run: EditorDocxRun) {
  const runProperties: string[] = [];
  if (run.bold) {
    runProperties.push('<w:b/>');
  }
  if (run.italic) {
    runProperties.push('<w:i/>', '<w:iCs/>');
  }
  if (run.underline) {
    runProperties.push('<w:u w:val="single"/>');
  }
  if (run.fontSizeHalfPoints) {
    runProperties.push(`<w:sz w:val="${run.fontSizeHalfPoints}"/>`);
    runProperties.push(`<w:szCs w:val="${run.fontSizeHalfPoints}"/>`);
  }
  const fontFamily = run.fontFamily ?? DEFAULT_EDITOR_DOCX_FONT_ASCII;
  const escapedFontFamily = escapeXml(fontFamily);
  runProperties.push(
    `<w:rFonts w:ascii="${escapedFontFamily}" w:hAnsi="${escapedFontFamily}" w:cs="${escapedFontFamily}" w:eastAsia="${escapeXml(run.fontFamily ?? DEFAULT_EDITOR_DOCX_FONT_EAST_ASIA)}"/>`,
  );
  if (run.color) {
    runProperties.push(`<w:color w:val="${escapeXml(run.color)}"/>`);
  }
  if (run.backgroundColor) {
    // Word 的 inline run 不支持真正的 pill 圆角，这里用 shading + border 做最接近的近似。
    runProperties.push(
      `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXml(run.backgroundColor)}"/>`,
    );
  }
  if (run.borderColor && run.borderSizeEighthPoints) {
    runProperties.push(
      `<w:bdr w:val="single" w:sz="${run.borderSizeEighthPoints}" w:space="${Math.max(0, run.borderSpacePoints ?? 0)}" w:color="${escapeXml(run.borderColor)}"/>`,
    );
  }

  if (run.kind === 'break') {
    return [
      '<w:r>',
      runProperties.length > 0 ? `<w:rPr>${runProperties.join('')}</w:rPr>` : '',
      '<w:br/>',
      '</w:r>',
    ].join('');
  }

  const text = run.text ?? '';
  return [
    '<w:r>',
    runProperties.length > 0 ? `<w:rPr>${runProperties.join('')}</w:rPr>` : '',
    hasXmlSpacePreserve(text)
      ? `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`
      : `<w:t>${escapeXml(text)}</w:t>`,
    '</w:r>',
  ].join('');
}

function buildRunXml(run: EditorDocxRun) {
  const runXml = buildTextRunXml(run);
  if (!run.hyperlinkAnchor || run.kind !== 'text') {
    return runXml;
  }

  return `<w:hyperlink w:anchor="${escapeXml(run.hyperlinkAnchor)}" w:history="1">${runXml}</w:hyperlink>`;
}

function buildListMarkerParagraphXml(
  block: EditorDocxImageBlock,
  options: {
    spacingBefore?: number;
  } = {},
) {
  const spacingBefore = options.spacingBefore ?? block.spacingBeforeTwips;
  return [
    '<w:p>',
    // 列表里的 figure 仍然先输出一个编号段落，后面的 table 再用同样缩进贴齐正文区域。
    buildParagraphPropertiesXml(block, {
      spacingBefore: spacingBefore || undefined,
      spacingAfter: 0,
      textAlign: 'left',
    }),
    '<w:r><w:t xml:space="preserve"> </w:t></w:r>',
    '</w:p>',
  ].join('');
}

function buildImageRunXml(image: ResolvedEditorDocxImage, docPrId: number) {
  const description = escapeXml(image.alt || image.title || image.fileName);
  const imageName = escapeXml(image.title || image.fileName);

  return [
    '<w:r>',
    '<w:drawing>',
    '<wp:inline distT="0" distB="0" distL="0" distR="0"',
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">',
    `<wp:extent cx="${image.widthEmu}" cy="${image.heightEmu}"/>`,
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
    `<wp:docPr id="${docPrId}" name="${imageName}" descr="${description}"/>`,
    '<wp:cNvGraphicFramePr>',
    '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>',
    '</wp:cNvGraphicFramePr>',
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:nvPicPr>',
    `<pic:cNvPr id="${docPrId}" name="${imageName}" descr="${description}"/>`,
    '<pic:cNvPicPr/>',
    '</pic:nvPicPr>',
    '<pic:blipFill>',
    `<a:blip r:embed="${escapeXml(image.relationshipId)}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
    '<a:stretch><a:fillRect/></a:stretch>',
    '</pic:blipFill>',
    '<pic:spPr>',
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${image.widthEmu}" cy="${image.heightEmu}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    '</pic:spPr>',
    '</pic:pic>',
    '</a:graphicData>',
    '</a:graphic>',
    '</wp:inline>',
    '</w:drawing>',
    '</w:r>',
  ].join('');
}

function getParagraphLeftIndent(block: EditorDocxParagraphBlock | EditorDocxImageBlock) {
  const listLevel = block.list?.level ?? -1;
  const listIndent =
    listLevel >= 0
      ? cssPxToTwips(
          EDITOR_LAYOUT_SPEC.listIndentPx +
            listLevel * EDITOR_LAYOUT_SPEC.listLevelOffsetPx,
        )
      : 0;
  const blockquoteIndent =
    block.blockquoteDepth > 0
      ? cssPxToTwips(EDITOR_LAYOUT_SPEC.blockquotePaddingLeftPx)
      : 0;
  return listIndent + blockquoteIndent;
}

function buildParagraphPropertiesXml(
  block: EditorDocxParagraphBlock | EditorDocxImageBlock,
  extra: {
    lineSpacing?: number;
    spacingBefore?: number;
    spacingAfter?: number;
    textAlign?: 'left' | 'center' | 'right' | null;
  } = {},
) {
  const properties: string[] = [];
  const textAlign = extra.textAlign ?? (block.kind === 'paragraph' ? block.textAlign : 'center');
  if (textAlign) {
    properties.push(`<w:jc w:val="${textAlign}"/>`);
  }

  const spacingAttributes: string[] = [];
  if (extra.spacingBefore !== undefined) {
    spacingAttributes.push(`w:before="${extra.spacingBefore}"`);
  }
  if (extra.spacingAfter !== undefined) {
    spacingAttributes.push(`w:after="${extra.spacingAfter}"`);
  }
  if (extra.lineSpacing !== undefined) {
    spacingAttributes.push(`w:line="${extra.lineSpacing}"`, 'w:lineRule="auto"');
  }
  if (spacingAttributes.length > 0) {
    properties.push(`<w:spacing ${spacingAttributes.join(' ')}/>`);
  }

  const leftIndent = getParagraphLeftIndent(block);
  const indentAttributes: string[] = [];
  if (leftIndent > 0) {
    indentAttributes.push(`w:left="${leftIndent}"`);
  }
  if (block.list && !block.list.continuation) {
    indentAttributes.push(`w:hanging="${cssPxToTwips(EDITOR_LAYOUT_SPEC.listHangingPx)}"`);
  }
  if (indentAttributes.length > 0) {
    properties.push(`<w:ind ${indentAttributes.join(' ')}/>`);
  }

  if (block.list && !block.list.continuation) {
    const numId = block.list.kind === 'bullet' ? 1 : 2;
    properties.push(
      `<w:numPr><w:ilvl w:val="${Math.min(block.list.level, 8)}"/><w:numId w:val="${numId}"/></w:numPr>`,
    );
  }

  if (block.blockquoteDepth > 0) {
    properties.push(
      `<w:pBdr><w:left w:val="single" w:sz="${cssPxToBorderEighthPoints(EDITOR_LAYOUT_SPEC.blockquoteBorderWidthPx)}" w:space="4" w:color="${EDITOR_LAYOUT_SPEC.blockquoteBorderColor}"/></w:pBdr>`,
    );
  }

  return properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
}

function buildParagraphBlockXml(
  block: EditorDocxParagraphBlock,
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  const defaults = createParagraphStyleDefaults(block.variant, draftStyle);
  const color = block.blockquoteDepth > 0 && block.variant === 'paragraph'
    ? EDITOR_LAYOUT_SPEC.blockquoteTextColor
    : defaults.color;

  const paragraphRuns =
    block.runs.length > 0
      ? block.runs.map((run) => buildRunXml({
          ...run,
          color: run.color ?? color,
        })).join('')
      : '';

  return [
    '<w:p>',
    buildParagraphPropertiesXml(block, {
      spacingBefore: block.spacingBeforeTwips || undefined,
      lineSpacing: defaults.lineSpacing,
      spacingAfter:
        block.variant === 'paragraph'
          ? draftStyle.paragraphSpacingAfterTwips
          : 0,
    }),
    paragraphRuns || '<w:r/>',
    '</w:p>',
  ].join('');
}

function buildImageBlockXml(
  block: EditorDocxImageBlock,
  image: ResolvedEditorDocxImage | null,
  docPrId: number,
  options: {
    spacingBefore?: number;
    textAlign?: 'left' | 'center' | 'right' | null;
    bookmarkName?: string | null;
    bookmarkId?: number | null;
  } = {},
) {
  const bookmarkXml =
    options.bookmarkName && typeof options.bookmarkId === 'number'
      ? {
          start: `<w:bookmarkStart w:id="${options.bookmarkId}" w:name="${escapeXml(options.bookmarkName)}"/>`,
          end: `<w:bookmarkEnd w:id="${options.bookmarkId}"/>`,
        }
      : null;
  if (!image) {
    const fallbackText = block.title || block.alt || '';
    const runs = fallbackText
      ? buildRunXml({
          kind: 'text',
          text: fallbackText,
          bold: false,
          italic: true,
          underline: false,
          fontFamily: DEFAULT_EDITOR_DOCX_FONT_ASCII,
          fontSizeHalfPoints: cssPxToDocxHalfPoints(getEditorTypographySpec('figcaption').fontSizePx),
          color: getEditorTypographySpec('figcaption').color,
          backgroundColor: null,
          borderColor: null,
          borderSizeEighthPoints: null,
          borderSpacePoints: null,
        })
      : '<w:r/>';
    return `<w:p>${buildParagraphPropertiesXml(block, {
      spacingBefore: (options.spacingBefore ?? block.spacingBeforeTwips) || undefined,
      spacingAfter: 0,
      textAlign: options.textAlign ?? 'left',
    })}${bookmarkXml?.start ?? ''}${runs}${bookmarkXml?.end ?? ''}</w:p>`;
  }

  return `<w:p>${buildParagraphPropertiesXml(block, {
    spacingBefore: (options.spacingBefore ?? block.spacingBeforeTwips) || undefined,
    spacingAfter: 0,
    textAlign: options.textAlign ?? 'left',
  })}${bookmarkXml?.start ?? ''}${buildImageRunXml(image, docPrId)}${bookmarkXml?.end ?? ''}</w:p>`;
}

function buildSpacerParagraphXml(spacingAfterTwips: number) {
  return [
    '<w:p>',
    `<w:pPr><w:spacing w:after="${spacingAfterTwips}" w:line="1" w:lineRule="exact"/></w:pPr>`,
    '<w:r/>',
    '</w:p>',
  ].join('');
}

function isFigureCaptionBlock(block: EditorDocxBlock | undefined): block is EditorDocxParagraphBlock {
  return block?.kind === 'paragraph' && block.variant === 'figcaption';
}

function buildFigureTableXml(
  imageBlock: EditorDocxImageBlock,
  image: ResolvedEditorDocxImage | null,
  docPrId: number,
  captionBlock: EditorDocxParagraphBlock | null,
  bookmarkName: string | null,
  bookmarkId: number | null,
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  const borderSize = cssPxToBorderEighthPoints(EDITOR_LAYOUT_SPEC.figureBorderWidthPx);
  const cellPadding = cssPxToTwips(EDITOR_LAYOUT_SPEC.figurePaddingPx);
  const tableIndent = getParagraphLeftIndent(imageBlock);
  const shouldEmitListMarker = Boolean(imageBlock.list && !imageBlock.list.continuation);
  const innerImageBlock: EditorDocxImageBlock = {
    ...imageBlock,
    list: null,
    blockquoteDepth: 0,
    spacingBeforeTwips: 0,
  };
  const innerCaptionBlock: EditorDocxParagraphBlock | null = captionBlock
    ? {
        ...captionBlock,
        list: null,
        blockquoteDepth: 0,
      }
    : null;
  const cellContent = [
    buildImageBlockXml(innerImageBlock, image, docPrId, {
      bookmarkName,
      bookmarkId,
      textAlign: 'left',
    }),
    innerCaptionBlock ? buildParagraphBlockXml(innerCaptionBlock, draftStyle) : '',
  ]
    .filter(Boolean)
    .join('');

  return [
    shouldEmitListMarker
      ? buildListMarkerParagraphXml(imageBlock)
      : imageBlock.spacingBeforeTwips > 0
      ? buildSpacerParagraphXml(imageBlock.spacingBeforeTwips)
      : '',
    // 用单列表格包住图片和 caption，导出后在 Word 里最接近编辑器里的 figure 卡片。
    '<w:tbl>',
    '<w:tblPr>',
    '<w:tblW w:w="5000" w:type="pct"/>',
    tableIndent > 0 ? `<w:tblInd w:w="${tableIndent}" w:type="dxa"/>` : '',
    '<w:tblLayout w:type="fixed"/>',
    `<w:tblBorders><w:top w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/><w:left w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/><w:bottom w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/><w:right w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/><w:insideH w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/><w:insideV w:val="single" w:sz="${borderSize}" w:space="0" w:color="${EDITOR_LAYOUT_SPEC.figureBorderColor}"/></w:tblBorders>`,
    `<w:tblCellMar><w:top w:w="${cellPadding}" w:type="dxa"/><w:left w:w="${cellPadding}" w:type="dxa"/><w:bottom w:w="${cellPadding}" w:type="dxa"/><w:right w:w="${cellPadding}" w:type="dxa"/></w:tblCellMar>`,
    '</w:tblPr>',
    '<w:tr>',
    '<w:tc>',
    `<w:tcPr><w:tcW w:w="5000" w:type="pct"/><w:shd w:val="clear" w:color="auto" w:fill="${EDITOR_LAYOUT_SPEC.figureBackgroundColor}"/></w:tcPr>`,
    cellContent || '<w:p><w:r/></w:p>',
    '</w:tc>',
    '</w:tr>',
    '</w:tbl>',
  ].join('');
}

function resolveParagraphVariant(node: ProseMirrorNode): EditorDocxParagraphBlock['variant'] | null {
  if (node.type.name === 'paragraph') {
    return 'paragraph';
  }
  if (node.type.name === 'figcaption') {
    return 'figcaption';
  }
  if (node.type.name === 'heading') {
    const level = Number(node.attrs.level) || 1;
    if (level === 1) {
      return 'heading1';
    }
    if (level === 2) {
      return 'heading2';
    }
    return 'heading3';
  }
  return null;
}

function resolveRunFromNode(
  node: ProseMirrorNode,
  marks: readonly Mark[],
  fallbackText: string,
  variant: EditorDocxParagraphBlock['variant'],
) {
  const defaults = createParagraphStyleDefaults(variant);
  let bold = defaults.bold;
  let italic = false;
  let underline = false;
  let fontFamily: string | null = null;
  let fontSizeHalfPoints = defaults.fontSizeHalfPoints;

  for (const mark of marks) {
    if (mark.type.name === 'strong') {
      bold = true;
      continue;
    }
    if (mark.type.name === 'em') {
      italic = true;
      continue;
    }
    if (mark.type.name === 'underline') {
      underline = true;
      continue;
    }
    if (mark.type.name === 'text_style') {
      const attrs = mark.attrs as TextStyleMarkAttrs;
      const primaryFontFamily = resolvePrimaryFontFamily(attrs.fontFamily);
      if (primaryFontFamily) {
        fontFamily = primaryFontFamily;
      }
      const fontSize = resolveEditorFontSize(attrs.fontSize);
      if (fontSize) {
        fontSizeHalfPoints = fontSize.docxHalfPoints;
      }
    }
  }

  if (node.type.name === 'hard_break') {
    return {
      kind: 'break',
      bold,
      italic,
      underline,
      fontFamily,
      fontSizeHalfPoints,
      color: null,
      backgroundColor: null,
      borderColor: null,
      borderSizeEighthPoints: null,
      borderSpacePoints: null,
    } satisfies EditorDocxRun;
  }

  const isCitation = node.type.name === 'citation';
  const isFigureRef = node.type.name === 'figure_ref';
  const chipBackgroundColor =
    isCitation
      ? EDITOR_LAYOUT_SPEC.citationBackgroundColor
      : isFigureRef
        ? EDITOR_LAYOUT_SPEC.figureRefBackgroundColor
        : null;
  const hasInlineChipStyle = Boolean(chipBackgroundColor);

  return {
    kind: 'text',
    text: fallbackText,
    bold,
    italic,
    underline,
    fontFamily,
    fontSizeHalfPoints: hasInlineChipStyle
      ? Math.max(1, Math.round(fontSizeHalfPoints * EDITOR_LAYOUT_SPEC.inlineChipFontScale))
      : fontSizeHalfPoints,
    color:
      isCitation
        ? EDITOR_LAYOUT_SPEC.citationTextColor
        : isFigureRef
          ? EDITOR_LAYOUT_SPEC.figureRefTextColor
          : null,
    backgroundColor: chipBackgroundColor,
    borderColor: chipBackgroundColor,
    borderSizeEighthPoints: hasInlineChipStyle
      ? cssPxToBorderEighthPoints(EDITOR_LAYOUT_SPEC.inlineChipBorderWidthPx)
      : null,
    borderSpacePoints: hasInlineChipStyle
      ? EDITOR_LAYOUT_SPEC.inlineChipBorderSpacePt
      : null,
    hyperlinkAnchor:
      isFigureRef
        ? buildFigureBookmarkName((node.attrs as FigureRefNodeAttrs).targetId)
        : null,
  } satisfies EditorDocxRun;
}

function collectParagraphRuns(
  node: ProseMirrorNode,
  variant: EditorDocxParagraphBlock['variant'],
  derivedLabels: WritingEditorDerivedLabels,
) {
  const runs: EditorDocxRun[] = [];

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      if (!text) {
        return;
      }
      runs.push(resolveRunFromNode(child, child.marks, text, variant));
      return;
    }

    if (
      child.type.name === 'hard_break' ||
      child.type.name === 'citation' ||
      child.type.name === 'figure_ref'
    ) {
      const text = getWritingEditorLeafText(child, derivedLabels);
      runs.push(resolveRunFromNode(child, child.marks, text, variant));
    }
  });

  return runs;
}

type CollectBlocksContext = {
  blockquoteDepth: number;
};

function setBlockSpacingBefore(blocks: EditorDocxBlock[], spacingBeforeTwips: number) {
  if (blocks.length === 0 || spacingBeforeTwips <= 0) {
    return;
  }

  blocks[0].spacingBeforeTwips = spacingBeforeTwips;
}

function resolveSiblingSpacingBeforeTwips(
  containerKind: BlockContainerKind,
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  if (containerKind === 'doc') {
    return draftStyle.paragraphSpacingBeforeTwips;
  }

  if (containerKind === 'figure') {
    return cssPxToTwips(EDITOR_LAYOUT_SPEC.figureContentGapPx);
  }

  return 0;
}

function collectChildBlocks(
  parentNode: ProseMirrorNode,
  derivedLabels: WritingEditorDerivedLabels,
  context: CollectBlocksContext,
  containerKind: BlockContainerKind,
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  const blocks: EditorDocxBlock[] = [];

  parentNode.forEach((child, _offset, index) => {
    const childBlocks = collectBlocks(child, derivedLabels, context, draftStyle);
    if (index > 0) {
      setBlockSpacingBefore(
        childBlocks,
        resolveSiblingSpacingBeforeTwips(containerKind, draftStyle),
      );
    }
    blocks.push(...childBlocks);
  });

  return blocks;
}

function collectBlocks(
  node: ProseMirrorNode,
  derivedLabels: WritingEditorDerivedLabels,
  context: CollectBlocksContext,
  draftStyle: ResolvedEditorDocxDraftStyle,
): EditorDocxBlock[] {
  const variant = resolveParagraphVariant(node);
  if (variant) {
    const textAlign = (node.attrs as BlockNodeAttrs).textAlign ?? null;
    return [
      {
        kind: 'paragraph',
        variant,
        runs: collectParagraphRuns(node, variant, derivedLabels),
        textAlign,
        list: null,
        blockquoteDepth: context.blockquoteDepth,
        spacingBeforeTwips: 0,
      },
    ];
  }

  if (node.type.name === 'figure') {
    const attrs = node.attrs as FigureNodeAttrs;
    const blocks: EditorDocxBlock[] = [
      {
        kind: 'image',
        figureId: attrs.figureId?.trim() || null,
        src: attrs.src?.trim() || null,
        alt: attrs.alt,
        title: attrs.title,
        requestedWidthPx: typeof attrs.width === 'number' && attrs.width > 0 ? attrs.width : null,
        list: null,
        blockquoteDepth: context.blockquoteDepth,
        spacingBeforeTwips: 0,
      },
    ];
    const figureChildBlocks = collectChildBlocks(
      node,
      derivedLabels,
      context,
      'figure',
      draftStyle,
    );
    setBlockSpacingBefore(
      figureChildBlocks,
      cssPxToTwips(EDITOR_LAYOUT_SPEC.figureContentGapPx),
    );
    blocks.push(...figureChildBlocks);
    return blocks;
  }

  if (node.type.name === 'blockquote') {
    return collectChildBlocks(
      node,
      derivedLabels,
      {
        ...context,
        blockquoteDepth: context.blockquoteDepth + 1,
      },
      'blockquote',
      draftStyle,
    );
  }

  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
    return collectListBlocks(
      node,
      derivedLabels,
      context,
      node.type.name === 'bullet_list' ? 'bullet' : 'ordered',
      0,
      draftStyle,
    );
  }

  return collectChildBlocks(node, derivedLabels, context, 'doc', draftStyle);
}

function applyListInfoToBlock(block: EditorDocxBlock, list: Omit<EditorDocxListInfo, 'continuation'>, continuation: boolean) {
  if (block.kind === 'paragraph' || block.kind === 'image') {
    block.list = {
      ...list,
      continuation,
    };
  }
}

function collectListBlocks(
  listNode: ProseMirrorNode,
  derivedLabels: WritingEditorDerivedLabels,
  context: CollectBlocksContext,
  kind: EditorDocxListInfo['kind'],
  level: number,
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  const blocks: EditorDocxBlock[] = [];

  listNode.forEach((listItemNode) => {
    if (listItemNode.type.name !== 'list_item') {
      return;
    }

    let hasPrimaryListBlock = false;
    listItemNode.forEach((child) => {
      const childBlocks = child.type.name === 'bullet_list' || child.type.name === 'ordered_list'
        ? collectListBlocks(
            child,
            derivedLabels,
            context,
            child.type.name === 'bullet_list' ? 'bullet' : 'ordered',
            Math.min(level + 1, 8),
            draftStyle,
          )
        : collectBlocks(child, derivedLabels, context, draftStyle);
      for (const block of childBlocks) {
        if (block.kind === 'paragraph' || block.kind === 'image') {
          applyListInfoToBlock(
            block,
            {
              kind,
              level,
            },
            hasPrimaryListBlock,
          );
          hasPrimaryListBlock = true;
        }
      }
      blocks.push(...childBlocks);
    });
  });

  return blocks;
}

function buildNumberingXml() {
  const buildIndent = (level: number) =>
    cssPxToTwips(
      EDITOR_LAYOUT_SPEC.listIndentPx +
        level * EDITOR_LAYOUT_SPEC.listLevelOffsetPx,
    );
  const bulletChars = ['•', '◦', '▪'];

  const bulletLevels = Array.from({ length: 9 }, (_, level) => [
    `<w:lvl w:ilvl="${level}">`,
    '<w:start w:val="1"/>',
    '<w:numFmt w:val="bullet"/>',
    `<w:lvlText w:val="${bulletChars[level % bulletChars.length]}"/>`,
    '<w:lvlJc w:val="left"/>',
    `<w:pPr><w:ind w:left="${buildIndent(level)}" w:hanging="${cssPxToTwips(EDITOR_LAYOUT_SPEC.listHangingPx)}"/></w:pPr>`,
    `<w:rPr><w:rFonts w:ascii="${DEFAULT_EDITOR_DOCX_FONT_ASCII}" w:hAnsi="${DEFAULT_EDITOR_DOCX_FONT_ASCII}" w:cs="${DEFAULT_EDITOR_DOCX_FONT_ASCII}" w:eastAsia="${DEFAULT_EDITOR_DOCX_FONT_EAST_ASIA}"/></w:rPr>`,
    '</w:lvl>',
  ].join(''));

  const orderedLevels = Array.from({ length: 9 }, (_, level) => [
    `<w:lvl w:ilvl="${level}">`,
    '<w:start w:val="1"/>',
    '<w:numFmt w:val="decimal"/>',
    `<w:lvlText w:val="%${level + 1}."/>`,
    '<w:lvlJc w:val="left"/>',
    `<w:pPr><w:ind w:left="${buildIndent(level)}" w:hanging="${cssPxToTwips(EDITOR_LAYOUT_SPEC.listHangingPx)}"/></w:pPr>`,
    '</w:lvl>',
  ].join(''));

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:abstractNum w:abstractNumId="0">',
    '<w:multiLevelType w:val="hybridMultilevel"/>',
    bulletLevels.join(''),
    '</w:abstractNum>',
    '<w:abstractNum w:abstractNumId="1">',
    '<w:multiLevelType w:val="multilevel"/>',
    orderedLevels.join(''),
    '</w:abstractNum>',
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
    '</w:numbering>',
  ].join('');
}

function getImageContentTypeFromExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}

function normalizeImageExtension(extension: string | null | undefined) {
  const normalized = String(extension ?? '').trim().replace(/^\./, '').toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized === 'jpeg' ? 'jpg' : normalized;
}

function resolveImageDimensions(buffer: Buffer, contentType: string) {
  if (contentType === 'image/png' && buffer.length >= 24) {
    const widthPx = buffer.readUInt32BE(16);
    const heightPx = buffer.readUInt32BE(20);
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
  }

  if (contentType === 'image/gif' && buffer.length >= 10) {
    const widthPx = buffer.readUInt16LE(6);
    const heightPx = buffer.readUInt16LE(8);
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
  }

  if (contentType === 'image/jpeg') {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
        break;
      }

      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        const heightPx = buffer.readUInt16BE(offset + 5);
        const widthPx = buffer.readUInt16BE(offset + 7);
        return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
      }

      offset += 2 + segmentLength;
    }
  }

  return null;
}

async function readImageSourceFromDataUrl(source: string) {
  const match = source.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/);
  if (!match) {
    return null;
  }

  const contentType = match[1]?.trim().toLowerCase() || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const rawPayload = match[3] ?? '';
  const buffer = isBase64
    ? Buffer.from(rawPayload, 'base64')
    : Buffer.from(decodeURIComponent(rawPayload), 'utf8');
  const extension = normalizeImageExtension(contentType.split('/')[1]);
  const normalizedContentType =
    extension ? getImageContentTypeFromExtension(extension) ?? contentType : contentType;
  if (!extension || !normalizedContentType?.startsWith('image/')) {
    return null;
  }
  const dimensions = resolveImageDimensions(buffer, normalizedContentType);
  if (!dimensions) {
    return null;
  }

  return {
    buffer,
    contentType: normalizedContentType,
    extension,
    ...dimensions,
  } satisfies ImageSourceData;
}

async function readImageSourceFromUrl(source: string) {
  try {
    const parsed = new URL(source);
    if (parsed.protocol === 'file:') {
      const filePath = fileURLToPath(parsed);
      const buffer = await fs.readFile(filePath);
      const extension = normalizeImageExtension(path.extname(filePath));
      const contentType = extension ? getImageContentTypeFromExtension(extension) : null;
      if (!extension || !contentType) {
        return null;
      }
      const dimensions = resolveImageDimensions(buffer, contentType);
      if (!dimensions) {
        return null;
      }

      return {
        buffer,
        contentType,
        extension,
        ...dimensions,
      } satisfies ImageSourceData;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const response = await fetch(parsed);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const headerContentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const urlExtension = normalizeImageExtension(path.extname(parsed.pathname));
    const extension = normalizeImageExtension(headerContentType.split('/')[1]) ?? urlExtension;
    const contentType =
      (extension ? getImageContentTypeFromExtension(extension) : null) ??
      (headerContentType.startsWith('image/') ? headerContentType : null);

    if (!extension || !contentType) {
      return null;
    }

    const dimensions = resolveImageDimensions(buffer, contentType);
    if (!dimensions) {
      return null;
    }

    return {
      buffer,
      contentType,
      extension,
      ...dimensions,
    } satisfies ImageSourceData;
  } catch {
    return null;
  }
}

async function readImageSource(source: string) {
  if (!source.trim()) {
    return null;
  }

  if (source.startsWith('data:')) {
    return readImageSourceFromDataUrl(source);
  }

  const urlResult = await readImageSourceFromUrl(source);
  if (urlResult) {
    return urlResult;
  }

  try {
    const buffer = await fs.readFile(source);
    const extension = normalizeImageExtension(path.extname(source));
    const contentType = extension ? getImageContentTypeFromExtension(extension) : null;
    if (!extension || !contentType) {
      return null;
    }
    const dimensions = resolveImageDimensions(buffer, contentType);
    if (!dimensions) {
      return null;
    }

    return {
      buffer,
      contentType,
      extension,
      ...dimensions,
    } satisfies ImageSourceData;
  } catch {
    return null;
  }
}

async function resolveEditorDocxImages(blocks: readonly EditorDocxBlock[]) {
  const page = defaultDocxExportConfig.page;
  const maxWidthEmu = Math.max(1, (page.width - page.marginLeft - page.marginRight) * 635);
  const images: Array<ResolvedEditorDocxImage | null> = [];
  let imageIndex = 0;

  for (const block of blocks) {
    if (block.kind !== 'image') {
      continue;
    }

    if (!block.src) {
      images.push(null);
      continue;
    }

    const resolvedSource = await readImageSource(block.src);
    if (!resolvedSource) {
      images.push(null);
      continue;
    }

    imageIndex += 1;
    const requestedWidthEmu = block.requestedWidthPx
      ? Math.round(block.requestedWidthPx * EMU_PER_CSS_PIXEL)
      : Math.round(resolvedSource.widthPx * EMU_PER_CSS_PIXEL);
    const originalWidthEmu = Math.round(resolvedSource.widthPx * EMU_PER_CSS_PIXEL);
    const originalHeightEmu = Math.round(resolvedSource.heightPx * EMU_PER_CSS_PIXEL);
    const widthEmu = Math.max(1, Math.min(requestedWidthEmu, originalWidthEmu, maxWidthEmu));
    const heightEmu = Math.max(
      1,
      Math.round(widthEmu * (originalHeightEmu / Math.max(1, originalWidthEmu))),
    );

    images.push({
      fileName: `image${imageIndex}.${resolvedSource.extension}`,
      relationshipId: `rIdImage${imageIndex}`,
      contentType: resolvedSource.contentType,
      extension: resolvedSource.extension,
      data: resolvedSource.buffer,
      widthEmu,
      heightEmu,
      alt: block.alt,
      title: block.title,
    });
  }

  return images;
}

function buildDocumentXml(
  blocks: readonly EditorDocxBlock[],
  resolvedImages: readonly (ResolvedEditorDocxImage | null)[],
  draftStyle: ResolvedEditorDocxDraftStyle,
) {
  const bodyParts: string[] = [];
  let docPrId = 1;
  let imageCursor = 0;
  let bookmarkId = 1;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === 'paragraph') {
      bodyParts.push(buildParagraphBlockXml(block, draftStyle));
      continue;
    }

    const image = resolvedImages[imageCursor] ?? null;
    imageCursor += 1;
    const bookmarkName = buildFigureBookmarkName(block.figureId);
    const nextBlock = blocks[index + 1];
    const captionBlock = isFigureCaptionBlock(nextBlock) ? nextBlock : null;

    // collectBlocks 会把 figure 展平成 image + optional figcaption，这里再把它们重新合并成一个 Word 容器。
    bodyParts.push(
      buildFigureTableXml(
        block,
        image,
        docPrId,
        captionBlock,
        bookmarkName,
        bookmarkName ? bookmarkId : null,
        draftStyle,
      ),
    );
    if (bookmarkName) {
      bookmarkId += 1;
    }
    docPrId += 1;
    if (captionBlock) {
      index += 1;
    }
  }

  if (bodyParts.length === 0) {
    bodyParts.push('<w:p><w:r/></w:p>');
  }

  const page = defaultDocxExportConfig.page;
  bodyParts.push(
    '<w:sectPr>' +
      `<w:pgSz w:w="${page.width}" w:h="${page.height}"/>` +
      `<w:pgMar w:top="${page.marginTop}" w:right="${page.marginRight}" w:bottom="${page.marginBottom}" w:left="${page.marginLeft}" w:header="${page.marginHeader}" w:footer="${page.marginFooter}" w:gutter="${page.marginGutter}"/>` +
      '</w:sectPr>',
  );

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<w:body>',
    bodyParts.join(''),
    '</w:body>',
    '</w:document>',
  ].join('');
}

export function buildEditorDocxFileName({
  title,
  locale = 'en',
  referenceDate = new Date(),
}: {
  title?: string | null;
  locale?: SupportedLocale;
  referenceDate?: Date;
} = {}) {
  const copy = resolveDocxExportCopy(locale);
  const normalizedTitle = String(title ?? '').trim() || copy.untitled;
  const safeTitle = normalizedTitle.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (safeTitle) {
    return `${safeTitle}.docx`;
  }

  return `draft-${referenceDate.getFullYear()}${pad(referenceDate.getMonth() + 1)}${pad(referenceDate.getDate())}-${pad(referenceDate.getHours())}${pad(referenceDate.getMinutes())}${pad(referenceDate.getSeconds())}.docx`;
}

export async function buildEditorDocxBuffer({
  document,
  editorDraftStyle,
  title,
  locale = 'en',
}: BuildEditorDocxBufferOptions) {
  const normalizedDocument = normalizeWritingEditorDocument(document);
  const proseMirrorDocument = writingEditorSchema.nodeFromJSON(normalizedDocument);
  const derivedLabels = collectWritingEditorDerivedLabels(proseMirrorDocument);
  const resolvedDraftStyle = resolveEditorDocxDraftStyle(editorDraftStyle);
  const blocks = collectBlocks(
    proseMirrorDocument,
    derivedLabels,
    { blockquoteDepth: 0 },
    resolvedDraftStyle,
  );
  const resolvedImages = await resolveEditorDocxImages(blocks);
  const documentXml = buildDocumentXml(
    blocks,
    resolvedImages,
    resolvedDraftStyle,
  );
  const copy = resolveDocxExportCopy(locale);
  const resolvedTitle = String(title ?? '').trim() || copy.untitled;

  const hasLists = blocks.some((block) => Boolean(block.list));
  const imageEntries = resolvedImages.filter((image): image is ResolvedEditorDocxImage => Boolean(image));
  const contentTypeDefaults = new Map<string, DocxContentTypeDefault>();
  const contentTypeOverrides: DocxContentTypeOverride[] = [];
  const wordRelationships: DocxRelationship[] = [];
  const extraEntries: ZipEntry[] = [];

  if (hasLists) {
    contentTypeOverrides.push({
      partName: '/word/numbering.xml',
      contentType: DOCX_NUMBERING_CONTENT_TYPE,
    });
    wordRelationships.push({
      id: 'rIdNumbering',
      type: DOCX_RELATIONSHIP_TYPE_NUMBERING,
      target: 'numbering.xml',
    });
    extraEntries.push({
      name: 'word/numbering.xml',
      data: Buffer.from(buildNumberingXml(), 'utf8'),
    });
  }

  for (const image of imageEntries) {
    contentTypeDefaults.set(image.extension, {
      extension: image.extension,
      contentType: image.contentType,
    });
    wordRelationships.push({
      id: image.relationshipId,
      type: DOCX_RELATIONSHIP_TYPE_IMAGE,
      target: `media/${image.fileName}`,
    });
    extraEntries.push({
      name: `word/media/${image.fileName}`,
      data: image.data,
    });
  }

  return buildDocxBuffer({
    documentXml,
    coreTitle: resolvedTitle,
    contentTypeDefaults: [...contentTypeDefaults.values()],
    contentTypeOverrides,
    wordRelationships,
    extraEntries,
  });
}
