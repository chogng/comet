/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IQuickAccessController } from 'cs/platform/quickinput/common/quickAccess';

export const IQuickInputService =
	createDecorator<IQuickInputService>('quickInputService');

export const enum QuickInputType {
	QuickPick = 'quickPick',
	InputBox = 'inputBox',
	QuickTree = 'quickTree',
	QuickWidget = 'quickWidget',
}

export const enum QuickInputHideReason {
	Blur = 1,
	Gesture = 2,
	Other = 3,
}

export const enum ItemActivation {
	NONE = 0,
	FIRST = 1,
	SECOND = 2,
	LAST = 3,
}

export const enum QuickPickFocus {
	First = 1,
	Second = 2,
	Last = 3,
	Next = 4,
	Previous = 5,
	NextPage = 6,
	PreviousPage = 7,
	NextSeparator = 8,
	PreviousSeparator = 9,
}

export interface IKeyMods {
	readonly ctrlCmd: boolean;
	readonly alt: boolean;
}

export const NO_KEY_MODS: IKeyMods = {
	ctrlCmd: false,
	alt: false,
};

export function isKeyModified(event: IKeyMods): boolean {
	return event.ctrlCmd || event.alt;
}

export interface IQuickInputButton {
	readonly iconClass?: string;
	readonly tooltip?: string;
}

export interface IQuickPickItem {
	readonly type?: 'item';
	readonly id?: string;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
	readonly picked?: boolean;
	readonly alwaysShow?: boolean;
	readonly buttons?: readonly IQuickInputButton[];
}

export interface IQuickPickSeparator {
	readonly type: 'separator';
	readonly label?: string;
	readonly buttons?: readonly IQuickInputButton[];
}

export type QuickPickItem = IQuickPickItem | IQuickPickSeparator;
export type QuickPickInput<T extends IQuickPickItem> = T | IQuickPickSeparator;

export interface IQuickPickDidAcceptEvent {
	readonly inBackground: boolean;
}

export interface IQuickPickWillAcceptEvent extends IQuickPickDidAcceptEvent {
	veto(): void;
}

export interface IQuickPickItemButtonEvent<T extends IQuickPickItem = IQuickPickItem> {
	readonly item: T;
	readonly button: IQuickInputButton;
}

export interface IQuickPickSeparatorButtonEvent {
	readonly separator: IQuickPickSeparator;
	readonly button: IQuickInputButton;
}

export interface IQuickInputHideEvent {
	readonly reason?: QuickInputHideReason;
}

export interface IQuickNavigateConfiguration {
	readonly keybindings: unknown[];
}

export interface IQuickInput extends IDisposable {
	enabled: boolean;
	busy: boolean;
	ignoreFocusOut: boolean;
	title: string | undefined;
	step: number | undefined;
	totalSteps: number | undefined;
	buttons: readonly IQuickInputButton[];
	readonly onDidHide: Event<IQuickInputHideEvent>;
	readonly onDidTriggerButton: Event<IQuickInputButton>;
	show(): void;
	hide(): void;
	fireHide(reason?: QuickInputHideReason): void;
}

export interface IQuickPick<T extends IQuickPickItem = IQuickPickItem, _O = { useSeparators: false }> extends IQuickInput {
	value: string;
	placeholder: string | undefined;
	items: readonly QuickPickInput<T>[];
	activeItems: readonly T[];
	selectedItems: readonly T[];
	canSelectMany: boolean;
	matchOnDescription: boolean;
	matchOnDetail: boolean;
	readonly onDidChangeValue: Event<string>;
	readonly onDidAccept: Event<IQuickPickDidAcceptEvent>;
	readonly onDidChangeActive: Event<readonly T[]>;
	readonly onDidChangeSelection: Event<readonly T[]>;
	readonly onDidTriggerItemButton: Event<IQuickPickItemButtonEvent<T>>;
	readonly onDidTriggerSeparatorButton: Event<IQuickPickSeparatorButtonEvent>;
	accept(): void;
}

export interface IInputBox extends IQuickInput {
	value: string;
	placeholder: string | undefined;
	password: boolean;
	prompt: string | undefined;
	readonly onDidChangeValue: Event<string>;
	readonly onDidAccept: Event<void>;
	accept(): void;
}

export interface IInputOptions {
	readonly title?: string;
	readonly value?: string;
	readonly placeHolder?: string;
	readonly prompt?: string;
	readonly password?: boolean;
	readonly ignoreFocusOut?: boolean;
}

export interface IPickOptions<T extends IQuickPickItem = IQuickPickItem> {
	readonly title?: string;
	readonly placeHolder?: string;
	readonly canPickMany?: boolean;
	readonly activeItem?: T;
	readonly ignoreFocusOut?: boolean;
	readonly matchOnDescription?: boolean;
	readonly matchOnDetail?: boolean;
	readonly quickNavigate?: IQuickNavigateConfiguration;
	readonly itemActivation?: ItemActivation;
}

export interface IQuickTreeItem extends IQuickPickItem {
	readonly children?: readonly IQuickTreeItem[];
	readonly collapsed?: boolean;
}

export interface IQuickTree<T extends IQuickTreeItem = IQuickTreeItem> extends IQuickInput {
	items: readonly T[];
	activeItems: readonly T[];
	readonly onDidAccept: Event<void>;
	accept(): void;
}

export interface IQuickWidget extends IQuickInput {
}

export type QuickInputAlignment = 'top' | 'center';

export interface IQuickInputService {
	readonly _serviceBrand: undefined;
	readonly backButton: IQuickInputButton;
	readonly currentQuickInput: IQuickInput | undefined;
	readonly quickAccess: IQuickAccessController;
	readonly onShow: Event<void>;
	readonly onHide: Event<void>;
	pick<T extends IQuickPickItem, O extends IPickOptions<T>>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[],
		options?: O,
		token?: CancellationToken,
	): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined>;
	input(options?: IInputOptions, token?: CancellationToken): Promise<string | undefined>;
	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;
	createInputBox(): IInputBox;
	createQuickWidget(): IQuickWidget;
	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T>;
	focus(): void;
	toggle(): void;
	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void;
	accept(keyMods?: IKeyMods): void;
	back(): void;
	cancel(reason?: QuickInputHideReason): Promise<void>;
	setAlignment(alignment: QuickInputAlignment): void;
	toggleHover(): void;
}
