import { KeyCode, ScanCode } from 'ls/base/common/keyCodes';
import { OperatingSystem } from 'ls/base/common/platform';

const enum BinaryKeybindingsMask {
  CtrlCmd = (1 << 11) >>> 0,
  Shift = (1 << 10) >>> 0,
  Alt = (1 << 9) >>> 0,
  WinCtrl = (1 << 8) >>> 0,
  KeyCode = 0x000000ff,
}

export function decodeKeybinding(
  keybinding: number | number[],
  OS: OperatingSystem,
): Keybinding | null {
  if (typeof keybinding === 'number') {
    if (keybinding === 0) {
      return null;
    }

    const firstChord = (keybinding & 0x0000ffff) >>> 0;
    const secondChord = (keybinding & 0xffff0000) >>> 16;
    if (secondChord !== 0) {
      return new Keybinding([
        createSimpleKeybinding(firstChord, OS),
        createSimpleKeybinding(secondChord, OS),
      ]);
    }

    return new Keybinding([createSimpleKeybinding(firstChord, OS)]);
  }

  return new Keybinding(
    keybinding.map((part) => createSimpleKeybinding(part, OS)),
  );
}

export function createSimpleKeybinding(
  keybinding: number,
  OS: OperatingSystem,
): KeyCodeChord {
  const ctrlCmd = Boolean(keybinding & BinaryKeybindingsMask.CtrlCmd);
  const winCtrl = Boolean(keybinding & BinaryKeybindingsMask.WinCtrl);

  return new KeyCodeChord(
    OS === OperatingSystem.Macintosh ? winCtrl : ctrlCmd,
    Boolean(keybinding & BinaryKeybindingsMask.Shift),
    Boolean(keybinding & BinaryKeybindingsMask.Alt),
    OS === OperatingSystem.Macintosh ? ctrlCmd : winCtrl,
    keybinding & BinaryKeybindingsMask.KeyCode,
  );
}

export interface Modifiers {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export class KeyCodeChord implements Modifiers {
  constructor(
    public readonly ctrlKey: boolean,
    public readonly shiftKey: boolean,
    public readonly altKey: boolean,
    public readonly metaKey: boolean,
    public readonly keyCode: KeyCode,
  ) {}

  equals(other: Chord): boolean {
    return (
      other instanceof KeyCodeChord &&
      this.ctrlKey === other.ctrlKey &&
      this.shiftKey === other.shiftKey &&
      this.altKey === other.altKey &&
      this.metaKey === other.metaKey &&
      this.keyCode === other.keyCode
    );
  }

  getHashCode(): string {
    return `K${this.ctrlKey ? 1 : 0}${this.shiftKey ? 1 : 0}${
      this.altKey ? 1 : 0
    }${this.metaKey ? 1 : 0}${this.keyCode}`;
  }

  isModifierKey(): boolean {
    return (
      this.keyCode === KeyCode.Unknown ||
      this.keyCode === KeyCode.Ctrl ||
      this.keyCode === KeyCode.Meta ||
      this.keyCode === KeyCode.Alt ||
      this.keyCode === KeyCode.Shift
    );
  }

  toKeybinding(): Keybinding {
    return new Keybinding([this]);
  }

  isDuplicateModifierCase(): boolean {
    return (
      (this.ctrlKey && this.keyCode === KeyCode.Ctrl) ||
      (this.shiftKey && this.keyCode === KeyCode.Shift) ||
      (this.altKey && this.keyCode === KeyCode.Alt) ||
      (this.metaKey && this.keyCode === KeyCode.Meta)
    );
  }
}

export class ScanCodeChord implements Modifiers {
  constructor(
    public readonly ctrlKey: boolean,
    public readonly shiftKey: boolean,
    public readonly altKey: boolean,
    public readonly metaKey: boolean,
    public readonly scanCode: ScanCode,
  ) {}

  equals(other: Chord): boolean {
    return (
      other instanceof ScanCodeChord &&
      this.ctrlKey === other.ctrlKey &&
      this.shiftKey === other.shiftKey &&
      this.altKey === other.altKey &&
      this.metaKey === other.metaKey &&
      this.scanCode === other.scanCode
    );
  }

  getHashCode(): string {
    return `S${this.ctrlKey ? 1 : 0}${this.shiftKey ? 1 : 0}${
      this.altKey ? 1 : 0
    }${this.metaKey ? 1 : 0}${this.scanCode}`;
  }

  isDuplicateModifierCase(): boolean {
    return (
      (this.ctrlKey &&
        (this.scanCode === ScanCode.ControlLeft ||
          this.scanCode === ScanCode.ControlRight)) ||
      (this.shiftKey &&
        (this.scanCode === ScanCode.ShiftLeft ||
          this.scanCode === ScanCode.ShiftRight)) ||
      (this.altKey &&
        (this.scanCode === ScanCode.AltLeft ||
          this.scanCode === ScanCode.AltRight)) ||
      (this.metaKey &&
        (this.scanCode === ScanCode.MetaLeft ||
          this.scanCode === ScanCode.MetaRight))
    );
  }
}

export type Chord = KeyCodeChord | ScanCodeChord;

export class Keybinding {
  readonly chords: Chord[];

  constructor(chords: Chord[]) {
    if (chords.length === 0) {
      throw new Error('Keybinding requires at least one chord.');
    }

    this.chords = chords;
  }

  getHashCode(): string {
    return this.chords.map((chord) => chord.getHashCode()).join(';');
  }

  equals(other: Keybinding | null): boolean {
    return (
      other !== null &&
      this.chords.length === other.chords.length &&
      this.chords.every((chord, index) => chord.equals(other.chords[index]))
    );
  }
}

export class ResolvedChord {
  constructor(
    public readonly ctrlKey: boolean,
    public readonly shiftKey: boolean,
    public readonly altKey: boolean,
    public readonly metaKey: boolean,
    public readonly keyLabel: string | null,
    public readonly keyAriaLabel: string | null,
  ) {}
}

export type SingleModifierChord = 'ctrl' | 'shift' | 'alt' | 'meta';

export abstract class ResolvedKeybinding {
  abstract getLabel(): string | null;
  abstract getAriaLabel(): string | null;
  abstract getElectronAccelerator(): string | null;
  abstract getUserSettingsLabel(): string | null;
  abstract isWYSIWYG(): boolean;
  abstract hasMultipleChords(): boolean;
  abstract getChords(): ResolvedChord[];
  abstract getDispatchChords(): (string | null)[];
  abstract getSingleModifierDispatchChords(): (SingleModifierChord | null)[];
}
