import type { Annotation } from 'cs/editor/common/annotation';
import type { PdfSelection } from 'cs/editor/browser/pdf/pdfSelection';

export type PdfAnnotationStoreSnapshot = {
  targetId: string | null;
  annotations: readonly Annotation[];
  selection: PdfSelection | null;
  draftComment: string;
};

type PdfAnnotationStoreListener = () => void;

export class PdfAnnotationStore {
  private snapshot: PdfAnnotationStoreSnapshot = {
    targetId: null,
    annotations: [],
    selection: null,
    draftComment: '',
  };

  private readonly listeners = new Set<PdfAnnotationStoreListener>();

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: PdfAnnotationStoreListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setTarget(targetId: string | null) {
    if (this.snapshot.targetId === targetId) {
      return;
    }

    this.snapshot = {
      targetId,
      annotations:
        targetId && this.snapshot.targetId === targetId ? this.snapshot.annotations : [],
      selection: null,
      draftComment: '',
    };
    this.emitChange();
  }

  setAnnotations(annotations: readonly Annotation[]) {
    this.snapshot = {
      ...this.snapshot,
      annotations: [...annotations],
    };
    this.emitChange();
  }

  setSelection(selection: PdfSelection | null) {
    if (this.snapshot.selection === selection) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      selection,
    };
    this.emitChange();
  }

  setDraftComment(draftComment: string) {
    if (this.snapshot.draftComment === draftComment) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      draftComment,
    };
    this.emitChange();
  }

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createPdfAnnotationStore() {
  return new PdfAnnotationStore();
}
