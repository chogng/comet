/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import { IClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import {
	IAgentHostManagementService,
	type IAgentHostManagementService as AgentHostManagementService,
} from 'cs/platform/agentHost/browser/agentHostManagementService';
import {
	RemoteAgentHostConnection,
	type IRemoteAgentHostConnectionOptions,
	type IRemoteAgentHostProtocolTransport,
} from 'cs/platform/agentHost/browser/remoteAgentHostConnection';
import type { AgentHostDisplayText, IAgentHostImplementationIdentity } from 'cs/platform/agentHost/common/protocol';
import { IProgressService, type IProgressService as ProgressService } from 'cs/platform/progress/common/progress';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	getWorkbenchInstantiationService,
	registerWorkbenchDisposable,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { AgentHostSessionsProvider } from './agentHostSessionsProvider.js';
import { resolveAgentHostDisplayText } from './agentHostSessionProjection.js';
import { AgentHostOperationProgress } from './agentHostOperationProgress.js';

export interface IRemoteAgentHostSessionsContributionOptions extends IRemoteAgentHostConnectionOptions {
	readonly implementation: IAgentHostImplementationIdentity;
}

export class RemoteAgentHostSessionsContribution extends Disposable {
	private started = false;
	private terminal = false;

	constructor(
		private readonly transport: IRemoteAgentHostProtocolTransport,
		private readonly options: IRemoteAgentHostSessionsContributionOptions,
		@IChatService private readonly chatService: IChatService,
		@ISessionsProvidersService private readonly sessionsProvidersService: ISessionsProvidersService,
		@IAgentHostManagementService private readonly agentHostManagementService: AgentHostManagementService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@IProgressService private readonly progressService: ProgressService,
	) {
		super();
	}

	async start(): Promise<void> {
		if (this.started) {
			throw new Error('Remote Agent Host Sessions contribution has already started.');
		}
		this.started = true;

		const connection = await RemoteAgentHostConnection.create(this.transport, this.options);
		const operationProgress = this._register(new AgentHostOperationProgress(this.progressService));
		this._register(connection.onDidProgress(progress => operationProgress.handle(progress)));
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
		this._register(this.agentHostManagementService.registerTarget(provider));

		registerWorkbenchService(IClientContentResourceService, connection.contentResources);
		registerWorkbenchService(IClientAgentToolService, connection.clientTools);
		this._register(connection.onDidChangeState(change => {
			if (change.state === 'restoring') {
				operationProgress.clear();
				provider.beginConnectionRecovery(change.generation);
				return;
			}
			if (change.state === 'terminal') {
				this.terminal = true;
				this.dispose();
			}
		}));
		this._register(connection.onDidRequireRecovery(event => {
			void provider.recoverConnection(event.generation).then(async recovered => {
				if (!recovered || !connection.completeRecovery(event.generation)) {
					return;
				}
				await provider.completeConnectionRecovery(event.generation);
			}).catch(error => {
				if (!this.terminal) {
					onUnexpectedError(error);
				}
				this.dispose();
			});
		}));
		this._register(toDisposable(this.localeService.subscribe(() => provider.refreshLocalizedPresentation())));
		this._register(this.sessionsProvidersService.registerProvider(provider));
	}
}

/** Starts one explicitly selected remote Agent Host route as the workbench Sessions provider. */
export async function initializeRemoteAgentHostSessionsContribution(
	transport: IRemoteAgentHostProtocolTransport,
	options: IRemoteAgentHostSessionsContributionOptions,
): Promise<void> {
	const contribution = getWorkbenchInstantiationService().createInstance(
		RemoteAgentHostSessionsContribution,
		transport,
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
