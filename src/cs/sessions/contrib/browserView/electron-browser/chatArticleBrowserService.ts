/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import { localize } from 'cs/nls';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { createBrowserDocumentTarget } from 'cs/workbench/contrib/browserView/common/browserAgentTools';
import {
	IChatArticleBrowserService,
	assertChatArticleBrowserTarget,
	type IChatArticleBrowserTarget,
} from 'cs/workbench/contrib/browserView/common/chatArticleBrowser';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

async function waitForCommittedDocument(model: IBrowserViewModel): Promise<void> {
	if (model.loading) {
		await new Promise<void>((resolve, reject) => {
			const listeners = new DisposableStore();
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				listeners.dispose();
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			listeners.add(model.onDidChangeLoadingState(event => {
				if (event.loading) {
					return;
				}
				if (event.error) {
					finish(new Error(
						`Article Browser navigation failed: ${event.error.errorDescription}`,
					));
					return;
				}
				finish();
			}));
			listeners.add(model.onDidClose(() => {
				finish(new Error('Article Browser closed before its document committed.'));
			}));
			listeners.add(model.onWillDispose(() => {
				finish(new Error('Article Browser was disposed before its document committed.'));
			}));
			if (!model.loading) {
				if (model.error) {
					finish(new Error(
						`Article Browser navigation failed: ${model.error.errorDescription}`,
					));
					return;
				}
				finish();
			}
		});
	}
	if (model.error) {
		throw new Error(`Article Browser navigation failed: ${model.error.errorDescription}`);
	}
}

/** Opens one addressed Chat Article and binds the resulting exact Browser epoch. */
export class DesktopChatArticleBrowserService implements IChatArticleBrowserService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IEditorService private readonly editorService: IEditorService,
		@IClientAgentToolService private readonly clientToolService: IClientAgentToolService,
	) {}

	async open(target: IChatArticleBrowserTarget): Promise<void> {
		assertChatArticleBrowserTarget(target);
		const chatReference = this.chatService.acquireModel(target.chatResource);
		chatReference.dispose();
		const editor = await this.editorService.openEditor({
			resource: BrowserViewUri.forId(generateUuid()),
			options: { viewState: { url: target.uri.toString(true) } },
		});
		if (!(editor instanceof BrowserEditorInput)) {
			throw new Error(`Article '${target.articleId}' did not open in a Browser Editor.`);
		}
		const model = await editor.resolve();
		await waitForCommittedDocument(model);
		const documentTarget = await createBrowserDocumentTarget(
			model,
			this.clientToolService.connection,
			localize('browser.articleDocumentTargetLabel', "Article Browser Page"),
		);
		this.chatService.addInteractionTargets(target.chatResource, [documentTarget]);
	}
}

registerSingleton(
	IChatArticleBrowserService,
	DesktopChatArticleBrowserService,
	InstantiationType.Delayed,
);
