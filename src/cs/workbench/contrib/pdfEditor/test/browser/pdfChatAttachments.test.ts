/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import { createPdfSelection } from 'cs/editor/browser/pdf/pdfSelection';
import { createAgentSubmissionId } from 'cs/platform/agentHost/common/identities';
import { ChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import {
	createPdfSelectionAttachment,
	PdfEditorChatAttachmentsContribution,
	PdfSelectionAttachmentProducerType,
} from 'cs/workbench/contrib/pdfEditor/browser/pdfChatAttachments';
import { PdfEditorInput } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import type { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';

const editorService: IEditorService = {
	_serviceBrand: undefined,
	activeEditor: undefined,
	activeEditorPane: undefined,
	openEditor: async () => { throw new Error('not used'); },
	activateEditor: async () => {},
	closeEditor: async () => false,
	getEditors: () => [],
	getActiveGroupId: () => 'group',
};

test('PDF selection producer captures immutable selected text without exposing its source URL', async () => {
	const chatService = new ChatService(createTestChatStorageService());
	const sources = new ChatComposerSourceService();
	const contribution = new PdfEditorChatAttachmentsContribution(chatService, editorService, sources);
	const resource = URI.parse('chat:/pdf-selection');
	const owner = chatService.createModel(resource, { input: 'Explain this selection' });
	try {
		const input = new PdfEditorInput({
			id: 'pdf-document-1',
			title: 'Paper.pdf',
			url: 'file:///private/client/Paper.pdf',
		});
		const selection = createPdfSelection({
			page: 3,
			text: 'Immutable selected claim',
			textRange: { startCharIndex: 10, endCharIndex: 33 },
		});
		const attachment = createPdfSelectionAttachment('pdf-selection-1', input, selection);
		assert.equal(attachment.producerType, PdfSelectionAttachmentProducerType);
		assert.equal(JSON.stringify(attachment).includes('/private/client'), false);
		chatService.addPendingAttachments(resource, [attachment]);

		const prepared = await chatService.prepareSubmission(
			resource,
			createAgentSubmissionId('pdf-submission'),
			CancellationTokenNone,
		);
		assert.deepEqual(prepared.attachments[0].representation.value, {
			documentId: 'pdf-document-1',
			title: 'Paper.pdf',
			text: 'Immutable selected claim',
			ranges: [{
				page: 3,
				startCharIndex: 10,
				endCharIndex: 33,
			}],
		});
		assert.equal(prepared.attachments[0].content?.kind, 'inline');
		assert.equal(prepared.attachments[0].content?.mediaType, 'text/plain');
		assert.deepEqual(sources.getSources().map(source => source.id), ['pdf.selection']);
		await prepared.accept();
	} finally {
		owner.dispose();
		contribution.dispose();
	}
});
