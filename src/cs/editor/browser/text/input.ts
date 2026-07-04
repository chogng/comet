import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

type WritingEditorInputSessionOptions = {
  isViewComposing: () => boolean;
  hasViewFocus: () => boolean;
  focusView: () => void;
  getNow?: () => number;
};

export class WritingEditorInputSession {
  private pendingDocumentSyncKey: string | null = null;
  private pendingFocusRestore = false;
  private focusRestoreDeadline = 0;
  private focusRestoreTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private pendingComposedDocument: WritingEditorDocument | null = null;
  private compositionFlushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(
    private readonly options: WritingEditorInputSessionOptions,
  ) {}

  dispose() {
    this.pendingDocumentSyncKey = null;
    this.pendingComposedDocument = null;
    this.clearCompositionFlushTimer();
    this.clearFocusRestoreState();
  }

  clearPendingDocumentSyncIfMatches(documentKey: string) {
    if (this.pendingDocumentSyncKey === documentKey) {
      this.pendingDocumentSyncKey = null;
    }
  }

  hasPendingDocumentSync() {
    return this.pendingDocumentSyncKey !== null;
  }

  getPendingDocumentSyncKey() {
    return this.pendingDocumentSyncKey;
  }

  markDocumentSyncPending(documentKey: string) {
    this.pendingDocumentSyncKey = documentKey;
  }

  getPendingComposedDocument() {
    return this.pendingComposedDocument;
  }

  setPendingComposedDocument(document: WritingEditorDocument) {
    this.pendingComposedDocument = document;
  }

  clearPendingComposedDocument() {
    this.pendingComposedDocument = null;
  }

  handleCompositionStart() {
    if (this.options.hasViewFocus()) {
      this.armFocusRestore();
    }
  }

  handleFocus() {
    this.clearFocusRestoreState();
  }

  handleBlur() {
    if (
      this.shouldKeepFocus() ||
      this.hasPendingDocumentSync() ||
      this.pendingComposedDocument !== null ||
      this.options.isViewComposing()
    ) {
      this.scheduleFocusRestore(16);
      return;
    }

    this.clearFocusRestoreState();
  }

  scheduleCompositionFlush(flush: () => void, delay = 0) {
    this.clearCompositionFlushTimer();
    this.compositionFlushTimer = globalThis.setTimeout(() => {
      this.compositionFlushTimer = null;
      if (this.options.isViewComposing()) {
        return;
      }

      flush();
    }, delay);
  }

  restoreFocusIfNeeded(shouldRestoreFocus: boolean) {
    if (!shouldRestoreFocus || this.options.isViewComposing()) {
      return;
    }

    this.scheduleFocusRestore();
  }

  armFocusRestore() {
    this.pendingFocusRestore = true;
    this.focusRestoreDeadline = this.getNow() + 400;
  }

  shouldKeepFocus() {
    return this.pendingFocusRestore && this.getNow() <= this.focusRestoreDeadline;
  }

  isFocusRestorePending() {
    return this.pendingFocusRestore;
  }

  clearFocusRestoreState() {
    this.pendingFocusRestore = false;
    this.focusRestoreDeadline = 0;
    if (this.focusRestoreTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.focusRestoreTimer);
    this.focusRestoreTimer = null;
  }

  private scheduleFocusRestore(delay = 0) {
    if (!this.shouldKeepFocus()) {
      this.clearFocusRestoreState();
      return;
    }

    if (this.focusRestoreTimer !== null) {
      globalThis.clearTimeout(this.focusRestoreTimer);
    }

    this.focusRestoreTimer = globalThis.setTimeout(() => {
      this.focusRestoreTimer = null;
      if (this.options.isViewComposing() || !this.shouldKeepFocus()) {
        return;
      }

      if (!this.options.hasViewFocus()) {
        this.options.focusView();
      }
    }, delay);
  }

  private clearCompositionFlushTimer() {
    if (this.compositionFlushTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.compositionFlushTimer);
    this.compositionFlushTimer = null;
  }

  private getNow() {
    return this.options.getNow?.() ?? performance.now();
  }
}

export default WritingEditorInputSession;
