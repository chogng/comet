/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { localize } from 'cs/nls';
import type { ILocalizedString } from 'cs/platform/action/common/action';
import { getMenuActions, MenuId, MenuItemAction } from 'cs/platform/actions/common/actions';
import { PickerQuickAccessProvider, type Picks } from 'cs/platform/quickinput/browser/pickerQuickAccess';
import type { ICommandQuickPick } from 'cs/platform/quickinput/browser/commandsQuickAccess';
import { COMMANDS_QUICK_ACCESS_PREFIX } from 'cs/workbench/browser/quickaccess';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';

function localizedValue(value: string | ILocalizedString | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	return typeof value === 'string' ? value : value.value;
}

function getCommandLabel(action: MenuItemAction): string {
	const category = localizedValue(action.item.category);
	return category ? `${category}: ${action.label}` : action.label;
}

export class CommandsQuickAccessProvider extends PickerQuickAccessProvider<ICommandQuickPick> {
	static readonly PREFIX = COMMANDS_QUICK_ACCESS_PREFIX;

	constructor(
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
	) {
		super(CommandsQuickAccessProvider.PREFIX, {
			noResultsPick: () => ({
				label: localize('noCommandResults', "No matching commands"),
				commandId: '',
				accept() {
				},
			}),
		});
	}

	protected getPicks(_filter: string, _token: CancellationToken): Picks<ICommandQuickPick> {
		const menuActions = getMenuActions(MenuId.CommandPalette)
			.flatMap(([, actions]) => actions)
			.filter((action): action is MenuItemAction =>
				action instanceof MenuItemAction && action.enabled,
			);

		return menuActions
			.map(action => {
				const label = getCommandLabel(action);
				const commandId = action.id;
				return {
					label,
					description: commandId,
					commandId,
					accept: () => {
						this.commandService.executeCommand(commandId);
					},
				};
			})
			.sort((left, right) => left.label.localeCompare(right.label));
	}
}
