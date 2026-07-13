/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	IChatArticleBrowserService,
	assertChatArticleBrowserTarget,
	type IChatArticleBrowserTarget,
} from 'cs/workbench/contrib/browserView/common/chatArticleBrowser';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

/** Opens addressed Chat Article items in the web target's Browser environment. */
export class WebChatArticleBrowserService implements IChatArticleBrowserService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IEditorService private readonly editorService: IEditorService,
	) {}

	async open(target: IChatArticleBrowserTarget): Promise<void> {
		assertChatArticleBrowserTarget(target);
		const chatReference = this.chatService.acquireModel(target.chatResource);
		chatReference.dispose();
		await this.editorService.openEditor({
			resource: BrowserViewUri.forId(generateUuid()),
			options: { viewState: { url: target.uri.toString(true) } },
		});
	}
}

registerSingleton(
	IChatArticleBrowserService,
	WebChatArticleBrowserService,
	InstantiationType.Delayed,
);
