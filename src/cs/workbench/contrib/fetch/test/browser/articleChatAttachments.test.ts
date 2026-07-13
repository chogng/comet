/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CancellationError,
	CancellationTokenNone,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import {
	ClientContentResourceService,
	type IClientContentBlobPublication,
} from 'cs/platform/agentHost/browser/clientContentResources';
import type { IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { ChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import { ArticleChatAttachmentsContribution } from 'cs/workbench/contrib/fetch/browser/articleChatAttachments';
import { ArticleChatPresentationState } from 'cs/workbench/contrib/fetch/browser/articleChatPresentations';
import {
	ArticleAttachmentContentMediaType,
	ArticleAttachmentProducerStateVersion,
	ArticleAttachmentProducerType,
	ArticleAttachmentRepresentationMediaType,
	ArticleAttachmentRepresentationSchema,
} from 'cs/workbench/contrib/fetch/common/articleChatAttachments';
import type {
	ArticleDetail,
	ArticleId,
	ArticleReadableContent,
	IFetchService,
} from 'cs/workbench/services/fetch/common/fetch';

const articleId: ArticleId = 'article:test';
const articleUrl = URI.parse('https://example.com/articles/test');
const connection = createAgentHostClientConnectionId('article-content-connection');

function createArticleDetail(id: ArticleId = articleId): ArticleDetail {
	return {
		articleId: id,
		journalId: 'journal:test',
		url: articleUrl,
		doi: '10.1000/test',
		title: 'A strict Article snapshot',
		description: 'Description metadata',
		editorsSummary: 'Editor summary metadata',
		abstract: 'Abstract metadata, not full text.',
		articleType: 'Research Article',
		subjects: ['Architecture'],
		publishedAt: '2026-07-13',
		isOpenAccess: true,
		authors: [{
			name: 'Ada Example',
			url: URI.parse('https://example.com/authors/ada'),
			isCorresponding: true,
		}],
		publication: {
			journalId: 'journal:test',
			title: 'Test Journal',
			url: URI.parse('https://example.com/journal'),
			volume: '12',
			issue: '3',
			articleNumber: '42',
			pageRange: '1-9',
			year: 2026,
		},
		pdfUrl: URI.parse('https://example.com/articles/test.pdf'),
		citationUrl: URI.parse('https://example.com/articles/test.citation'),
	};
}

async function digestText(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function createReadableContent(
	text: string,
	overrides: Partial<ArticleReadableContent> = {},
): Promise<ArticleReadableContent> {
	const digest = await digestText(text);
	return {
		articleId,
		url: articleUrl,
		title: 'A strict Article snapshot',
		text,
		byteLength: new TextEncoder().encode(text).byteLength,
		version: digest,
		digest,
		...overrides,
	};
}

interface IFetchFixture {
	readonly service: IFetchService;
	readonly getDetailCalls: () => number;
	readonly getContentCalls: () => number;
}

function createFetchFixture(options: {
	readonly detail?: (id: ArticleId, token: CancellationToken) => Promise<ArticleDetail>;
	readonly content?: (id: ArticleId, token: CancellationToken) => Promise<ArticleReadableContent>;
}): IFetchFixture {
	let detailCalls = 0;
	let contentCalls = 0;
	const service = {
		_serviceBrand: undefined,
		getArticle: (id: ArticleId) => id === articleId
			? { id: articleId, journalId: 'journal:test', url: articleUrl }
			: undefined,
		fetchArticle: async (id: ArticleId, token: CancellationToken) => {
			detailCalls += 1;
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			return options.detail?.(id, token) ?? createArticleDetail(id);
		},
		fetchArticleReadableContent: async (id: ArticleId, token: CancellationToken) => {
			contentCalls += 1;
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			if (!options.content) {
				throw new Error('Article readable content fixture is unavailable.');
			}
			return options.content(id, token);
		},
	} as unknown as IFetchService;
	return {
		service,
		getDetailCalls: () => detailCalls,
		getContentCalls: () => contentCalls,
	};
}

class CountingContentResourceService extends ClientContentResourceService {
	publishCount = 0;

	override publishBlob(input: IClientContentBlobPublication) {
		this.publishCount += 1;
		return super.publishBlob(input);
	}
}

function createContentService(): CountingContentResourceService {
	return new CountingContentResourceService(connection, {
		maximumBlobBytes: 2 * 1024 * 1024,
		maximumTreeBytes: 2 * 1024 * 1024,
		maximumTreeEntries: 16,
		maximumTreeDepth: 4,
		maximumReadLength: 64 * 1024,
		maximumOpenLeases: 4,
		maximumConcurrentOperations: 2,
		maximumTotalReadBytes: 2 * 1024 * 1024,
		maximumTreePageEntries: 16,
		maximumTreePages: 16,
		maximumLeaseDurationMilliseconds: 60_000,
	});
}

function createChatService(): ChatService {
	return new ChatService(createTestChatStorageService());
}

function requireArticleSource(sources: ChatComposerSourceService) {
	const source = sources.getSources().find(candidate => candidate.id === 'article.document');
	assert(source);
	return source;
}

function contentOpenRequest(
	content: IAgentHostContentReference,
	attachment = createAgentAttachmentId('article-attachment'),
) {
	return {
		session: createAgentSessionId('article-session'),
		chat: createAgentChatId('article-chat'),
		turn: createAgentTurnId('article-turn'),
		attachment,
		content,
		limits: {
			maximumReadLength: content.bounds.maximumReadLength,
			maximumTotalReadBytes: content.bounds.byteLength,
			maximumTreePageEntries: 16,
			maximumTreePages: 16,
			maximumConcurrentOperations: 2,
			deadline: Date.now() + 30_000,
		},
	};
}

function decodeBase64(value: string): string {
	return new TextDecoder().decode(Uint8Array.from(globalThis.atob(value), character => character.charCodeAt(0)));
}

test('Article Feature releases addressed state only when its Chat is permanently deleted', () => {
	const chatService = createChatService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const resource = URI.parse('chat:/article-state-lifecycle');
	const ordinary = chatService.createModel(resource);
	presentationState.setArticleSelected(resource, articleId, true);
	presentationState.addEmptySource(resource, 'Test source', 'No Articles');

	ordinary.dispose();
	assert.deepEqual(presentationState.getSelectedArticleIds(resource), [articleId]);
	assert.equal(presentationState.getPresentations(resource).length, 1);

	const permanent = chatService.createModel(resource);
	permanent.delete();
	assert.deepEqual(presentationState.getSelectedArticleIds(resource), []);
	assert.deepEqual(presentationState.getPresentations(resource), []);
	presentationState.dispose();
});

test('Article attachment publishes complete readable content owned by the exact client connection', async () => {
	const completeBody = [
		'Abstract',
		'Metadata is not the body.',
		'Introduction',
		'The complete first section.',
		'Methods',
		'The complete second section.',
	].join('\n');
	const fetch = createFetchFixture({ content: async () => createReadableContent(completeBody) });
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService,
		fetch.service,
		contentService,
		sources,
		presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-complete'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		assert.equal(presentationState.isArticleSelected(owner.object.resource, articleId), true);
		assert.equal(fetch.getContentCalls(), 0);
		chatService.setInput(owner.object.resource, 'Use this Article');

		const prepared = await chatService.prepareSubmission(
			owner.object.resource,
			createAgentSubmissionId('article-complete-submission'),
			CancellationTokenNone,
		);
		assert.equal(prepared.attachments.length, 1);
		const resolved = prepared.attachments[0];
		assert.equal(resolved.producerType, ArticleAttachmentProducerType);
		assert.equal(resolved.representation.schema, ArticleAttachmentRepresentationSchema);
		assert.equal(resolved.representation.mediaType, ArticleAttachmentRepresentationMediaType);
		assert.deepEqual(resolved.representation.value, {
			articleId,
			journalId: 'journal:test',
			url: 'https://example.com/articles/test',
			title: 'A strict Article snapshot',
			subjects: ['Architecture'],
			authors: [{
				name: 'Ada Example',
				url: 'https://example.com/authors/ada',
				isCorresponding: true,
			}],
			publication: {
				title: 'Test Journal',
				journalId: 'journal:test',
				url: 'https://example.com/journal',
				volume: '12',
				issue: '3',
				articleNumber: '42',
				pageRange: '1-9',
				year: 2026,
			},
			doi: '10.1000/test',
			description: 'Description metadata',
			editorsSummary: 'Editor summary metadata',
			abstract: 'Abstract metadata, not full text.',
			articleType: 'Research Article',
			publishedAt: '2026-07-13',
			pdfUrl: 'https://example.com/articles/test.pdf',
			citationUrl: 'https://example.com/articles/test.citation',
			isOpenAccess: true,
		});
		const content = resolved.content;
		assert(content?.kind === 'reference');
		assert.equal(content.owner.kind, 'client');
		assert.equal(content.owner.kind === 'client' ? content.owner.connection : undefined, connection);
		assert.equal(content.shape, 'blob');
		assert.equal(content.mediaType, ArticleAttachmentContentMediaType);
		assert.equal(content.bounds.byteLength, new TextEncoder().encode(completeBody).byteLength);

		const openRequest = contentOpenRequest(content, resolved.id);
		const anchor = await contentService.open(openRequest, CancellationTokenNone);
		await prepared.accept();
		const lease = await contentService.open(openRequest, CancellationTokenNone);
		const read = await contentService.readBlob({
			lease: lease.lease,
			offset: 0,
			length: content.bounds.maximumReadLength,
		}, CancellationTokenNone);
		assert.equal(decodeBase64(read.data), completeBody);
		await contentService.release(lease.lease, CancellationTokenNone);
		await contentService.release(anchor.lease, CancellationTokenNone);
		await assert.rejects(
			contentService.open(openRequest, CancellationTokenNone),
			/unavailable/,
		);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 0);
		assert.equal(presentationState.isArticleSelected(owner.object.resource, articleId), true);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article preparation retry reuses the exact staged content reference after the source changes', async () => {
	let currentBody = 'First complete body.';
	const fetch = createFetchFixture({ content: async () => createReadableContent(currentBody) });
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-retry'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Use this Article');
		const first = await chatService.prepareSubmission(
			owner.object.resource,
			createAgentSubmissionId('article-retry-1'),
			CancellationTokenNone,
		);
		const firstContent = first.attachments[0].content;
		assert(firstContent?.kind === 'reference');
		await first.reject();

		currentBody = 'Changed complete body that must not replace the staged version.';
		const second = await chatService.prepareSubmission(
			owner.object.resource,
			createAgentSubmissionId('article-retry-2'),
			CancellationTokenNone,
		);
		assert.deepEqual(second.attachments[0].content, firstContent);
		assert.equal(fetch.getDetailCalls(), 1);
		assert.equal(fetch.getContentCalls(), 1);
		assert.equal(contentService.publishCount, 1);
		await second.reject();
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article attachment rejects changed source metadata before publication', async () => {
	const changed = createFetchFixture({
		content: async () => createReadableContent('Complete body.', { title: 'Changed title' }),
	});
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, changed.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-changed'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Keep this prompt');
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-changed-submission'),
				CancellationTokenNone,
			),
			/changed while its attachment was being prepared/,
		);
		assert.equal(contentService.publishCount, 0);
		assert.equal(owner.object.getSnapshot().input, 'Keep this prompt');
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 1);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article producer publishes metadata only after the common representation contract accepts it', async () => {
	const fetch = createFetchFixture({
		detail: async id => {
			const detail = createArticleDetail(id);
			return {
				...detail,
				publication: { ...detail.publication, year: 10_000 },
			};
		},
		content: async () => createReadableContent('Complete body.'),
	});
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-invalid-representation'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Use only canonical metadata');
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-invalid-representation-submission'),
				CancellationTokenNone,
			),
			/Article publication year must be a bounded integer/,
		);
		assert.equal(contentService.publishCount, 0);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 1);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article attachment rejects a mismatched Article identity before publication', async () => {
	const fetch = createFetchFixture({
		content: async () => createReadableContent('Complete body.', { articleId: 'article:different' }),
	});
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-mismatched'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Keep this exact Article identity');
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-mismatched-submission'),
				CancellationTokenNone,
			),
			/mismatched Article identity/,
		);
		assert.equal(contentService.publishCount, 0);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 1);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article attachment rejects bytes that do not match the declared immutable version', async () => {
	const mismatchedDigest = `sha256:${'0'.repeat(64)}`;
	const fetch = createFetchFixture({
		content: async () => createReadableContent('Complete body.', {
			version: mismatchedDigest,
			digest: mismatchedDigest,
		}),
	});
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-version-mismatch'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Use only the declared version');
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-version-mismatch-submission'),
				CancellationTokenNone,
			),
			/published a mismatched content version/,
		);
		assert.equal(contentService.publishCount, 1);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 1);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article attachment never substitutes Abstract metadata when complete readable content is unavailable', async () => {
	const fetch = createFetchFixture({
		content: async () => {
			throw new Error('Complete Article body is unavailable.');
		},
	});
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-no-body'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Do not use the abstract as the body');
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-no-body-submission'),
				CancellationTokenNone,
			),
			/Complete Article body is unavailable/,
		);
		assert.equal(createArticleDetail().abstract, 'Abstract metadata, not full text.');
		assert.equal(contentService.publishCount, 0);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Article attachment fails after its exact staged publication owner is restored without refetching', async () => {
	const fetch = createFetchFixture({ content: async () => createReadableContent('Complete staged body.') });
	const chatService = createChatService();
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	let contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	const owner = chatService.createModel(URI.parse('chat:/article-restored'));
	try {
		presentationState.setArticleSelected(owner.object.resource, articleId, true);
		await requireArticleSource(sources).addToComposer(owner.object.resource);
		chatService.setInput(owner.object.resource, 'Use the exact staged Article');
		const first = await chatService.prepareSubmission(
			owner.object.resource,
			createAgentSubmissionId('article-restored-1'),
			CancellationTokenNone,
		);
		await first.reject();
		contribution.dispose();
		contribution = new ArticleChatAttachmentsContribution(
			chatService, fetch.service, contentService, sources, presentationState,
		);

		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-restored-2'),
				CancellationTokenNone,
			),
			/Exact readable content for restored Article attachment .* is unavailable/,
		);
		assert.equal(fetch.getDetailCalls(), 1);
		assert.equal(fetch.getContentCalls(), 1);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 1);
		chatService.removePendingAttachment(
			owner.object.resource,
			owner.object.getSnapshot().pendingAttachments[0].id,
		);
		assert.equal(owner.object.getSnapshot().pendingAttachments.length, 0);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});

test('Restored Article state uses the current schema but cannot invent a live publication', async () => {
	const fetch = createFetchFixture({ content: async () => createReadableContent('Unreachable body.') });
	const chatService = createChatService();
	const owner = chatService.createModel(URI.parse('chat:/article-unowned'), {
		input: 'Restored prompt',
		pendingAttachments: [{
			id: createAgentAttachmentId('restored-article'),
			producerType: ArticleAttachmentProducerType,
			producerStateVersion: ArticleAttachmentProducerStateVersion,
			display: { label: 'Restored Article' },
			state: { articleId },
		}],
	});
	const contentService = createContentService();
	const sources = new ChatComposerSourceService();
	const presentationState = new ArticleChatPresentationState(chatService);
	const contribution = new ArticleChatAttachmentsContribution(
		chatService, fetch.service, contentService, sources, presentationState,
	);
	try {
		await assert.rejects(
			chatService.prepareSubmission(
				owner.object.resource,
				createAgentSubmissionId('article-unowned-submission'),
				CancellationTokenNone,
			),
			/Exact readable content for restored Article attachment/,
		);
		assert.equal(fetch.getDetailCalls(), 0);
		assert.equal(fetch.getContentCalls(), 0);
	} finally {
		owner.dispose();
		contribution.dispose();
		presentationState.dispose();
	}
});
