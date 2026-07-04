export enum KeyCode {
  DependsOnKbLayout = -1,
  Unknown = 0,
  Backspace = 1,
  Tab = 2,
  Enter = 3,
  Shift = 4,
  Ctrl = 5,
  Alt = 6,
  PauseBreak = 7,
  CapsLock = 8,
  Escape = 9,
  Space = 10,
  PageUp = 11,
  PageDown = 12,
  End = 13,
  Home = 14,
  LeftArrow = 15,
  UpArrow = 16,
  RightArrow = 17,
  DownArrow = 18,
  Insert = 19,
  Delete = 20,
  Digit0 = 21,
  Digit1 = 22,
  Digit2 = 23,
  Digit3 = 24,
  Digit4 = 25,
  Digit5 = 26,
  Digit6 = 27,
  Digit7 = 28,
  Digit8 = 29,
  Digit9 = 30,
  KeyA = 31,
  KeyB = 32,
  KeyC = 33,
  KeyD = 34,
  KeyE = 35,
  KeyF = 36,
  KeyG = 37,
  KeyH = 38,
  KeyI = 39,
  KeyJ = 40,
  KeyK = 41,
  KeyL = 42,
  KeyM = 43,
  KeyN = 44,
  KeyO = 45,
  KeyP = 46,
  KeyQ = 47,
  KeyR = 48,
  KeyS = 49,
  KeyT = 50,
  KeyU = 51,
  KeyV = 52,
  KeyW = 53,
  KeyX = 54,
  KeyY = 55,
  KeyZ = 56,
  Meta = 57,
  ContextMenu = 58,
  F1 = 59,
  F2 = 60,
  F3 = 61,
  F4 = 62,
  F5 = 63,
  F6 = 64,
  F7 = 65,
  F8 = 66,
  F9 = 67,
  F10 = 68,
  F11 = 69,
  F12 = 70,
  Semicolon = 71,
  Equal = 72,
  Comma = 73,
  Minus = 74,
  Period = 75,
  Slash = 76,
  Backquote = 77,
  BracketLeft = 78,
  Backslash = 79,
  BracketRight = 80,
  Quote = 81,
  IntlBackslash = 82,
  Numpad0 = 83,
  Numpad1 = 84,
  Numpad2 = 85,
  Numpad3 = 86,
  Numpad4 = 87,
  Numpad5 = 88,
  Numpad6 = 89,
  Numpad7 = 90,
  Numpad8 = 91,
  Numpad9 = 92,
  NumpadAdd = 93,
  NumpadSubtract = 94,
}

export enum ScanCode {
  DependsOnKbLayout = -1,
  None = 0,
  ControlLeft = 1,
  ControlRight = 2,
  ShiftLeft = 3,
  ShiftRight = 4,
  AltLeft = 5,
  AltRight = 6,
  MetaLeft = 7,
  MetaRight = 8,
}

export const KeyMod = {
  CtrlCmd: 1 << 11,
  Shift: 1 << 10,
  Alt: 1 << 9,
  WinCtrl: 1 << 8,
} as const;

export function KeyChord(firstPart: number, secondPart: number): number {
  return (firstPart & 0x0000ffff) | ((secondPart & 0x0000ffff) << 16);
}

const userSettingsToKeyCode = new Map<string, KeyCode>();
const keyCodeToUserSettings = new Map<KeyCode, string>();

function defineKeyCode(keyCode: KeyCode, label: string, ...aliases: string[]) {
  keyCodeToUserSettings.set(keyCode, label);
  userSettingsToKeyCode.set(label.toLowerCase(), keyCode);
  for (const alias of aliases) {
    userSettingsToKeyCode.set(alias.toLowerCase(), keyCode);
  }
}

defineKeyCode(KeyCode.Backspace, 'Backspace');
defineKeyCode(KeyCode.Tab, 'Tab');
defineKeyCode(KeyCode.Enter, 'Enter');
defineKeyCode(KeyCode.Shift, 'Shift');
defineKeyCode(KeyCode.Ctrl, 'Ctrl', 'Control');
defineKeyCode(KeyCode.Alt, 'Alt', 'Option');
defineKeyCode(KeyCode.Meta, 'Meta', 'Cmd', 'Win');
defineKeyCode(KeyCode.Escape, 'Escape', 'Esc');
defineKeyCode(KeyCode.Space, 'Space');
defineKeyCode(KeyCode.LeftArrow, 'LeftArrow', 'Left');
defineKeyCode(KeyCode.UpArrow, 'UpArrow', 'Up');
defineKeyCode(KeyCode.RightArrow, 'RightArrow', 'Right');
defineKeyCode(KeyCode.DownArrow, 'DownArrow', 'Down');
defineKeyCode(KeyCode.Delete, 'Delete', 'Del');
defineKeyCode(KeyCode.Semicolon, ';', 'Semicolon');
defineKeyCode(KeyCode.Equal, '=', 'Equal');
defineKeyCode(KeyCode.Comma, ',', 'Comma');
defineKeyCode(KeyCode.Minus, '-', 'Minus');
defineKeyCode(KeyCode.Period, '.', 'Period');
defineKeyCode(KeyCode.Slash, '/', 'Slash');
defineKeyCode(KeyCode.Backquote, '`', 'Backquote');
defineKeyCode(KeyCode.BracketLeft, '[', 'BracketLeft');
defineKeyCode(KeyCode.Backslash, '\\', 'Backslash');
defineKeyCode(KeyCode.BracketRight, ']', 'BracketRight');
defineKeyCode(KeyCode.Quote, "'", 'Quote');

for (let digit = 0; digit <= 9; digit += 1) {
  defineKeyCode(KeyCode.Digit0 + digit, String(digit), `Digit${digit}`);
}

for (let offset = 0; offset < 26; offset += 1) {
  const letter = String.fromCharCode('A'.charCodeAt(0) + offset);
  defineKeyCode(KeyCode.KeyA + offset, letter, `Key${letter}`);
}

for (let offset = 1; offset <= 12; offset += 1) {
  defineKeyCode(KeyCode.F1 + offset - 1, `F${offset}`);
}

export const KeyCodeUtils = {
  fromUserSettings(key: string): KeyCode {
    return userSettingsToKeyCode.get(key.trim().toLowerCase()) ?? KeyCode.Unknown;
  },

  fromString(key: string): KeyCode {
    return userSettingsToKeyCode.get(key.trim().toLowerCase()) ?? KeyCode.Unknown;
  },

  toUserSettings(keyCode: KeyCode): string | null {
    return keyCodeToUserSettings.get(keyCode) ?? null;
  },

  toString(keyCode: KeyCode): string | null {
    return keyCodeToUserSettings.get(keyCode) ?? null;
  },
};

export function isModifierKey(keyCode: KeyCode): boolean {
  return (
    keyCode === KeyCode.Ctrl ||
    keyCode === KeyCode.Shift ||
    keyCode === KeyCode.Alt ||
    keyCode === KeyCode.Meta
  );
}

export const EVENT_KEY_CODE_MAP: KeyCode[] = [];

EVENT_KEY_CODE_MAP[8] = KeyCode.Backspace;
EVENT_KEY_CODE_MAP[9] = KeyCode.Tab;
EVENT_KEY_CODE_MAP[13] = KeyCode.Enter;
EVENT_KEY_CODE_MAP[16] = KeyCode.Shift;
EVENT_KEY_CODE_MAP[17] = KeyCode.Ctrl;
EVENT_KEY_CODE_MAP[18] = KeyCode.Alt;
EVENT_KEY_CODE_MAP[19] = KeyCode.PauseBreak;
EVENT_KEY_CODE_MAP[20] = KeyCode.CapsLock;
EVENT_KEY_CODE_MAP[27] = KeyCode.Escape;
EVENT_KEY_CODE_MAP[32] = KeyCode.Space;
EVENT_KEY_CODE_MAP[33] = KeyCode.PageUp;
EVENT_KEY_CODE_MAP[34] = KeyCode.PageDown;
EVENT_KEY_CODE_MAP[35] = KeyCode.End;
EVENT_KEY_CODE_MAP[36] = KeyCode.Home;
EVENT_KEY_CODE_MAP[37] = KeyCode.LeftArrow;
EVENT_KEY_CODE_MAP[38] = KeyCode.UpArrow;
EVENT_KEY_CODE_MAP[39] = KeyCode.RightArrow;
EVENT_KEY_CODE_MAP[40] = KeyCode.DownArrow;
EVENT_KEY_CODE_MAP[45] = KeyCode.Insert;
EVENT_KEY_CODE_MAP[46] = KeyCode.Delete;
EVENT_KEY_CODE_MAP[91] = KeyCode.Meta;
EVENT_KEY_CODE_MAP[92] = KeyCode.Meta;
EVENT_KEY_CODE_MAP[93] = KeyCode.ContextMenu;
EVENT_KEY_CODE_MAP[106] = KeyCode.NumpadAdd;
EVENT_KEY_CODE_MAP[107] = KeyCode.NumpadAdd;
EVENT_KEY_CODE_MAP[109] = KeyCode.NumpadSubtract;
EVENT_KEY_CODE_MAP[186] = KeyCode.Semicolon;
EVENT_KEY_CODE_MAP[187] = KeyCode.Equal;
EVENT_KEY_CODE_MAP[188] = KeyCode.Comma;
EVENT_KEY_CODE_MAP[189] = KeyCode.Minus;
EVENT_KEY_CODE_MAP[190] = KeyCode.Period;
EVENT_KEY_CODE_MAP[191] = KeyCode.Slash;
EVENT_KEY_CODE_MAP[192] = KeyCode.Backquote;
EVENT_KEY_CODE_MAP[219] = KeyCode.BracketLeft;
EVENT_KEY_CODE_MAP[220] = KeyCode.Backslash;
EVENT_KEY_CODE_MAP[221] = KeyCode.BracketRight;
EVENT_KEY_CODE_MAP[222] = KeyCode.Quote;

for (let digit = 0; digit <= 9; digit += 1) {
  EVENT_KEY_CODE_MAP[48 + digit] = KeyCode.Digit0 + digit;
  EVENT_KEY_CODE_MAP[96 + digit] = KeyCode.Numpad0 + digit;
}

for (let offset = 0; offset < 26; offset += 1) {
  EVENT_KEY_CODE_MAP[65 + offset] = KeyCode.KeyA + offset;
}

for (let offset = 1; offset <= 12; offset += 1) {
  EVENT_KEY_CODE_MAP[111 + offset] = KeyCode.F1 + offset - 1;
}

const scanCodeMap = new Map<string, ScanCode>([
  ['controlleft', ScanCode.ControlLeft],
  ['controlright', ScanCode.ControlRight],
  ['shiftleft', ScanCode.ShiftLeft],
  ['shiftright', ScanCode.ShiftRight],
  ['altleft', ScanCode.AltLeft],
  ['altright', ScanCode.AltRight],
  ['metaleft', ScanCode.MetaLeft],
  ['metaright', ScanCode.MetaRight],
]);

export const ScanCodeUtils = {
  lowerCaseToEnum(scanCode: string): ScanCode {
    return scanCodeMap.get(scanCode.toLowerCase()) ?? ScanCode.None;
  },
};
