/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAction } from 'cs/base/common/actions';
import type { IQuickInputButton } from 'cs/platform/quickinput/common/quickInput';

export interface IQuickInputButtonAction extends IAction {
	readonly button: IQuickInputButton;
}

export function quickInputButtonToAction(
	button: IQuickInputButton,
	index: number,
	run: () => void,
): IQuickInputButtonAction {
	return {
		id: `quickInput.button.${index}`,
		label: button.tooltip ?? '',
		tooltip: button.tooltip ?? '',
		enabled: true,
		class: button.iconClass,
		button,
		run,
	};
}

export function quickInputButtonsToActionArrays(
	buttons: readonly IQuickInputButton[] = [],
	run: (button: IQuickInputButton) => void = () => {},
): { primary: IQuickInputButtonAction[]; secondary: IQuickInputButtonAction[] } {
	return {
		primary: buttons.map((button, index) =>
			quickInputButtonToAction(button, index, () => run(button)),
		),
		secondary: [],
	};
}

export function renderQuickInputDescription(description: string | undefined): string {
	return description ?? '';
}
