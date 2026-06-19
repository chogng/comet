import type { Modifiers } from 'ls/base/common/keybindings';
import { OperatingSystem } from 'ls/base/common/platform';

export interface ModifierLabels {
  readonly ctrlKey: string;
  readonly shiftKey: string;
  readonly altKey: string;
  readonly metaKey: string;
  readonly separator: string;
}

export interface KeyLabelProvider<T extends Modifiers> {
  (keybinding: T): string | null;
}

export class ModifierLabelProvider {
  private readonly modifierLabels = new Map<OperatingSystem, ModifierLabels>();

  constructor(
    mac: ModifierLabels,
    windows: ModifierLabels,
    linux: ModifierLabels = windows,
  ) {
    this.modifierLabels.set(OperatingSystem.Macintosh, mac);
    this.modifierLabels.set(OperatingSystem.Windows, windows);
    this.modifierLabels.set(OperatingSystem.Linux, linux);
  }

  toLabel<T extends Modifiers>(
    OS: OperatingSystem,
    chords: readonly T[],
    keyLabelProvider: KeyLabelProvider<T>,
  ): string | null {
    if (chords.length === 0) {
      return null;
    }

    const labels = this.modifierLabels.get(OS);
    if (!labels) {
      return null;
    }

    const result: string[] = [];
    for (const chord of chords) {
      const keyLabel = keyLabelProvider(chord);
      if (keyLabel === null) {
        return null;
      }

      result.push(simpleAsString(chord, keyLabel, labels));
    }

    return result.join(' ');
  }
}

export const UILabelProvider = new ModifierLabelProvider(
  {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Cmd',
    separator: '+',
  },
  {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Windows',
    separator: '+',
  },
  {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Super',
    separator: '+',
  },
);

export const AriaLabelProvider = new ModifierLabelProvider(
  {
    ctrlKey: 'Control',
    shiftKey: 'Shift',
    altKey: 'Option',
    metaKey: 'Command',
    separator: '+',
  },
  {
    ctrlKey: 'Control',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Windows',
    separator: '+',
  },
  {
    ctrlKey: 'Control',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Super',
    separator: '+',
  },
);

export const ElectronAcceleratorLabelProvider = new ModifierLabelProvider(
  {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Cmd',
    separator: '+',
  },
  {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Super',
    separator: '+',
  },
);

export const UserSettingsLabelProvider = new ModifierLabelProvider(
  {
    ctrlKey: 'ctrl',
    shiftKey: 'shift',
    altKey: 'alt',
    metaKey: 'cmd',
    separator: '+',
  },
  {
    ctrlKey: 'ctrl',
    shiftKey: 'shift',
    altKey: 'alt',
    metaKey: 'win',
    separator: '+',
  },
  {
    ctrlKey: 'ctrl',
    shiftKey: 'shift',
    altKey: 'alt',
    metaKey: 'meta',
    separator: '+',
  },
);

function simpleAsString(
  modifiers: Modifiers,
  key: string,
  labels: ModifierLabels,
): string {
  const result: string[] = [];

  if (modifiers.ctrlKey) {
    result.push(labels.ctrlKey);
  }
  if (modifiers.shiftKey) {
    result.push(labels.shiftKey);
  }
  if (modifiers.altKey) {
    result.push(labels.altKey);
  }
  if (modifiers.metaKey) {
    result.push(labels.metaKey);
  }
  if (key) {
    result.push(key);
  }

  return result.join(labels.separator);
}
