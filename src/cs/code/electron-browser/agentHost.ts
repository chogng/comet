/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	localAgentClientContentResourceLimits,
	localAgentClientToolCallRecords,
} from 'cs/code/common/agentHostConfiguration';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import {
	ClientContentResourceService,
	IClientContentResourceService,
} from 'cs/platform/agentHost/browser/clientContentResources';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import {
	localAgentHostClientContentResourceChannelName,
	localAgentHostClientToolChannelName,
	localAgentHostConnectionChannelName,
} from 'cs/platform/agentHost/common/connectionChannel';
import type { AgentHostDisplayText } from 'cs/platform/agentHost/common/protocol';
import { ClientAgentToolChannel } from 'cs/platform/agentHost/electron-browser/clientAgentToolChannel';
import { ClientContentResourceChannel } from 'cs/platform/agentHost/electron-browser/clientContentResourceChannel';
import { LocalAgentHostConnection } from 'cs/platform/agentHost/electron-browser/localAgentHostConnection';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { AgentHostSessionsProvider } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionsProvider';
import { resolveAgentHostDisplayText } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionProjection';
import { ISessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	getWorkbenchInstantiationService,
	registerWorkbenchDisposable,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';

/** Installs the one local Host connection before provider and attachment contributions start. */
export async function initializeLocalAgentHostWorkbench(): Promise<void> {
	const services = getWorkbenchInstantiationService().invokeFunction(accessor => Object.freeze({
		mainProcess: accessor.get(IMainProcessService),
		chat: accessor.get(IChatService),
		providers: accessor.get(ISessionsProvidersService),
		locale: accessor.get(IWorkbenchLocaleService),
		language: accessor.get(IWorkbenchLanguageService),
	}));
	const connection = await LocalAgentHostConnection.create(
		services.mainProcess.getChannel(localAgentHostConnectionChannelName),
		localAgentClientToolCallRecords,
	);
	const providerLifetime = new DisposableStore();
	try {
		const contentResources = new ClientContentResourceService(
			connection.connection,
			localAgentClientContentResourceLimits,
		);
		registerWorkbenchService(IClientContentResourceService, contentResources);
		registerWorkbenchService(IClientAgentToolService, connection.clientTools);
		services.mainProcess.registerChannel(
			localAgentHostClientContentResourceChannelName,
			new ClientContentResourceChannel(contentResources),
		);
		services.mainProcess.registerChannel(
			localAgentHostClientToolChannelName,
			providerLifetime.add(new ClientAgentToolChannel(connection.clientTools)),
		);
		const provider = providerLifetime.add(await AgentHostSessionsProvider.create(
			connection,
			services.chat,
			Object.freeze({
				locale: services.locale.getLocale(),
				resolveDisplayText: (displayText: AgentHostDisplayText) => resolveAgentHostDisplayText(
					displayText,
					services.language.getLocaleMessages(services.locale.getLocale()),
				),
				implementation: Object.freeze({
					name: 'comet.desktop.renderer',
					build: 'agent-host.v1',
				}),
			}),
		));
		providerLifetime.add(toDisposable(services.locale.subscribe(() => provider.refreshLocalizedPresentation())));
		providerLifetime.add(services.providers.registerProvider(provider));
		registerWorkbenchDisposable(providerLifetime);
	} catch (error) {
		providerLifetime.dispose();
		connection.dispose();
		throw error;
	}
}
