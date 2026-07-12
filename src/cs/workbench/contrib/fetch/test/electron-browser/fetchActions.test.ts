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
import type { IOpenerService } from 'cs/platform/opener/common/opener';
import { FetchCommandId } from 'cs/workbench/contrib/fetch/electron-browser/fetchActions';
import { FetchActionsContribution } from 'cs/workbench/contrib/fetch/electron-browser/fetch.contribution';
import { FetchJournalMenuId } from 'cs/workbench/contrib/fetch/electron-browser/fetchMenus';
import type { IFetchService } from 'cs/workbench/services/fetch/common/fetch';

test('Fetch journal action opens the registered journal home URL through the Fetch menu', async () => {
	const homeUrl = URI.parse('https://example.com/journal');
	let openedUrl: URI | undefined;
	const fetchService = {
		getJournal: () => ({ id: 'journal.example', title: 'Example', homeUrl }),
	} as unknown as IFetchService;
	const openerService = {
		open: async (url: URI) => { openedUrl = url; },
	} as unknown as IOpenerService;
	const accessor = {
		get() {
			throw new Error('Fetch actions must not resolve services through a command accessor.');
		},
	} as ServicesAccessor;
	const contribution = new FetchActionsContribution(fetchService, openerService);

	try {
		const command = commandsRegistry.getCommand(FetchCommandId.OpenJournalHome);
		assert.ok(command);
		await command.handler(accessor, 'journal.example');
		assert.equal(openedUrl, homeUrl);
		const menuItem = MenuRegistry.getMenuItems(FetchJournalMenuId)[0];
		assert.ok(isIMenuItem(menuItem));
		assert.equal(menuItem.command.id, FetchCommandId.OpenJournalHome);
	} finally {
		contribution.dispose();
	}
});
