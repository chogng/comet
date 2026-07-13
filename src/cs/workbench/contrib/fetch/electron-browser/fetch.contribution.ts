/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { Disposable } from 'cs/base/common/lifecycle';
import 'cs/workbench/contrib/fetch/browser/fetch.contribution';
import { localize2 } from 'cs/nls';
import { MenuRegistry } from 'cs/platform/actions/common/actions';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { FetchCommandId } from 'cs/workbench/contrib/fetch/electron-browser/fetchActions';
import { FetchJournalMenuId } from 'cs/workbench/contrib/fetch/electron-browser/fetchMenus';
import { IFetchService, type JournalId } from 'cs/workbench/services/fetch/common/fetch';
import { IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';
import { natureFetchProviderDescriptor } from 'cs/workbench/services/fetch/electron-browser/providers/nature/nature.contribution';
import { natureJournals } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureJournals';
import { scienceFetchProviderDescriptor } from 'cs/workbench/services/fetch/electron-browser/providers/science/science.contribution';
import { scienceJournals } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceJournals';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { ArticleChatAttachmentsContribution } from 'cs/workbench/contrib/fetch/browser/articleChatAttachments';
import { ArticleChatPresentationsContribution } from 'cs/workbench/contrib/fetch/browser/articleChatPresentations';

registerSingleton(IFetchPageSessionFactory, FetchPageSessionFactory, InstantiationType.Delayed);

class FetchProvidersContribution extends Disposable {
	constructor(@IFetchRegistry registry: IFetchRegistry) {
		super();
		this._register(registry.registerProvider(natureFetchProviderDescriptor));
		this._register(registry.registerProvider(scienceFetchProviderDescriptor));
		for (const journal of natureJournals) {
			this._register(registry.registerJournal(journal));
		}
		for (const journal of scienceJournals) {
			this._register(registry.registerJournal(journal));
		}
	}
}

export class FetchActionsContribution extends Disposable {
	constructor(
		@IFetchService private readonly fetchService: IFetchService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();
		const command = {
			id: FetchCommandId.OpenJournalHome,
			title: localize2('fetch.openJournalHome', "Open Journal Home"),
		};
		this._register(commandsRegistry.registerCommand(command.id, async (_accessor, journalId?: JournalId) => {
			if (!journalId) {
				throw new Error('A journal ID is required to open a journal home page.');
			}
			const journal = this.fetchService.getJournal(journalId);
			if (!journal) {
				throw new Error(`Journal "${journalId}" is not registered.`);
			}
			await this.openerService.open(journal.homeUrl, { openExternal: true });
		}));
		this._register(MenuRegistry.appendMenuItem(FetchJournalMenuId, {
			command: {
				...command,
				title: localize2('fetch.openJournalHomeMenu', "Open Journal Home"),
			},
		}));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(FetchProvidersContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(FetchActionsContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(ArticleChatAttachmentsContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(ArticleChatPresentationsContribution),
);
