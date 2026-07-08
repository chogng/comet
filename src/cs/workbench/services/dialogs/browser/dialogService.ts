/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	Dialog,
	type DialogType,
	type IDialogButton,
	type IDialogOptions,
} from 'cs/base/browser/ui/dialog/dialog';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Disposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { Severity } from 'cs/platform/notification/common/notification';
import {
	IDialogService,
	type IConfirmation,
	type IConfirmationResult,
	type IInput,
	type IInputResult,
	type IPrompt,
	type IPromptButton,
	type IPromptResult,
} from 'cs/workbench/services/dialogs/common/dialogService';

function toDialogType(severity: Severity | undefined): DialogType {
	switch (severity) {
		case Severity.Error:
			return 'error';
		case Severity.Warning:
			return 'warning';
		case Severity.Info:
			return 'info';
		default:
			return 'none';
	}
}

function toDialogButtons<T>(
	buttons: readonly IPromptButton<T>[] | undefined,
	cancelButton: string | undefined,
): readonly IDialogButton[] {
	const dialogButtons: IDialogButton[] = [];
	for (const button of buttons ?? []) {
		dialogButtons.push({
			label: button.label,
			primary: button.primary,
		});
	}

	if (cancelButton) {
		dialogButtons.push({
			label: cancelButton,
		});
	}

	return dialogButtons;
}

export class BrowserDialogService extends Disposable implements IDialogService {
	declare readonly _serviceBrand: undefined;

	private queue = Promise.resolve();

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		const buttons = [
			{
				label: confirmation.primaryButton ?? localize('dialogConfirm', "OK"),
				primary: true,
			},
			{
				label: confirmation.cancelButton ?? localize('dialogCancel', "Cancel"),
			},
		];
		const result = await this.show({
			title: confirmation.title,
			message: confirmation.message,
			detail: confirmation.detail,
			type: toDialogType(confirmation.type),
			buttons,
			cancelId: 1,
			checkboxLabel: confirmation.checkboxLabel,
			checkboxChecked: confirmation.checkboxChecked,
			closeLabel: confirmation.cancelButton ?? localize('dialogCancel', "Cancel"),
		});

		return {
			confirmed: result.button === 0,
			checkboxChecked: result.checkboxChecked,
		};
	}

	async prompt<T>(prompt: IPrompt<T>): Promise<IPromptResult<T>> {
		const promptButtons = prompt.buttons ?? [];
		const buttons = toDialogButtons(promptButtons, prompt.cancelButton);
		const cancelId = buttons.length > promptButtons.length ? buttons.length - 1 : undefined;
		const result = await this.show({
			title: prompt.title,
			message: prompt.message,
			detail: prompt.detail,
			type: toDialogType(prompt.type),
			buttons,
			cancelId,
			checkboxLabel: prompt.checkboxLabel,
			checkboxChecked: prompt.checkboxChecked,
			closeLabel: prompt.cancelButton ?? localize('dialogClose', "Close"),
		}, prompt.cancellationToken);

		return {
			result: result.button < promptButtons.length
				? promptButtons[result.button].result
				: undefined,
			checkboxChecked: result.checkboxChecked,
		};
	}

	async input(input: IInput): Promise<IInputResult> {
		const result = await this.show({
			title: input.title,
			message: input.message,
			detail: input.detail,
			inputs: [{
				value: input.value,
				placeholder: input.placeholder,
				type: input.password ? 'password' : 'text',
			}],
			buttons: [
				{
					label: input.primaryButton ?? localize('dialogConfirm', "OK"),
					primary: true,
				},
				{
					label: input.cancelButton ?? localize('dialogCancel', "Cancel"),
				},
			],
			cancelId: 1,
			closeLabel: input.cancelButton ?? localize('dialogCancel', "Cancel"),
		}, input.cancellationToken);

		return {
			value: result.button === 0 ? result.values?.[0] ?? '' : undefined,
		};
	}

	async info(message: string, detail?: string): Promise<void> {
		await this.prompt({
			type: Severity.Info,
			message,
			detail,
			buttons: [{
				label: localize('dialogOk', "OK"),
				result: undefined,
				primary: true,
			}],
		});
	}

	async warn(message: string, detail?: string): Promise<void> {
		await this.prompt({
			type: Severity.Warning,
			message,
			detail,
			buttons: [{
				label: localize('dialogOk', "OK"),
				result: undefined,
				primary: true,
			}],
		});
	}

	async error(message: string, detail?: string): Promise<void> {
		await this.prompt({
			type: Severity.Error,
			message,
			detail,
			buttons: [{
				label: localize('dialogOk', "OK"),
				result: undefined,
				primary: true,
			}],
		});
	}

	private show(options: IDialogOptions, cancellationToken?: CancellationToken) {
		const run = this.queue.then(() => this.showNow(options, cancellationToken));
		this.queue = run.then(() => undefined, () => undefined);
		return run;
	}

	private showNow(options: IDialogOptions, cancellationToken?: CancellationToken) {
		const dialog = this._register(new Dialog(options));
		const cancellationListener = cancellationToken?.onCancellationRequested(() => dialog.dispose());
		return dialog.show().finally(() => {
			cancellationListener?.dispose();
			dialog.dispose();
		});
	}
}

registerSingleton(IDialogService, BrowserDialogService, InstantiationType.Delayed);
