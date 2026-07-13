/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { URI } from 'cs/base/common/uri';
import { createWritingEditorDocumentFromPlainText } from 'cs/editor/common/writingEditorDocument';
import { LegacyChatMigrationCompanion } from 'cs/code/electron-main/agentHost/legacyChatMigration';
import {
	createAgentHostAuthorityId,
	createAgentSessionTypeId,
} from 'cs/platform/agentHost/common/identities';
import {
	COMET_AGENT_ID,
	COMET_AGENT_PACKAGE_ID,
} from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import { COMET_AGENT_RESUME_SCHEMA } from 'cs/platform/agentHost/node/agents/comet/cometResume';
import { migrateLegacySessionsCatalog } from 'cs/platform/agentHost/node/host/agentHostCatalog';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageLegacyAgentHostCatalogSource,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';
import {
	ApplicationStorageChatPersistenceStore,
} from 'cs/workbench/contrib/chat/common/chatService/chatPersistence';
import {
	ArticleHistoryChatPresentationType,
	parseArticleHistoryChatPresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatPresentations';
import { DraftEditorProposeEditorPatchToolId } from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';
import {
	DraftEditorPatchPresentationType,
	parseDraftEditorPatchPresentationValue,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorChatPresentations';

function toStoredUri(resource: URI) {
	return {
		scheme: resource.scheme,
		authority: resource.authority,
		path: resource.path,
		query: resource.query,
		fragment: resource.fragment,
	};
}

test('legacy migration commits exact Host history and Workbench presentation state before source deletion', async () => {
	const storage = new Storage(new InMemoryStorageDatabase());
	await storage.init();
	try {
		const document = createWritingEditorDocumentFromPlainText('Original draft');
		const blockId = document.content?.[0]?.attrs?.blockId;
		assert.equal(typeof blockId, 'string');
		const serialized = JSON.stringify({
			version: 3,
			sessions: [{
				conversationId: 'legacy-rich',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
				sessionTitle: 'Imported rich state',
				chatTitle: 'Imported Chat',
				status: 'completed',
				workspace: { kind: 'workspace-less' },
				modelId: null,
				chatState: {
					input: 'unsent legacy input',
					errorMessage: null,
					messages: [
						{
							id: 'legacy-turn-rich',
							role: 'user',
							content: 'question',
							imageAttachments: [{
								id: 'legacy-image-rich',
								name: 'image.png',
								mimeType: 'image/png',
								data: 'aA==',
							}],
						},
						{
							id: 'legacy-answer-preface',
							role: 'assistant',
							content: 'preface',
							imageAttachments: [],
						},
						{
							id: 'legacy-answer-rich',
							role: 'assistant',
							content: 'answer',
							imageAttachments: [],
							articleList: { articleIds: ['article-1', 'article-2'] },
							result: {
								answer: 'grounded answer',
								evidence: [],
								provider: 'moark',
								llmProvider: 'openai',
								llmModel: 'gpt-test',
								embeddingModel: 'embedding-test',
								rerankerModel: 'reranker-test',
								rerankApplied: false,
							},
							patchProposal: {
								patch: {
									label: 'Update draft',
									operations: [{
										kind: 'text-edit',
										edit: {
											kind: 'replaceBlock',
											blockId,
											expectedText: 'Original draft',
											text: 'Revised draft',
										},
									}],
								},
								accepted: true,
								operationsValidated: 1,
								failedOperationIndex: null,
								requiresCustomExecutor: false,
								validationError: null,
								target: {
									resource: toStoredUri(URI.from({ scheme: 'draft', path: '/legacy-rich' })),
									document,
								},
								isApplied: false,
								applyError: null,
							},
						},
					],
				},
			}],
		});
		await storage.set('sessions.providers.default', serialized);
		const catalogStore = new ApplicationStorageAgentHostCatalogStore(storage);
		const companion = new LegacyChatMigrationCompanion(
			storage,
			createAgentHostAuthorityId('local'),
		);
		await migrateLegacySessionsCatalog({
			source: new ApplicationStorageLegacyAgentHostCatalogSource(storage),
			store: catalogStore,
			companion,
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			sessionType: createAgentSessionTypeId('comet'),
			resumeSchema: COMET_AGENT_RESUME_SCHEMA,
		});

		assert.equal(storage.get('sessions.providers.default'), undefined);
		const catalog = await catalogStore.read();
		const hostChat = catalog?.sessions[0]?.chats[0]?.state;
		assert.ok(hostChat);
		assert.equal(hostChat.turns[0]?.user.attachments[0]?.content?.kind, 'inline');
		assert.equal(hostChat.turns[0]?.user.interactionTargets.length, 1);
		assert.deepEqual(hostChat.turns[0]?.response.map(part => part.kind), [
			'text',
			'text',
			'toolCall',
			'toolResult',
		]);
		const call = hostChat.turns[0]?.response[2];
		assert.equal(call?.kind, 'toolCall');
		if (call?.kind === 'toolCall') {
			assert.equal(call.tool, DraftEditorProposeEditorPatchToolId);
		}

		const chatState = await new ApplicationStorageChatPersistenceStore(storage).read();
		assert.equal(chatState?.chats.length, 1);
		assert.equal(chatState?.chats[0]?.composer.input, 'unsent legacy input');
		const articlePresentation = chatState?.chats[0]?.presentations.find(
			presentation => presentation.type === ArticleHistoryChatPresentationType,
		);
		assert.deepEqual(
			articlePresentation && {
				session: articlePresentation.session,
				chat: articlePresentation.chat,
				turn: articlePresentation.turn,
				responsePartIndex: articlePresentation.responsePartIndex,
			},
			{
				session: 'legacy-rich',
				chat: 'legacy-rich',
				turn: 'legacy-turn-rich',
				responsePartIndex: 1,
			},
		);
		assert.ok(articlePresentation);
		const articleHistory = parseArticleHistoryChatPresentation(articlePresentation.value);
		assert.deepEqual(articleHistory.articleIds, [
			'article-1',
			'article-2',
		]);
		assert.equal(
			articleHistory.evidenceResult?.answer,
			'grounded answer',
		);
		const patchPresentation = chatState?.chats[0]?.presentations.find(
			presentation => presentation.type === DraftEditorPatchPresentationType,
		);
		assert.ok(patchPresentation);
		const patchValue = parseDraftEditorPatchPresentationValue(patchPresentation.value);
		assert.deepEqual({
			session: patchPresentation.session,
			chat: patchPresentation.chat,
			turn: patchPresentation.turn,
			responsePartIndex: patchPresentation.responsePartIndex,
		}, {
			session: 'legacy-rich',
			chat: 'legacy-rich',
			turn: 'legacy-turn-rich',
			responsePartIndex: 3,
		});
		assert.equal(patchValue.applyState.kind, 'pending');
		assert.equal(patchValue.target.resource, 'comet-draft:/legacy-rich');
		assert.equal(
			chatState?.completedMigrations[0]?.sourceDigest,
			catalog?.completedMigrations[0]?.sourceDigest,
		);
	} finally {
		storage.dispose();
	}
});
