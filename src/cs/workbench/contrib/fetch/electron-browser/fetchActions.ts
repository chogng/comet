/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { localize2 } from 'cs/nls';
import { IFetchService, type JournalId } from 'cs/workbench/services/fetch/common/fetch';

export const FetchCommandId = {
	OpenJournalHome: 'fetch.openJournalHome',
} as const;

class OpenJournalHomeAction extends Action2 {
	constructor() {
		super({
			id: FetchCommandId.OpenJournalHome,
			title: localize2('fetch.openJournalHome', "Open Journal Home"),
		});
	}

	async run(accessor: ServicesAccessor, journalId?: JournalId): Promise<void> {
		if (!journalId) {
			throw new Error('A journal ID is required to open a journal home page.');
		}
		const journal = accessor.get(IFetchService).getJournal(journalId);
		if (!journal) {
			throw new Error(`Journal "${journalId}" is not registered.`);
		}
		await accessor.get(IOpenerService).open(journal.homeUrl, { openExternal: true });
	}
}

registerAction2(OpenJournalHomeAction);
