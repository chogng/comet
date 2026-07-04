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
  zh: { title: '导出 DOCX', buttonLabel: '导出' },
};

const docxExportCopyByLocale: Record<SupportedLocale, DocxExportCopy> = {
  zh: {
    untitled: '无标�?,
    unknown: '未识�?,
    uncategorizedJournal: '未分类期�?,
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
