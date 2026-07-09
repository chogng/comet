/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { QuickAccessController } from 'cs/platform/quickinput/browser/quickAccess';
import { QuickInputController } from 'cs/platform/quickinput/browser/quickInputController';
import type {
	IInputBox,
	IInputOptions,
	IKeyMods,
	IPickOptions,
	IQuickInput,
	IQuickInputButton,
	IQuickNavigateConfiguration,
	IQuickPick,
	IQuickPickItem,
	IQuickTree,
	IQuickTreeItem,
	IQuickWidget,
	QuickInputAlignment,
	QuickPickInput,
} from 'cs/platform/quickinput/common/quickInput';
import { IQuickInputService, QuickInputHideReason } from 'cs/platform/quickinput/common/quickInput';

export class QuickInputService extends Disposable implements IQuickInputService {
	declare readonly _serviceBrand: undefined;

	readonly backButton: IQuickInputButton = {
		iconClass: 'codicon codicon-arrow-left',
		tooltip: 'Back',
	};

	private readonly controller = this._register(new QuickInputController());
	private quickAccessController: QuickAccessController | undefined;

	private readonly onShowEmitter = this._register(new Emitter<void>());
	readonly onShow = this.onShowEmitter.event;

	private readonly onHideEmitter = this._register(new Emitter<void>());
	readonly onHide = this.onHideEmitter.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(this.controller.onShow(() => this.onShowEmitter.fire()));
		this._register(this.controller.onHide(() => this.onHideEmitter.fire()));
	}

	get currentQuickInput(): IQuickInput | undefined {
		return this.controller.currentQuickInput;
	}

	get quickAccess(): QuickAccessController {
		if (!this.quickAccessController) {
			this.quickAccessController = this._register(
				this.instantiationService.createInstance(QuickAccessController),
			);
		}
		return this.quickAccessController;
	}

	pick<T extends IQuickPickItem, O extends IPickOptions<T>>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[],
		options?: O,
		token: CancellationToken = CancellationTokenNone,
	): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		return this.controller.pick(picks, options, token);
	}

	input(options: IInputOptions = {}, token: CancellationToken = CancellationTokenNone): Promise<string | undefined> {
		return this.controller.inputBox(options, token);
	}

	createQuickPick<T extends IQuickPickItem>(_options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(_options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;
	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T> {
		return this.controller.createQuickPick<T>();
	}

	createInputBox(): IInputBox {
		return this.controller.createInputBox();
	}

	createQuickWidget(): IQuickWidget {
		return this.controller.createQuickWidget();
	}

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T> {
		return this.controller.createQuickTree<T>();
	}

	focus(): void {
		this.controller.focus();
	}

	toggle(): void {
		this.controller.toggle();
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void {
		this.controller.navigate(next, quickNavigate);
	}

	accept(keyMods?: IKeyMods): void {
		this.controller.accept(keyMods);
	}

	back(): void {
		this.controller.back();
	}

	cancel(reason: QuickInputHideReason = QuickInputHideReason.Other): Promise<void> {
		return this.controller.cancel(reason);
	}

	setAlignment(alignment: QuickInputAlignment): void {
		this.controller.setAlignment(alignment);
	}

	toggleHover(): void {
		this.controller.toggleHover();
	}
}
