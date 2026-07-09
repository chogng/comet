/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { KeyCode } from 'cs/base/common/keyCodes';
import type {
	Keybinding,
	KeyCodeChord,
	ResolvedKeybinding,
} from 'cs/base/common/keybindings';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { ContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { ResolutionResult } from 'cs/platform/keybinding/common/keybindingResolver';
import type { ResolvedKeybindingItem } from 'cs/platform/keybinding/common/resolvedKeybindingItem';

export interface IKeyboardEvent {
	readonly _standardKeyboardEventBrand: true;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly altGraphKey: boolean;
	readonly keyCode: KeyCode;
	readonly code: string;
	toKeyCodeChord(): KeyCodeChord;
	preventDefault(): void;
	stopPropagation(): void;
}

export interface KeybindingsSchemaContribution {
	readonly onDidChange?: Event<void>;
	getSchemaAdditions(): readonly unknown[];
}

export const IKeybindingService =
	createDecorator<IKeybindingService>('keybindingService');

export interface IKeybindingService {
	readonly _serviceBrand: undefined;
	readonly inChordMode: boolean;
	readonly onDidUpdateKeybindings: Event<void>;
	resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[];
	resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding;
	resolveUserBinding(userBinding: string): ResolvedKeybinding[];
	dispatchEvent(event: IKeyboardEvent, target: EventTarget | null): boolean;
	softDispatch(event: IKeyboardEvent, target: EventTarget | null): ResolutionResult;
	enableKeybindingHoldMode(commandId: string): Promise<void> | undefined;
	dispatchByUserSettingsLabel(
		userSettingsLabel: string,
		target: EventTarget | null,
	): void;
	lookupKeybindings(commandId: string): ResolvedKeybinding[];
	lookupKeybinding(
		commandId: string,
		context?: ContextKeyService,
		enforceContextCheck?: boolean,
	): ResolvedKeybinding | undefined;
	getDefaultKeybindingsContent(): string;
	getDefaultKeybindings(): readonly ResolvedKeybindingItem[];
	getKeybindings(): readonly ResolvedKeybindingItem[];
	customKeybindingsCount(): number;
	mightProducePrintableCharacter(event: IKeyboardEvent): boolean;
	registerSchemaContribution(
		contribution: KeybindingsSchemaContribution,
	): IDisposable;
	toggleLogging(): boolean;
	appendKeybinding(
		label: string,
		commandId: string | undefined | null,
		context?: ContextKeyService,
		enforceContextCheck?: boolean,
	): string;
	_dumpDebugInfo(): string;
	_dumpDebugInfoJSON(): string;
}
