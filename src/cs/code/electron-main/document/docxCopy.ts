export type SupportedLocale = 'zh' | 'en';

export type DocxExportDialogCopy = {
  title: string;
  buttonLabel: string;
};

export type DocxExportCopy = {
  untitled: string;
  unknown: string;
  uncategorizedJournal: string;
};

const docxExportDialogCopyByLocale: Record<SupportedLocale, DocxExportDialogCopy> = {
  en: { title: 'Export DOCX', buttonLabel: 'Export' },
  zh: { title: '\u5bfc\u51fa DOCX', buttonLabel: '\u5bfc\u51fa' },
};

const docxExportCopyByLocale: Record<SupportedLocale, DocxExportCopy> = {
  zh: {
    untitled: '\u65e0\u6807\u9898',
    unknown: '\u672a\u8bc6\u522b',
    uncategorizedJournal: '\u672a\u5206\u7c7b\u671f\u520a',
  },
  en: {
    untitled: 'Untitled',
    unknown: 'Unknown',
    uncategorizedJournal: 'Uncategorized Journal',
  },
};

export function resolveSupportedLocale(locale?: string | null): SupportedLocale {
  return locale === 'zh' ? 'zh' : 'en';
}

export function resolveDocxExportDialogCopy(locale?: string | null): DocxExportDialogCopy {
  return docxExportDialogCopyByLocale[resolveSupportedLocale(locale)];
}

export function resolveDocxExportCopy(locale?: string | null): DocxExportCopy {
  return docxExportCopyByLocale[resolveSupportedLocale(locale)];
}
