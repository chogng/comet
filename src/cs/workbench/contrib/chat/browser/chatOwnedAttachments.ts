/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { IChatTranscriptSelectionService } from 'cs/workbench/contrib/chat/browser/chatTranscriptSelections';
import {
	createChatImageAttachment,
	createChatSelectionAttachment,
	createChatTextAttachment,
	maximumChatImageAttachmentBytes,
	type ChatImageMediaType,
} from 'cs/workbench/contrib/chat/common/chatService/chatOwnedAttachments';
import {
	maximumPendingChatAttachments,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

function pickImages(): Promise<readonly File[]> {
	return new Promise((resolve, reject) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/png,image/jpeg';
		input.multiple = true;
		const finish = (files: readonly File[]) => {
			input.removeEventListener('change', onChange);
			input.removeEventListener('cancel', onCancel);
			resolve(files);
		};
		const onChange = () => finish(input.files ? [...input.files] : []);
		const onCancel = () => finish([]);
		input.addEventListener('change', onChange, { once: true });
		input.addEventListener('cancel', onCancel, { once: true });
		try {
			input.click();
		} catch (error) {
			input.removeEventListener('change', onChange);
			input.removeEventListener('cancel', onCancel);
			reject(error);
		}
	});
}

function requireImageFileMediaType(file: File): ChatImageMediaType {
	if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
		throw new TypeError(`Image '${file.name}' has unsupported media type '${file.type}'.`);
	}
	return file.type;
}

/** Connects Chat-owned text, image, and transcript-selection sources to the addressed composer. */
export class ChatOwnedAttachmentsContribution extends Disposable {
	constructor(
		@IChatService private readonly chatService: IChatService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
		@IChatTranscriptSelectionService private readonly transcriptSelectionService: IChatTranscriptSelectionService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		this._register(composerSourceService.registerSource({
			id: 'chat.text',
			order: 10,
			icon: 'text',
			getLabel: ui => ui.chatInputAddText,
			addToComposer: async chatResource => {
				const ui = this.getMessages();
				const text = await this.quickInputService.input({
					title: ui.chatInputAddText,
					prompt: ui.chatInputAddTextPrompt,
					ignoreFocusOut: true,
				});
				if (text !== undefined) {
					this.addText(chatResource, ui.chatInputTextAttachmentLabel, text);
				}
			},
		}));
		this._register(composerSourceService.registerSource({
			id: 'chat.image',
			order: 20,
			icon: 'image',
			getLabel: ui => ui.chatInputAddImage,
			addToComposer: async chatResource => this.addImages(chatResource, await pickImages()),
		}));
		this._register(composerSourceService.registerSource({
			id: 'chat.selection',
			order: 30,
			icon: 'quote',
			getLabel: ui => ui.chatInputAddChatSelection,
			addToComposer: async chatResource => {
				const ui = this.getMessages();
				this.addTranscriptSelection(
					chatResource,
					ui.chatInputChatSelectionAttachmentLabel,
					ui.chatInputChatSelectionRequired,
				);
			},
		}));
	}

	addText(chatResource: URI, label: string, text: string): void {
		this.chatService.addPendingAttachments(chatResource, [
			createChatTextAttachment(generateUuid(), label, text),
		]);
	}

	async addImages(chatResource: URI, files: readonly File[]): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const modelReference = this.chatService.acquireModel(chatResource);
		try {
			const pendingCount = modelReference.object.getSnapshot().pendingAttachments.length;
			if (pendingCount + files.length > maximumPendingChatAttachments) {
				throw new RangeError(
					`Chat image selection exceeds the remaining ${maximumPendingChatAttachments - pendingCount} attachment slots.`,
				);
			}
		} finally {
			modelReference.dispose();
		}
		for (const file of files) {
			requireImageFileMediaType(file);
			if (file.size <= 0 || file.size > maximumChatImageAttachmentBytes) {
				throw new RangeError(
					`Image '${file.name}' must contain 1-${maximumChatImageAttachmentBytes} bytes.`,
				);
			}
		}
		const attachments = await Promise.all(files.map(async file => createChatImageAttachment(
			generateUuid(),
			file.name,
			requireImageFileMediaType(file),
			new Uint8Array(await file.arrayBuffer()),
		)));
		this.chatService.addPendingAttachments(chatResource, attachments);
	}

	addTranscriptSelection(chatResource: URI, label: string, missingSelectionMessage: string): void {
		const fragments = this.transcriptSelectionService.getSelection(chatResource);
		if (fragments.length === 0) {
			throw new Error(missingSelectionMessage);
		}
		this.chatService.addPendingAttachments(chatResource, [
			createChatSelectionAttachment(generateUuid(), label, chatResource, fragments),
		]);
	}

	private getMessages() {
		return this.languageService.getLocaleMessages(this.localeService.getLocale());
	}
}
