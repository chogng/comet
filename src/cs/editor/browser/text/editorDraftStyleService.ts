import { EventEmitter } from 'cs/base/common/event';
import {
  areEditorDraftStyleCatalogSnapshotsEqual,
  getEditorDraftStyleCatalogSnapshot,
  normalizeEditorDraftStyleCatalogSnapshot,
  type EditorDraftStyleCatalogSnapshot,
} from 'cs/editor/browser/text/editorDraftStyleCatalog';
import type {
  EditorDraftDefaultBodyStyle,
  EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';

export type EditorDraftStyleServiceSnapshot = EditorDraftStyleCatalogSnapshot;
type EditorDraftStyleServiceInput = EditorDraftStyleSettings | EditorDraftStyleCatalogSnapshot;

export class EditorDraftStyleService {
  private snapshot: EditorDraftStyleServiceSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  constructor(
    initialSnapshot: EditorDraftStyleServiceInput = getEditorDraftStyleCatalogSnapshot(),
  ) {
    this.snapshot = normalizeEditorDraftStyleCatalogSnapshot(initialSnapshot);
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void) {
    return this.onDidChangeEmitter.event(listener);
  }

  setSnapshot(nextSnapshot: EditorDraftStyleServiceInput) {
    const normalizedSnapshot = normalizeEditorDraftStyleCatalogSnapshot(nextSnapshot);
    if (areEditorDraftStyleCatalogSnapshotsEqual(this.snapshot, normalizedSnapshot)) {
      return;
    }

    this.snapshot = normalizedSnapshot;
    this.onDidChangeEmitter.fire();
  }

  setDefaultBodyStyle(nextDefaultBodyStyle: EditorDraftDefaultBodyStyle) {
    this.setSnapshot({
      ...this.snapshot,
      defaultBodyStyle: {
        fontFamilyValue: nextDefaultBodyStyle.fontFamilyValue,
        fontSizeValue: nextDefaultBodyStyle.fontSizeValue,
        lineHeight: nextDefaultBodyStyle.lineHeight,
        paragraphSpacingBeforePt: nextDefaultBodyStyle.paragraphSpacingBeforePt,
        paragraphSpacingAfterPt: nextDefaultBodyStyle.paragraphSpacingAfterPt,
        color: nextDefaultBodyStyle.color,
        inlineStyleDefaults: {
          bold: nextDefaultBodyStyle.inlineStyleDefaults.bold,
          italic: nextDefaultBodyStyle.inlineStyleDefaults.italic,
          underline: nextDefaultBodyStyle.inlineStyleDefaults.underline,
        },
      },
    });
  }

  resetToCatalog() {
    this.setSnapshot(getEditorDraftStyleCatalogSnapshot());
  }
}

export function createEditorDraftStyleService(
  initialSnapshot: EditorDraftStyleServiceInput = getEditorDraftStyleCatalogSnapshot(),
) {
  return new EditorDraftStyleService(initialSnapshot);
}

export const editorDraftStyleService = createEditorDraftStyleService();
