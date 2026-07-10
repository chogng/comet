/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MenuId, MenuRegistry } from 'cs/platform/actions/common/actions';
import { localize2 } from 'cs/nls';
import { FetchCommandId } from 'cs/workbench/contrib/fetch/electron-browser/fetchActions';

export const FetchJournalMenuId = MenuId.for('FetchJournal');

MenuRegistry.appendMenuItem(FetchJournalMenuId, {
	command: {
		id: FetchCommandId.OpenJournalHome,
		title: localize2('fetch.openJournalHomeMenu', "Open Journal Home"),
	},
});
