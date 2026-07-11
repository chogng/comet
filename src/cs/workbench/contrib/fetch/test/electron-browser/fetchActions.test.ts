/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URI } from 'cs/base/common/uri';
import { isIMenuItem, MenuRegistry } from 'cs/platform/actions/common/actions';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { FetchCommandId } from 'cs/workbench/contrib/fetch/electron-browser/fetchActions';
import { FetchJournalMenuId } from 'cs/workbench/contrib/fetch/electron-browser/fetchMenus';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';

test('Fetch journal action opens the registered journal home URL through the Fetch menu', async () => {
	const homeUrl = URI.parse('https://example.com/journal');
	let openedUrl: URI | undefined;
	const accessor = {
		get(serviceId: typeof IFetchService | typeof IOpenerService) {
			if (serviceId === IFetchService) {
				return { getJournal: () => ({ id: 'journal.example', title: 'Example', homeUrl }) };
			}
			return { open: async (url: URI) => { openedUrl = url; } };
		},
	} as ServicesAccessor;

	const command = commandsRegistry.getCommand(FetchCommandId.OpenJournalHome);
	assert.ok(command);
	await command.handler(accessor, 'journal.example');
	assert.equal(openedUrl, homeUrl);
	const menuItem = MenuRegistry.getMenuItems(FetchJournalMenuId)[0];
	assert.ok(isIMenuItem(menuItem));
	assert.equal(menuItem.command.id, FetchCommandId.OpenJournalHome);
});
