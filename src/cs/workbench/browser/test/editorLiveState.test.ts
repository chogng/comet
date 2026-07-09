import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyWritingEditorDocument,
  createWritingEditorDocumentFromPlainText,
} from 'cs/editor/common/writingEditorDocument';
import { createEditorLiveDraftState } from 'cs/workbench/browser/parts/editor/editorLiveState';

test('live draft state updates the active draft document immediately', () => {
  const state = createEditorLiveDraftState();
  const nextDocument = createWritingEditorDocumentFromPlainText('alpha');

  state.sync({
    activeDraftDocument: nextDocument,
    contextDraftDocument: nextDocument,
  });

  assert.deepEqual(state.getActiveDraftDocument(), nextDocument);
});

test('live draft state computes plain text lazily for the context draft', () => {
  const state = createEditorLiveDraftState();
  const nextDocument = createWritingEditorDocumentFromPlainText('alpha');

  state.sync({
    activeDraftDocument: nextDocument,
    contextDraftDocument: nextDocument,
  });

  assert.equal(state.getContextDraftBody(), 'alpha');
  assert.equal(state.getContextDraftBody(), 'alpha');
});

test('live draft state clears cached body when the context draft disappears', () => {
  const state = createEditorLiveDraftState();

  state.sync({
    activeDraftDocument: createWritingEditorDocumentFromPlainText('alpha'),
    contextDraftDocument: createWritingEditorDocumentFromPlainText('alpha'),
  });
  assert.equal(state.getContextDraftBody(), 'alpha');

  state.sync({
    activeDraftDocument: createEmptyWritingEditorDocument(),
    contextDraftDocument: null,
  });

  assert.equal(state.getContextDraftBody(), '');
});
