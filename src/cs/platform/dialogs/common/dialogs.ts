/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IDialogService = createDecorator<IDialogService>('dialogService');

export const enum ConfirmResult {
	SAVE = 0,
	DONT_SAVE = 1,
	CANCEL = 2,
}

export type Confirmation = {
	readonly type?: 'none' | 'info' | 'error' | 'question' | 'warning';
	readonly title?: string;
	readonly message: string;
	readonly detail?: string;
	readonly primaryButton?: string;
	readonly cancelButton?: string;
	readonly checkbox?: {
		readonly label: string;
		readonly checked?: boolean;
	};
};

export type ConfirmationResult = {
	readonly confirmed: boolean;
	readonly checkboxChecked?: boolean;
};

export interface IDialogService {
	readonly _serviceBrand: undefined;
	info(title: string, message?: string): Promise<void>;
	confirm(confirmation: Confirmation): Promise<ConfirmationResult>;
}
