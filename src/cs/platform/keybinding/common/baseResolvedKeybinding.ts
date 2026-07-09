/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyCodeUtils } from 'cs/base/common/keyCodes';
import {
	AriaLabelProvider,
	ElectronAcceleratorLabelProvider,
	UILabelProvider,
	UserSettingsLabelProvider,
} from 'cs/base/common/keybindingLabels';
import type { Chord, SingleModifierChord } from 'cs/base/common/keybindings';
import {
	KeyCodeChord,
	ResolvedChord,
	ResolvedKeybinding,
} from 'cs/base/common/keybindings';
import { OperatingSystem } from 'cs/base/common/platform';

export abstract class BaseResolvedKeybinding<
	T extends Chord,
> extends ResolvedKeybinding {
	protected readonly os: OperatingSystem;
	protected readonly chords: readonly T[];

	constructor(os: OperatingSystem, chords: readonly T[]) {
		super();
		if (chords.length === 0) {
			throw new Error('Resolved keybinding requires at least one chord.');
		}

		this.os = os;
		this.chords = chords;
	}

	getLabel(): string | null {
		return UILabelProvider.toLabel(
			this.os,
			this.chords,
			keybinding => this.getLabelForChord(keybinding),
		);
	}

	getAriaLabel(): string | null {
		return AriaLabelProvider.toLabel(
			this.os,
			this.chords,
			keybinding => this.getAriaLabelForChord(keybinding),
		);
	}

	getElectronAccelerator(): string | null {
		if (this.chords.length > 1 || this.chords[0].isDuplicateModifierCase()) {
			return null;
		}

		return ElectronAcceleratorLabelProvider.toLabel(
			this.os,
			this.chords,
			keybinding => this.getElectronAcceleratorForChord(keybinding),
		);
	}

	getUserSettingsLabel(): string | null {
		return UserSettingsLabelProvider.toLabel(
			this.os,
			this.chords,
			keybinding => this.getUserSettingsLabelForChord(keybinding),
		);
	}

	isWYSIWYG(): boolean {
		return this.chords.every(keybinding => this.isWYSIWYGChord(keybinding));
	}

	hasMultipleChords(): boolean {
		return this.chords.length > 1;
	}

	getChords(): ResolvedChord[] {
		return this.chords.map(keybinding => new ResolvedChord(
			keybinding.ctrlKey,
			keybinding.shiftKey,
			keybinding.altKey,
			keybinding.metaKey,
			this.getLabelForChord(keybinding),
			this.getAriaLabelForChord(keybinding),
		));
	}

	getDispatchChords(): (string | null)[] {
		return this.chords.map(keybinding => this.getChordDispatch(keybinding));
	}

	getSingleModifierDispatchChords(): (SingleModifierChord | null)[] {
		return this.chords.map(keybinding =>
			this.getSingleModifierChordDispatch(keybinding),
		);
	}

	protected abstract getLabelForChord(keybinding: T): string | null;
	protected abstract getAriaLabelForChord(keybinding: T): string | null;
	protected abstract getElectronAcceleratorForChord(keybinding: T): string | null;
	protected abstract getUserSettingsLabelForChord(keybinding: T): string | null;
	protected abstract isWYSIWYGChord(keybinding: T): boolean;
	protected abstract getChordDispatch(keybinding: T): string | null;
	protected abstract getSingleModifierChordDispatch(
		keybinding: T,
	): SingleModifierChord | null;
}

export class KeyCodeResolvedKeybinding
	extends BaseResolvedKeybinding<KeyCodeChord>
{
	constructor(chords: readonly KeyCodeChord[], os: OperatingSystem) {
		super(os, chords);
	}

	protected getLabelForChord(keybinding: KeyCodeChord): string | null {
		if (keybinding.isDuplicateModifierCase()) {
			return '';
		}

		if (this.os === OperatingSystem.Macintosh) {
			switch (keybinding.keyCode) {
				case KeyCode.LeftArrow:
					return '←';
				case KeyCode.UpArrow:
					return '↑';
				case KeyCode.RightArrow:
					return '→';
				case KeyCode.DownArrow:
					return '↓';
			}
		}

		return KeyCodeUtils.toString(keybinding.keyCode);
	}

	protected getAriaLabelForChord(keybinding: KeyCodeChord): string | null {
		if (keybinding.isDuplicateModifierCase()) {
			return '';
		}

		return KeyCodeUtils.toString(keybinding.keyCode);
	}

	protected getElectronAcceleratorForChord(
		keybinding: KeyCodeChord,
	): string | null {
		return KeyCodeUtils.toString(keybinding.keyCode);
	}

	protected getUserSettingsLabelForChord(
		keybinding: KeyCodeChord,
	): string | null {
		if (keybinding.isDuplicateModifierCase()) {
			return '';
		}

		return KeyCodeUtils.toUserSettings(keybinding.keyCode)?.toLowerCase() ?? null;
	}

	protected isWYSIWYGChord(): boolean {
		return true;
	}

	protected getChordDispatch(keybinding: KeyCodeChord): string | null {
		if (keybinding.isModifierKey()) {
			return null;
		}

		const parts: string[] = [];
		if (keybinding.ctrlKey) {
			parts.push('ctrl');
		}
		if (keybinding.shiftKey) {
			parts.push('shift');
		}
		if (keybinding.altKey) {
			parts.push('alt');
		}
		if (keybinding.metaKey) {
			parts.push('meta');
		}

		const key = KeyCodeUtils.toString(keybinding.keyCode);
		if (!key) {
			return null;
		}

		parts.push(key);
		return parts.join('+');
	}

	protected getSingleModifierChordDispatch(
		keybinding: KeyCodeChord,
	): SingleModifierChord | null {
		if (
			keybinding.keyCode === KeyCode.Ctrl &&
			!keybinding.shiftKey &&
			!keybinding.altKey &&
			!keybinding.metaKey
		) {
			return 'ctrl';
		}
		if (
			keybinding.keyCode === KeyCode.Shift &&
			!keybinding.ctrlKey &&
			!keybinding.altKey &&
			!keybinding.metaKey
		) {
			return 'shift';
		}
		if (
			keybinding.keyCode === KeyCode.Alt &&
			!keybinding.ctrlKey &&
			!keybinding.shiftKey &&
			!keybinding.metaKey
		) {
			return 'alt';
		}
		if (
			keybinding.keyCode === KeyCode.Meta &&
			!keybinding.ctrlKey &&
			!keybinding.shiftKey &&
			!keybinding.altKey
		) {
			return 'meta';
		}

		return null;
	}
}
