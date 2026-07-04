import { getEditorNamedFontSizeDocxHalfPoints } from 'cs/base/common/editorFormat';

export type DocxExportConfig = {
  fileNamePrefix: string;
  article: {
    titleFontSize: number;
    bodyFontSize: number;
    fontAscii: string;
    fontEastAsia: string;
    bodyColor: string;
    lineSpacing: number;
    titleSpacingBefore: number;
    abstractLineSpacingAfter: number;
  };
  journal: {
    titleFontSize: number;
    fontAscii: string;
    fontEastAsia: string;
    titleColor: string;
    titleItalic: boolean;
    lineSpacing: number;
    titleSpacingBefore: number;
    titleSpacingAfter: number;
  };
  page: {
    width: number;
    height: number;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    marginHeader: number;
    marginFooter: number;
    marginGutter: number;
  };
};

// Keep a single default export style so all DOCX files are consistent.
export const defaultDocxExportConfig: Readonly<DocxExportConfig> = {
  fileNamePrefix: 'literature-batch',
  article: {
    titleFontSize: getEditorNamedFontSizeDocxHalfPoints('小四'),
    bodyFontSize: getEditorNamedFontSizeDocxHalfPoints('小四'),
    fontAscii: 'Times New Roman',
    fontEastAsia: '宋体',
    bodyColor: '000000',
    lineSpacing: 360,
    titleSpacingBefore: 160,
    abstractLineSpacingAfter: 60,
  },
  journal: {
    titleFontSize: getEditorNamedFontSizeDocxHalfPoints('小三'),
    fontAscii: 'Times New Roman',
    fontEastAsia: '宋体',
    titleColor: '0070C0',
    titleItalic: true,
    lineSpacing: 360,
    titleSpacingBefore: 200,
    titleSpacingAfter: 120,
  },
  page: {
    width: 11906,
    height: 16838,
    marginTop: 1440,
    marginRight: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    marginHeader: 708,
    marginFooter: 708,
    marginGutter: 0,
  },
};
