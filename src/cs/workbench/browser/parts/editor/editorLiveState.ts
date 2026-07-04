import { createEmptyWritingEditorDocument, normalizeWritingEditorDocument, writingEditorDocumentToPlainText } from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

type LiveDraftSyncParams = {
  activeDraftDocument: WritingEditorDocument | null;
  contextDraftDocument: WritingEditorDocument | null;
};

function createNormalizedDocumentKey(document: WritingEditorDocument) {
  return JSON.stringify(normalizeWritingEditorDocument(document));
}

export class EditorLiveDraftState {
  private activeDraftDocument = createEmptyWritingEditorDocument();
  private contextDraftDocument: WritingEditorDocument | null = null;
  private contextDraftBody = '';
  private contextDraftBodyKey: string | null = null;

  sync({ activeDraftDocument, contextDraftDocument }: LiveDraftSyncParams) {
    this.activeDraftDocument =
      activeDraftDocument ?? createEmptyWritingEditorDocument();

    if (!contextDraftDocument) {
      this.contextDraftDocument = null;
      this.contextDraftBody = '';
      this.contextDraftBodyKey = null;
      return;
    }

    const nextContextDraftKey = createNormalizedDocumentKey(contextDraftDocument);
    if (this.contextDraftBodyKey === nextContextDraftKey) {
      this.contextDraftDocument = contextDraftDocument;
      return;
    }

    this.contextDraftDocument = contextDraftDocument;
    this.contextDraftBodyKey = null;
  }

  getActiveDraftDocument() {
    return this.activeDraftDocument;
  }

  getContextDraftBody() {
    if (!this.contextDraftDocument) {
      return '';
    }

    const nextContextDraftKey = createNormalizedDocumentKey(this.contextDraftDocument);
    if (this.contextDraftBodyKey !== nextContextDraftKey) {
      this.contextDraftBody = writingEditorDocumentToPlainText(
        this.contextDraftDocument,
      );
      this.contextDraftBodyKey = nextContextDraftKey;
    }

    return this.contextDraftBody;
  }
}

export function createEditorLiveDraftState() {
  return new EditorLiveDraftState();
}

export default EditorLiveDraftState;
