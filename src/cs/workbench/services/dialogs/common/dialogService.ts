/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { Severity } from 'cs/platform/notification/common/notification';

export const IDialogService =
	createDecorator<IDialogService>('dialogService');

export const IFileDialogService =
	createDecorator<IFileDialogService>('fileDialogService');

export interface IConfirmation {
	readonly title?: string;
	readonly message: string;
	readonly detail?: string;
	readonly primaryButton?: string;
	readonly cancelButton?: string;
	readonly checkboxLabel?: string;
	readonly checkboxChecked?: boolean;
	readonly type?: Severity;
}

export interface IConfirmationResult {
	readonly confirmed: boolean;
	readonly checkboxChecked?: boolean;
}

export interface IPromptButton<T> {
	readonly label: string;
	readonly result: T;
	readonly primary?: boolean;
}

export interface IPrompt<T> {
	readonly title?: string;
	readonly message: string;
	readonly detail?: string;
	readonly type?: Severity;
	readonly buttons?: readonly IPromptButton<T>[];
	readonly cancelButton?: string;
	readonly checkboxLabel?: string;
	readonly checkboxChecked?: boolean;
	readonly cancellationToken?: CancellationToken;
}

export interface IPromptResult<T> {
	readonly result: T | undefined;
	readonly checkboxChecked?: boolean;
}

export interface IInput {
	readonly title?: string;
	readonly message: string;
	readonly detail?: string;
	readonly value?: string;
	readonly placeholder?: string;
	readonly password?: boolean;
	readonly primaryButton?: string;
	readonly cancelButton?: string;
	readonly cancellationToken?: CancellationToken;
}

export interface IInputResult {
	readonly value: string | undefined;
}

export interface IDialogService {
	readonly _serviceBrand: undefined;
	confirm(confirmation: IConfirmation): Promise<IConfirmationResult>;
	prompt<T>(prompt: IPrompt<T>): Promise<IPromptResult<T>>;
	input(input: IInput): Promise<IInputResult>;
	info(message: string, detail?: string): Promise<void>;
	warn(message: string, detail?: string): Promise<void>;
	error(message: string, detail?: string): Promise<void>;
}

export interface IFileDialogFilter {
	readonly name: string;
	readonly extensions: readonly string[];
}

export interface IOpenDialogOptions {
	readonly title?: string;
	readonly defaultUri?: URI;
	readonly openLabel?: string;
	readonly filters?: readonly IFileDialogFilter[];
	readonly canSelectFiles?: boolean;
	readonly canSelectFolders?: boolean;
	readonly canSelectMany?: boolean;
}

export interface ISaveDialogOptions {
	readonly title?: string;
	readonly defaultUri?: URI;
	readonly saveLabel?: string;
	readonly filters?: readonly IFileDialogFilter[];
}

export interface IFileDialogService {
	readonly _serviceBrand: undefined;
	showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined>;
	showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined>;
	pickFileToSave(defaultUri: URI, availableFileSystems?: readonly string[]): Promise<URI | undefined>;
}
