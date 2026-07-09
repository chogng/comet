/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAction, Separator, SubmenuAction } from 'cs/base/common/actions';
import type { MenuItemAction, SubmenuItemAction } from 'cs/platform/actions/common/actions';

export interface PrimaryAndSecondaryActions {
	primary: IAction[];
	secondary: IAction[];
}

export function getActionBarActions(
	groups: [string, Array<MenuItemAction | SubmenuItemAction>][],
	primaryGroup?: string | ((actionGroup: string) => boolean),
	shouldInlineSubmenu?: (action: SubmenuAction, group: string, groupSize: number) => boolean,
	useSeparatorsInPrimaryActions?: boolean,
): PrimaryAndSecondaryActions {
	const target: PrimaryAndSecondaryActions = { primary: [], secondary: [] };
	fillInActionBarActions(groups, target, primaryGroup, shouldInlineSubmenu, useSeparatorsInPrimaryActions);
	return target;
}

function fillInActionBarActions(
	groups: [string, Array<MenuItemAction | SubmenuItemAction>][],
	target: PrimaryAndSecondaryActions,
	primaryGroup?: string | ((actionGroup: string) => boolean),
	shouldInlineSubmenu: (action: SubmenuAction, group: string, groupSize: number) => boolean = () => false,
	useSeparatorsInPrimaryActions = false,
): void {
	const isPrimaryAction = typeof primaryGroup === 'string'
		? (actionGroup: string) => actionGroup === primaryGroup
		: (primaryGroup ?? ((actionGroup: string) => actionGroup === 'navigation'));

	const submenuInfo = new Set<{ readonly group: string; readonly action: SubmenuAction; readonly index: number }>();
	for (const [group, actions] of groups) {
		const bucket = isPrimaryAction(group) ? target.primary : target.secondary;
		if (bucket.length > 0 && (isPrimaryAction(group) ? useSeparatorsInPrimaryActions : true)) {
			bucket.push(new Separator());
		}

		for (const action of actions) {
			const index = bucket.push(action) - 1;
			if (action instanceof SubmenuAction) {
				submenuInfo.add({ group, action, index });
			}
		}
	}

	for (const { group, action, index } of submenuInfo) {
		const bucket = isPrimaryAction(group) ? target.primary : target.secondary;
		if (shouldInlineSubmenu(action, group, bucket.length)) {
			bucket.splice(index, 1, ...action.actions);
		}
	}
}
