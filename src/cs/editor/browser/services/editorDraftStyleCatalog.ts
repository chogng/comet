import {
  areEditorDraftStyleSettingsEqual,
  createDefaultEditorDraftStyleSettings,
  normalizeEditorDraftStyleSettings,
  type EditorDraftDefaultBodyStyle,
  type EditorDraftInlineStyleDefaults,
  type EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import {
  EDITOR_NAMED_FONT_SIZE_PRESETS,
} from 'cs/base/common/editorFormat';
import type {
	EditorDraftStyleOption,
	EditorDraftStyleServiceSnapshot,
} from 'cs/editor/common/services/editorDraftStyleService';

export type {
  EditorDraftDefaultBodyStyle,
  EditorDraftInlineStyleDefaults,
  EditorDraftStyleSettings,
};

function freezeEditorDraftStyleOptions(
  options: readonly EditorDraftStyleOption[],
) {
  return Object.freeze(
    options.map((option) =>
      Object.freeze({
        value: option.value,
        label: option.label,
        title: option.title,
      })),
  );
}

function freezeEditorDraftDefaultBodyStyle(
  defaultBodyStyle: EditorDraftDefaultBodyStyle,
): Readonly<EditorDraftDefaultBodyStyle> {
  return Object.freeze({
    fontFamilyValue: defaultBodyStyle.fontFamilyValue,
    fontSizeValue: defaultBodyStyle.fontSizeValue,
    lineHeight: defaultBodyStyle.lineHeight,
    paragraphSpacingBeforePt: defaultBodyStyle.paragraphSpacingBeforePt,
    paragraphSpacingAfterPt: defaultBodyStyle.paragraphSpacingAfterPt,
    color: defaultBodyStyle.color,
    inlineStyleDefaults: Object.freeze({
      bold: defaultBodyStyle.inlineStyleDefaults.bold,
      italic: defaultBodyStyle.inlineStyleDefaults.italic,
      underline: defaultBodyStyle.inlineStyleDefaults.underline,
    }),
  });
}

export function normalizeEditorDraftStyleCatalogSnapshot(
  snapshot: EditorDraftStyleSettings | EditorDraftStyleServiceSnapshot,
): EditorDraftStyleServiceSnapshot {
  const normalizedSettings = normalizeEditorDraftStyleSettings(snapshot);
  const defaultBodyStyle = normalizedSettings.defaultBodyStyle;
  const fontFamilyPresets =
    'fontFamilyPresets' in snapshot ? snapshot.fontFamilyPresets : EDITOR_DRAFT_FONT_FAMILY_PRESETS;
  const fontSizePresets =
    'fontSizePresets' in snapshot ? snapshot.fontSizePresets : EDITOR_DRAFT_FONT_SIZE_PRESETS;

  const normalizedDefaultBodyStyle = freezeEditorDraftDefaultBodyStyle({
    fontFamilyValue: defaultBodyStyle.fontFamilyValue,
    fontSizeValue: defaultBodyStyle.fontSizeValue,
    lineHeight: defaultBodyStyle.lineHeight,
    paragraphSpacingBeforePt: defaultBodyStyle.paragraphSpacingBeforePt,
    paragraphSpacingAfterPt: defaultBodyStyle.paragraphSpacingAfterPt,
    color: defaultBodyStyle.color,
    inlineStyleDefaults: {
      bold: defaultBodyStyle.inlineStyleDefaults.bold,
      italic: defaultBodyStyle.inlineStyleDefaults.italic,
      underline: defaultBodyStyle.inlineStyleDefaults.underline,
    },
  });

  return Object.freeze({
    defaultBodyStyle: normalizedDefaultBodyStyle,
    fontFamilyPresets: freezeEditorDraftStyleOptions(fontFamilyPresets),
    fontSizePresets: freezeEditorDraftStyleOptions(fontSizePresets),
  });
}

function areEditorDraftStyleOptionsEqual(
  previous: readonly EditorDraftStyleOption[],
  next: readonly EditorDraftStyleOption[],
) {
  return (
    previous.length === next.length &&
    previous.every((option, index) => {
      const nextOption = next[index];
      return (
        option.value === nextOption.value &&
        option.label === nextOption.label &&
        option.title === nextOption.title
      );
    })
  );
}

export function areEditorDraftStyleCatalogSnapshotsEqual(
  previous: EditorDraftStyleServiceSnapshot,
  next: EditorDraftStyleServiceSnapshot,
) {
  return (
    areEditorDraftStyleSettingsEqual(previous, next) &&
    areEditorDraftStyleOptionsEqual(previous.fontFamilyPresets, next.fontFamilyPresets) &&
    areEditorDraftStyleOptionsEqual(previous.fontSizePresets, next.fontSizePresets)
  );
}

const EDITOR_DRAFT_FONT_FAMILY_PRESETS: readonly EditorDraftStyleOption[] = freezeEditorDraftStyleOptions([
  {
    value: '"Times New Roman", Times, serif',
    label: 'Times New Roman',
    title: 'Times New Roman',
  },
  {
    value: 'Arial, sans-serif',
    label: 'Arial',
    title: 'Arial',
  },
  {
    value: '"宋体", "SimSun", "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", serif',
    label: '宋体',
    title: '宋体 / SimSun / Songti SC',
  },
  {
    value: '"黑体", "SimHei", "Heiti SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
    label: '黑体',
    title: '黑体 / SimHei / Heiti SC',
  },
  {
    value: '"等线", "DengXian", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
    label: '等线',
    title: '等线 / DengXian',
  },
  {
    value: '"楷体", "KaiTi", "Kaiti SC", "STKaiti", serif',
    label: '楷体',
    title: '楷体 / KaiTi / Kaiti SC',
  },
  {
    value: '"Source Han Serif SC", "Noto Serif CJK SC", serif',
    label: '中文衬线',
    title: 'Source Han Serif SC',
  },
  {
    value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
    label: '中文黑体',
    title: 'Source Han Sans SC',
  },
  {
    value: '"IBM Plex Serif", serif',
    label: 'English Serif',
    title: 'IBM Plex Serif',
  },
  {
    value: '"IBM Plex Sans", sans-serif',
    label: 'English Sans',
    title: 'IBM Plex Sans',
  },
  {
    value: '"JetBrains Mono", monospace',
    label: 'Mono',
    title: 'JetBrains Mono',
  },
]);

const EDITOR_DRAFT_FONT_SIZE_PRESETS: readonly EditorDraftStyleOption[] = freezeEditorDraftStyleOptions(
  EDITOR_NAMED_FONT_SIZE_PRESETS.map((preset) => ({
    value: `${preset.cssPx}px`,
    label: preset.name,
    title: `${preset.name} / ${preset.pointSize}pt / ${preset.cssPx}px`,
  })),
);

const EDITOR_DRAFT_STYLE_CATALOG_SNAPSHOT: EditorDraftStyleServiceSnapshot = normalizeEditorDraftStyleCatalogSnapshot({
  ...createDefaultEditorDraftStyleSettings(),
  fontFamilyPresets: EDITOR_DRAFT_FONT_FAMILY_PRESETS,
  fontSizePresets: EDITOR_DRAFT_FONT_SIZE_PRESETS,
});

export function getEditorDraftStyleCatalogSnapshot() {
  return EDITOR_DRAFT_STYLE_CATALOG_SNAPSHOT;
}
