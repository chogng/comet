import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyCode, KeyMod } from 'ls/base/common/keyCodes';
import { KeybindingParser } from 'ls/base/common/keybindingParser';
import { decodeKeybinding } from 'ls/base/common/keybindings';
import { OperatingSystem } from 'ls/base/common/platform';

test('decodeKeybinding maps CtrlCmd to ctrl on Windows', () => {
  const keybinding = decodeKeybinding(
    KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP,
    OperatingSystem.Windows,
  );

  assert.equal(keybinding?.chords.length, 1);
  const chord = keybinding?.chords[0];
  assert.equal(chord?.ctrlKey, true);
  assert.equal(chord?.shiftKey, true);
  assert.equal(chord?.metaKey, false);
});

test('KeybindingParser parses chords', () => {
  const keybinding = KeybindingParser.parseKeybinding('ctrl+k ctrl+s');

  assert.equal(keybinding?.chords.length, 2);
  assert.match(keybinding?.getHashCode() ?? '', /^K/);
});
