import assert from 'node:assert/strict';
import test from 'node:test';

import { getEditorDraftStyleCatalogSnapshot } from 'cs/editor/browser/services/editorDraftStyleCatalog';
import { createEditorDraftToolbarStyleModel } from 'cs/editor/browser/text/editorDraftToolbarStyleModel';

const snapshot = getEditorDraftStyleCatalogSnapshot();
const defaultFontSizeLabel =
  snapshot.fontSizePresets.find((option) => option.value === snapshot.defaultBodyStyle.fontSizeValue)?.label
  ?? snapshot.defaultBodyStyle.fontSizeValue;

test('EditorDraftToolbarStyleModel resolves default font-size label without a synthetic default option', () => {
  const model = createEditorDraftToolbarStyleModel({
    fontFamilyValue: null,
    fontSizeValue: null,
    defaultTextStyleLabel: 'Default',
    snapshot,
  });

  assert.equal(model.fontSize.currentValue, '');
  assert.equal(model.fontSize.currentLabel, defaultFontSizeLabel);
  assert.equal(model.fontSize.defaultValue, snapshot.defaultBodyStyle.fontSizeValue);
  assert.equal(model.fontSize.options.some((option) => option.value === ''), false);
});

test('EditorDraftToolbarStyleModel keeps unknown custom font-size visible', () => {
  const model = createEditorDraftToolbarStyleModel({
    fontFamilyValue: null,
    fontSizeValue: '17px',
    defaultTextStyleLabel: 'Default',
    snapshot,
  });

  assert.equal(model.fontSize.currentValue, '17px');
  assert.equal(model.fontSize.currentLabel, '17px');
  assert.equal(model.fontSize.options[0]?.value, '17px');
});

test('EditorDraftToolbarStyleModel normalizes font-family aliases to preset labels', () => {
  const model = createEditorDraftToolbarStyleModel({
    fontFamilyValue: 'Times New Roman, Times, serif',
    fontSizeValue: null,
    defaultTextStyleLabel: 'Default',
    snapshot,
  });

  assert.equal(model.fontFamily.currentLabel, 'Times New Roman');
  assert.equal(
    model.fontFamily.options.some((option) => option.value === 'Times New Roman, Times, serif'),
    true,
  );
});

test('EditorDraftToolbarStyleModel includes DengXian font preset', () => {
  const model = createEditorDraftToolbarStyleModel({
    fontFamilyValue: null,
    fontSizeValue: null,
    defaultTextStyleLabel: 'Default',
    snapshot,
  });

  assert.equal(
    model.fontFamily.options.some((option) => option.label === '等线'),
    true,
  );
  assert.equal(
    model.fontFamily.options.some((option) => option.label === 'Default'),
    false,
  );
  assert.equal(model.fontFamily.currentLabel, '等线');
});
