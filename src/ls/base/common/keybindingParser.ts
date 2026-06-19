import { KeyCodeUtils, ScanCodeUtils } from 'ls/base/common/keyCodes';
import {
  type Chord,
  Keybinding,
  KeyCodeChord,
  ScanCodeChord,
} from 'ls/base/common/keybindings';

export class KeybindingParser {
  private static readModifiers(input: string) {
    let remaining = input.toLowerCase().trim();

    let ctrl = false;
    let shift = false;
    let alt = false;
    let meta = false;

    let matchedModifier: boolean;
    do {
      matchedModifier = false;
      if (/^ctrl(\+|-)/.test(remaining)) {
        ctrl = true;
        remaining = remaining.slice('ctrl-'.length);
        matchedModifier = true;
      }
      if (/^shift(\+|-)/.test(remaining)) {
        shift = true;
        remaining = remaining.slice('shift-'.length);
        matchedModifier = true;
      }
      if (/^alt(\+|-)/.test(remaining)) {
        alt = true;
        remaining = remaining.slice('alt-'.length);
        matchedModifier = true;
      }
      if (/^meta(\+|-)/.test(remaining)) {
        meta = true;
        remaining = remaining.slice('meta-'.length);
        matchedModifier = true;
      }
      if (/^win(\+|-)/.test(remaining)) {
        meta = true;
        remaining = remaining.slice('win-'.length);
        matchedModifier = true;
      }
      if (/^cmd(\+|-)/.test(remaining)) {
        meta = true;
        remaining = remaining.slice('cmd-'.length);
        matchedModifier = true;
      }
    } while (matchedModifier);

    const firstSpaceIndex = remaining.indexOf(' ');
    const key =
      firstSpaceIndex > 0
        ? remaining.substring(0, firstSpaceIndex)
        : remaining;
    remaining = firstSpaceIndex > 0 ? remaining.substring(firstSpaceIndex) : '';

    return { remains: remaining.trimStart(), ctrl, shift, alt, meta, key };
  }

  private static parseChord(input: string): [Chord, string] {
    const mods = this.readModifiers(input);
    const scanCodeMatch = mods.key.match(/^\[([^\]]+)\]$/);
    if (scanCodeMatch) {
      return [
        new ScanCodeChord(
          mods.ctrl,
          mods.shift,
          mods.alt,
          mods.meta,
          ScanCodeUtils.lowerCaseToEnum(scanCodeMatch[1]),
        ),
        mods.remains,
      ];
    }

    return [
      new KeyCodeChord(
        mods.ctrl,
        mods.shift,
        mods.alt,
        mods.meta,
        KeyCodeUtils.fromUserSettings(mods.key),
      ),
      mods.remains,
    ];
  }

  static parseKeybinding(input: string): Keybinding | null {
    if (!input) {
      return null;
    }

    const chords: Chord[] = [];
    let remaining = input;
    while (remaining.length > 0) {
      const [chord, nextRemaining] = this.parseChord(remaining);
      chords.push(chord);
      remaining = nextRemaining;
    }

    return chords.length > 0 ? new Keybinding(chords) : null;
  }
}
