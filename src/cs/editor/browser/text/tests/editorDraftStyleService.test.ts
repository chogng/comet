import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EDITOR_DRAFT_BODY_COLOR,
  DEFAULT_EDITOR_DRAFT_FONT_FAMILY_VALUE,
  DEFAULT_EDITOR_DRAFT_PARAGRAPH_SPACING_AFTER_PT,
  DEFAULT_EDITOR_DRAFT_PARAGRAPH_SPACING_BEFORE_PT,
  normalizeEditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import { DEFAULT_EDITOR_BODY_FONT_SIZE_VALUE } from 'cs/base/common/editorFormat';
import { getEditorDraftStyleCatalogSnapshot } from 'cs/editor/browser/text/editorDraftStyleCatalog';
import { EditorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';

test('EditorDraftStyleService initializes from catalog and notifies on snapshot changes', () => {
  const initialSnapshot = getEditorDraftStyleCatalogSnapshot();
	const service = new EditorDraftStyleService(initialSnapshot);
  let changeCount = 0;

  const unsubscribe = service.subscribe(() => {
    changeCount += 1;
  });

  assert.deepEqual(service.getSnapshot(), initialSnapshot);

  const nextSnapshot = {
    ...initialSnapshot,
    defaultBodyStyle: {
      ...initialSnapshot.defaultBodyStyle,
      fontSizeValue: '16px',
    },
  };

  service.setSnapshot(nextSnapshot);
  assert.equal(changeCount, 1);
  assert.deepEqual(service.getSnapshot(), nextSnapshot);
  assert.notEqual(service.getSnapshot(), nextSnapshot);

  service.setSnapshot(nextSnapshot);
  assert.equal(changeCount, 1);

  unsubscribe();
	service.setSnapshot(initialSnapshot);
  assert.equal(changeCount, 1);
  assert.deepEqual(service.getSnapshot(), initialSnapshot);
});

test('EditorDraftStyleService snapshots are frozen and detached from caller-owned objects', () => {
  const initialSnapshot = getEditorDraftStyleCatalogSnapshot();
  const mutableSnapshot = {
    ...initialSnapshot,
    defaultBodyStyle: {
      ...initialSnapshot.defaultBodyStyle,
      inlineStyleDefaults: {
        ...initialSnapshot.defaultBodyStyle.inlineStyleDefaults,
      },
    },
    fontFamilyPresets: initialSnapshot.fontFamilyPresets.map((option) => ({ ...option })),
    fontSizePresets: initialSnapshot.fontSizePresets.map((option) => ({ ...option })),
  };
	const service = new EditorDraftStyleService();

  service.setSnapshot(mutableSnapshot);
  const storedSnapshot = service.getSnapshot();

  assert.notEqual(storedSnapshot, mutableSnapshot);
  assert.notEqual(storedSnapshot.fontFamilyPresets, mutableSnapshot.fontFamilyPresets);
  assert.notEqual(storedSnapshot.fontFamilyPresets[0], mutableSnapshot.fontFamilyPresets[0]);
  assert.equal(Object.isFrozen(storedSnapshot), true);
  assert.equal(Object.isFrozen(storedSnapshot.fontFamilyPresets), true);
  assert.equal(Object.isFrozen(storedSnapshot.fontFamilyPresets[0]), true);

  mutableSnapshot.defaultBodyStyle.fontSizeValue = '99px';
  mutableSnapshot.defaultBodyStyle.fontFamilyValue = '"Mutated", sans-serif';
  mutableSnapshot.defaultBodyStyle.lineHeight = 1.6;
  mutableSnapshot.defaultBodyStyle.paragraphSpacingBeforePt = 42;
  mutableSnapshot.defaultBodyStyle.paragraphSpacingAfterPt = 24;
  mutableSnapshot.defaultBodyStyle.inlineStyleDefaults.bold = true;
  mutableSnapshot.fontFamilyPresets[0].label = 'Mutated';

  assert.equal(
    service.getSnapshot().defaultBodyStyle.fontSizeValue,
    initialSnapshot.defaultBodyStyle.fontSizeValue,
  );
  assert.equal(
    service.getSnapshot().defaultBodyStyle.fontFamilyValue,
    initialSnapshot.defaultBodyStyle.fontFamilyValue,
  );
  assert.equal(service.getSnapshot().defaultBodyStyle.lineHeight, initialSnapshot.defaultBodyStyle.lineHeight);
  assert.equal(
    service.getSnapshot().defaultBodyStyle.paragraphSpacingBeforePt,
    initialSnapshot.defaultBodyStyle.paragraphSpacingBeforePt,
  );
  assert.equal(
    service.getSnapshot().defaultBodyStyle.paragraphSpacingAfterPt,
    initialSnapshot.defaultBodyStyle.paragraphSpacingAfterPt,
  );
  assert.equal(
    service.getSnapshot().defaultBodyStyle.inlineStyleDefaults.bold,
    initialSnapshot.defaultBodyStyle.inlineStyleDefaults.bold,
  );
  assert.notEqual(service.getSnapshot().fontFamilyPresets[0].label, 'Mutated');
});

test('EditorDraftStyleService setDefaultBodyStyle preserves runtime preset lists', () => {
  const initialSnapshot = getEditorDraftStyleCatalogSnapshot();
	const service = new EditorDraftStyleService({
    ...initialSnapshot,
    fontFamilyPresets: [
      {
        value: '"Custom Sans", sans-serif',
        label: 'Custom Sans',
      },
    ],
    fontSizePresets: [
      {
        value: '15px',
        label: 'Custom Size',
      },
    ],
  });

  const beforeUpdate = service.getSnapshot();
  service.setDefaultBodyStyle({
    ...beforeUpdate.defaultBodyStyle,
    fontSizeValue: '16px',
  });

  const afterUpdate = service.getSnapshot();
  assert.deepEqual(afterUpdate.fontFamilyPresets, beforeUpdate.fontFamilyPresets);
  assert.deepEqual(afterUpdate.fontSizePresets, beforeUpdate.fontSizePresets);
  assert.equal(afterUpdate.defaultBodyStyle.fontSizeValue, '16px');
});

test('normalizeEditorDraftStyleSettings tolerates partial or malformed persisted values', () => {
  const normalizedFromEmpty = normalizeEditorDraftStyleSettings(
    {} as unknown as Parameters<typeof normalizeEditorDraftStyleSettings>[0],
  );

  assert.equal(
    normalizedFromEmpty.defaultBodyStyle.fontFamilyValue,
    DEFAULT_EDITOR_DRAFT_FONT_FAMILY_VALUE,
  );
  assert.equal(normalizedFromEmpty.defaultBodyStyle.color, DEFAULT_EDITOR_DRAFT_BODY_COLOR);
  assert.equal(normalizedFromEmpty.defaultBodyStyle.inlineStyleDefaults.bold, false);

  const normalizedFromMalformed = normalizeEditorDraftStyleSettings({
    defaultBodyStyle: {
      fontFamilyValue: 12 as never,
      fontSizeValue: 'not-a-size',
      lineHeight: 0,
      paragraphSpacingBeforePt: -10,
      paragraphSpacingAfterPt: Number.NaN,
      color: null as never,
      inlineStyleDefaults: {
        bold: 1 as never,
        italic: '' as never,
        underline: 'yes' as never,
      },
    },
  });

  assert.equal(
    normalizedFromMalformed.defaultBodyStyle.fontFamilyValue,
    DEFAULT_EDITOR_DRAFT_FONT_FAMILY_VALUE,
  );
  assert.equal(
    normalizedFromMalformed.defaultBodyStyle.fontSizeValue,
    DEFAULT_EDITOR_BODY_FONT_SIZE_VALUE,
  );
  assert.equal(
    normalizedFromMalformed.defaultBodyStyle.paragraphSpacingBeforePt,
    0,
  );
  assert.equal(
    normalizedFromMalformed.defaultBodyStyle.paragraphSpacingAfterPt,
    DEFAULT_EDITOR_DRAFT_PARAGRAPH_SPACING_AFTER_PT,
  );
  assert.equal(
    normalizedFromEmpty.defaultBodyStyle.paragraphSpacingBeforePt,
    DEFAULT_EDITOR_DRAFT_PARAGRAPH_SPACING_BEFORE_PT,
  );
  assert.equal(
    normalizedFromEmpty.defaultBodyStyle.paragraphSpacingAfterPt,
    DEFAULT_EDITOR_DRAFT_PARAGRAPH_SPACING_AFTER_PT,
  );
  assert.equal(normalizedFromMalformed.defaultBodyStyle.color, DEFAULT_EDITOR_DRAFT_BODY_COLOR);
  assert.equal(normalizedFromMalformed.defaultBodyStyle.inlineStyleDefaults.bold, true);
  assert.equal(normalizedFromMalformed.defaultBodyStyle.inlineStyleDefaults.italic, false);
  assert.equal(normalizedFromMalformed.defaultBodyStyle.inlineStyleDefaults.underline, true);
});
