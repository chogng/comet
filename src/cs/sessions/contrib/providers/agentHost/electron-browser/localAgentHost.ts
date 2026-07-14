/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import {
	ClientContentResourceService,
	IClientContentResourceService,
	type IClientContentResourceLimits,
} from 'cs/platform/agentHost/browser/clientContentResources';
import {
	IAgentHostManagementService,
	type IAgentHostManagementService as AgentHostManagementService,
} from 'cs/platform/agentHost/browser/agentHostManagementService';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import {
	localAgentHostClientContentResourceChannelName,
	localAgentHostClientToolChannelName,
	localAgentHostConnectionChannelName,
} from 'cs/platform/agentHost/common/connectionChannel';
import type { AgentHostDisplayText, IAgentHostImplementationIdentity } from 'cs/platform/agentHost/common/protocol';
import { ClientAgentToolChannel } from 'cs/platform/agentHost/electron-browser/clientAgentToolChannel';
import { ClientContentResourceChannel } from 'cs/platform/agentHost/electron-browser/clientContentResourceChannel';
import { LocalAgentHostConnection } from 'cs/platform/agentHost/electron-browser/localAgentHostConnection';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	getWorkbenchInstantiationService,
	registerWorkbenchDisposable,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { AgentHostSessionsProvider } from '../browser/agentHostSessionsProvider.js';
import { resolveAgentHostDisplayText } from '../browser/agentHostSessionProjection.js';

export interface ILocalAgentHostSessionsContributionOptions {
	readonly maximumClientToolCallRecords: number;
	readonly contentResourceLimits: IClientContentResourceLimits;
	readonly implementation: IAgentHostImplementationIdentity;
}

class LocalAgentHostSessionsContribution extends Disposable {
	private started = false;

	constructor(
		private readonly options: ILocalAgentHostSessionsContributionOptions,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IChatService private readonly chatService: IChatService,
		@ISessionsProvidersService private readonly sessionsProvidersService: ISessionsProvidersService,
		@IAgentHostManagementService private readonly agentHostManagementService: AgentHostManagementService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
	}

	async start(): Promise<void> {
		if (this.started) {
			throw new Error('Local Agent Host Sessions contribution has already started.');
		}
		this.started = true;

		const connection = await LocalAgentHostConnection.create(
			this.mainProcessService.getChannel(localAgentHostConnectionChannelName),
			this.options.maximumClientToolCallRecords,
		);
		const provider = this._register(await AgentHostSessionsProvider.create(
			connection,
			this.chatService,
			Object.freeze({
				locale: this.localeService.getLocale(),
				resolveDisplayText: (displayText: AgentHostDisplayText) => resolveAgentHostDisplayText(
					displayText,
					this.languageService.getLocaleMessages(this.localeService.getLocale()),
				),
				implementation: this.options.implementation,
			}),
		));
		const contentResources = new ClientContentResourceService(
			connection.connection,
			this.options.contentResourceLimits,
		);
		this._register(this.agentHostManagementService.registerTarget(provider));
		const clientToolChannel = this._register(new ClientAgentToolChannel(connection.clientTools));

		registerWorkbenchService(IClientContentResourceService, contentResources);
		registerWorkbenchService(IClientAgentToolService, connection.clientTools);
		this.mainProcessService.registerChannel(
			localAgentHostClientContentResourceChannelName,
			new ClientContentResourceChannel(contentResources),
		);
		this.mainProcessService.registerChannel(
			localAgentHostClientToolChannelName,
			clientToolChannel,
		);
		this._register(toDisposable(this.localeService.subscribe(() => provider.refreshLocalizedPresentation())));
		this._register(this.sessionsProvidersService.registerProvider(provider));
	}
}

/** Starts and owns the desktop local Agent Host Sessions contribution before the Sessions shell. */
export async function initializeLocalAgentHostSessionsContribution(
	options: ILocalAgentHostSessionsContributionOptions,
): Promise<void> {
	const contribution = getWorkbenchInstantiationService().createInstance(
		LocalAgentHostSessionsContribution,
		options,
	);
	try {
		await contribution.start();
		registerWorkbenchDisposable(contribution);
	} catch (error) {
		contribution.dispose();
		throw error;
	}
}
