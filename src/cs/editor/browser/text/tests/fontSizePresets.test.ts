import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EDITOR_NAMED_FONT_SIZE_PRESETS,
  getEditorNamedFontSizeCssPx,
  getEditorNamedFontSizeDocxHalfPoints,
} from 'cs/base/common/editorFormat';
import { defaultDocxExportConfig } from 'cs/code/electron-main/document/docxConfig';

test('Chinese named font-size presets stay ordered from large to small', () => {
  assert.equal(EDITOR_NAMED_FONT_SIZE_PRESETS[0]?.name, '初号');
  assert.equal(EDITOR_NAMED_FONT_SIZE_PRESETS.at(-1)?.name, '小六');

  for (let index = 1; index < EDITOR_NAMED_FONT_SIZE_PRESETS.length; index += 1) {
    assert.equal(
      EDITOR_NAMED_FONT_SIZE_PRESETS[index - 1].cssPx >
        EDITOR_NAMED_FONT_SIZE_PRESETS[index].cssPx,
      true,
    );
  }
});

test('DOCX export config reuses the shared Chinese named font-size mapping', () => {
  assert.equal(defaultDocxExportConfig.article.titleFontSize, getEditorNamedFontSizeDocxHalfPoints('小四'));
  assert.equal(defaultDocxExportConfig.article.bodyFontSize, getEditorNamedFontSizeDocxHalfPoints('小四'));
  assert.equal(defaultDocxExportConfig.journal.titleFontSize, getEditorNamedFontSizeDocxHalfPoints('小三'));
  assert.equal(getEditorNamedFontSizeCssPx('小四'), 16);
});
