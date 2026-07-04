import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWritingEditorKeymapBindings,
  getDraftEditorShortcutLabel,
  getDraftEditorCommandIds,
  getWritingEditorCommand,
  isDraftEditorCommandEnabled,
  matchesShortcutLabel,
} from 'cs/editor/browser/text/editorCommandRegistry';
import { writingEditorSchema } from 'cs/editor/browser/text/schema';

test('createWritingEditorKeymapBindings exposes the registered ProseMirror shortcuts', () => {
  const bindings = createWritingEditorKeymapBindings(writingEditorSchema.nodes.list_item);

  assert.equal(typeof bindings['Mod-z'], 'function');
  assert.equal(typeof bindings['Shift-Mod-z'], 'function');
  assert.equal(typeof bindings['Mod-y'], 'function');
  assert.equal(typeof bindings['Mod-b'], 'function');
  assert.equal(typeof bindings['Mod-u'], 'function');
  assert.equal(typeof bindings['Mod-Alt-1'], 'function');
  assert.equal(typeof bindings['Mod-Shift-l'], 'function');
  assert.equal(typeof bindings['Mod-Shift-e'], 'function');
  assert.equal(typeof bindings['Mod-Shift-r'], 'function');
  assert.equal(typeof bindings['Mod-Shift-8'], 'function');
  assert.equal(typeof bindings.Enter, 'function');
  assert.equal(typeof bindings.Tab, 'function');
  assert.equal(typeof bindings['Shift-Tab'], 'function');
});

test('draft editor shortcuts come from the shared registry', () => {
  assert.equal(getDraftEditorShortcutLabel('insertCitation'), 'Mod+Shift+C');
  assert.equal(getDraftEditorShortcutLabel('insertFigure'), 'Mod+Shift+F');
  assert.equal(getDraftEditorShortcutLabel('insertFigureRef'), 'Mod+Shift+R');
});

test('registry exposes command lookups and draft command ids', () => {
  assert.equal(getWritingEditorCommand('toggleBold')?.id, 'toggleBold');
  assert.deepEqual(getDraftEditorCommandIds(), [
    'insertCitation',
    'insertFigure',
    'insertFigureRef',
  ]);
});

test('draft command enablement is derived from shared registry rules', () => {
  assert.equal(
    isDraftEditorCommandEnabled('insertFigureRef', { availableFigureIds: [] }),
    false,
  );
  assert.equal(
    isDraftEditorCommandEnabled('insertFigureRef', { availableFigureIds: ['figure_1'] }),
    true,
  );
});

test('matchesShortcutLabel matches exact modifier combinations', () => {
  const matchingEvent = {
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent;
  const wrongModifierEvent = {
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: true,
  } as KeyboardEvent;

  assert.equal(matchesShortcutLabel('Mod+Shift+C', matchingEvent), true);
  assert.equal(matchesShortcutLabel('Mod+Shift+C', wrongModifierEvent), false);
});
