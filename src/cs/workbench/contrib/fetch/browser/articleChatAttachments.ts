/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from 'cs/base/common/cancellation';
import { Disposable } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	type AgentAttachmentId,
} from 'cs/platform/agentHost/common/identities';
import {
	IClientContentResourceService,
	type IClientContentPublication,
} from 'cs/platform/agentHost/browser/clientContentResources';
import {
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import {
	ArticleAttachmentContentMediaType,
	ArticleAttachmentProducerStateVersion,
	ArticleAttachmentProducerType,
	ArticleAttachmentRepresentationMediaType,
	ArticleAttachmentRepresentationSchema,
	parseArticleAttachmentProducerState,
	parseArticleAttachmentRepresentation,
	type ArticleAttachmentRepresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatAttachments';
import {
	IFetchService,
	type ArticleDetail,
	type ArticleId,
	type ArticleReadableContent,
} from 'cs/workbench/services/fetch/common/fetch';
import { IArticleChatPresentationState } from 'cs/workbench/contrib/fetch/browser/articleChatPresentations';

const maximumSelectedArticleAttachments = 60;

interface IArticleAttachmentCapture {
	readonly detail: ArticleDetail;
	readonly content: ArticleReadableContent;
	readonly bytes: Uint8Array;
	readonly representation: ArticleAttachmentRepresentation;
}

interface IArticleAttachmentRecord {
	readonly attachment: IPendingChatAttachment;
	readonly chatResource: URI;
	capture?: IArticleAttachmentCapture;
	publication?: IClientContentPublication;
}

function assignOptionalProtocolValue(
	target: Record<string, AgentHostProtocolValue>,
	name: string,
	value: AgentHostProtocolValue | undefined,
): void {
	if (value !== undefined) {
		target[name] = value;
	}
}

function normalizeArticleMetadata(detail: ArticleDetail): ArticleAttachmentRepresentation {
	const publication: Record<string, AgentHostProtocolValue> = {
		title: detail.publication.title,
	};
	assignOptionalProtocolValue(publication, 'journalId', detail.publication.journalId);
	assignOptionalProtocolValue(publication, 'url', detail.publication.url?.toString(true));
	assignOptionalProtocolValue(publication, 'volume', detail.publication.volume);
	assignOptionalProtocolValue(publication, 'issue', detail.publication.issue);
	assignOptionalProtocolValue(publication, 'articleNumber', detail.publication.articleNumber);
	assignOptionalProtocolValue(publication, 'pageRange', detail.publication.pageRange);
	assignOptionalProtocolValue(publication, 'year', detail.publication.year);

	const metadata: Record<string, AgentHostProtocolValue> = {
		articleId: detail.articleId,
		journalId: detail.journalId,
		url: detail.url.toString(true),
		title: detail.title,
		subjects: [...detail.subjects],
		authors: detail.authors.map(author => {
			const normalized: Record<string, AgentHostProtocolValue> = {
				name: author.name,
			};
			assignOptionalProtocolValue(normalized, 'url', author.url?.toString(true));
			assignOptionalProtocolValue(normalized, 'isCorresponding', author.isCorresponding);
			return normalized;
		}),
		publication,
	};
	assignOptionalProtocolValue(metadata, 'doi', detail.doi);
	assignOptionalProtocolValue(metadata, 'description', detail.description);
	assignOptionalProtocolValue(metadata, 'editorsSummary', detail.editorsSummary);
	assignOptionalProtocolValue(metadata, 'abstract', detail.abstract);
	assignOptionalProtocolValue(metadata, 'articleType', detail.articleType);
	assignOptionalProtocolValue(metadata, 'publishedAt', detail.publishedAt);
	assignOptionalProtocolValue(metadata, 'pdfUrl', detail.pdfUrl?.toString(true));
	assignOptionalProtocolValue(metadata, 'citationUrl', detail.citationUrl?.toString(true));
	assignOptionalProtocolValue(metadata, 'isOpenAccess', detail.isOpenAccess);
	return parseArticleAttachmentRepresentation(metadata);
}

function createArticleAttachment(articleId: ArticleId): IPendingChatAttachment {
	return {
		id: createAgentAttachmentId(generateUuid()),
		producerType: ArticleAttachmentProducerType,
		producerStateVersion: ArticleAttachmentProducerStateVersion,
		display: { label: `Article: ${articleId}` },
		state: { articleId },
	};
}

function pendingArticleId(attachment: IPendingChatAttachment): ArticleId | undefined {
	if (attachment.producerType !== ArticleAttachmentProducerType) {
		return undefined;
	}
	if (attachment.producerStateVersion !== ArticleAttachmentProducerStateVersion) {
		throw new Error(
			`Article attachment '${attachment.id}' uses unsupported producer-state version `
			+ `${attachment.producerStateVersion}.`,
		);
	}
	return parseArticleAttachmentProducerState(attachment.state).articleId;
}

function assertRecordMatchesAttachment(
	record: IArticleAttachmentRecord,
	attachment: IPendingChatAttachment,
): void {
	if (
		record.attachment.id !== attachment.id
		|| encodeAgentHostProtocolValue(record.attachment.state)
			!== encodeAgentHostProtocolValue(attachment.state)
	) {
		throw new Error(`Article attachment '${attachment.id}' does not match its owned publication record.`);
	}
}

function assertCaptureIdentity(
	articleId: ArticleId,
	detail: ArticleDetail,
	content: ArticleReadableContent,
): void {
	if (detail.articleId !== articleId || content.articleId !== articleId) {
		throw new Error(`Article '${articleId}' resolved with a mismatched Article identity.`);
	}
	if (!isEqual(detail.url, content.url)) {
		throw new Error(`Article '${articleId}' metadata and readable content resolved from different URLs.`);
	}
	if (detail.title !== content.title) {
		throw new Error(`Article '${articleId}' changed while its attachment was being prepared.`);
	}
	if (content.version !== content.digest) {
		throw new Error(`Article '${articleId}' readable content has an invalid immutable version.`);
	}
	const bytes = new TextEncoder().encode(content.text);
	if (bytes.byteLength !== content.byteLength) {
		throw new Error(`Article '${articleId}' readable content has an invalid byte length.`);
	}
}

class ArticleAttachmentProducer extends Disposable implements IChatAttachmentProducer {
	readonly type = ArticleAttachmentProducerType;
	readonly stateVersion = ArticleAttachmentProducerStateVersion;
	private readonly records = new Map<AgentAttachmentId, IArticleAttachmentRecord>();
	private disposed = false;

	constructor(
		private readonly chatService: IChatService,
		private readonly fetchService: IFetchService,
		private readonly contentService: IClientContentResourceService,
		private readonly presentationState: IArticleChatPresentationState,
	) {
		super();
	}

	validateState(state: AgentHostProtocolValue): void {
		parseArticleAttachmentProducerState(state);
	}

	discard(attachment: IPendingChatAttachment): void {
		const state = parseArticleAttachmentProducerState(attachment.state);
		const record = this.records.get(attachment.id);
		if (!record) {
			return;
		}
		assertRecordMatchesAttachment(record, attachment);
		if (pendingArticleId(record.attachment) !== state.articleId) {
			throw new Error(`Article attachment '${attachment.id}' changed its Article identity.`);
		}
		record.publication?.release();
		this.records.delete(attachment.id);
	}

	async resolve({ chatResource, attachment, token }: Parameters<IChatAttachmentProducer['resolve']>[0]) {
		this.assertActive();
		const state = parseArticleAttachmentProducerState(attachment.state);
		const record = this.records.get(attachment.id);
		if (!record) {
			throw new Error(
				`Exact readable content for restored Article attachment '${attachment.id}' is unavailable; `
				+ 'attach the Article again.',
			);
		}
		assertRecordMatchesAttachment(record, attachment);
		if (!isEqual(record.chatResource, chatResource)) {
			throw new Error(`Article attachment '${attachment.id}' belongs to another Chat.`);
		}

		if (!record.capture) {
			const [detail, content] = await Promise.all([
				this.fetchService.fetchArticle(state.articleId, token),
				this.fetchService.fetchArticleReadableContent(state.articleId, token),
			]);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			assertCaptureIdentity(state.articleId, detail, content);
			record.capture = Object.freeze({
				detail,
				content,
				bytes: new TextEncoder().encode(content.text),
				representation: normalizeArticleMetadata(detail),
			});
		}

		const capture = record.capture;
		if (!record.publication) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const publication = await this.contentService.publishBlob({
				mediaType: ArticleAttachmentContentMediaType,
				bytes: capture.bytes,
			});
			try {
				this.assertActive();
				if (this.records.get(attachment.id) !== record) {
					throw new Error(`Article attachment '${attachment.id}' lost its publication owner.`);
				}
				const published = publication.content;
				if (
					published.owner.kind !== 'client'
					|| published.owner.connection !== this.contentService.connection
					|| published.shape !== 'blob'
					|| published.mediaType !== ArticleAttachmentContentMediaType
					|| published.bounds.byteLength !== capture.content.byteLength
					|| published.version !== capture.content.version
					|| published.digest !== capture.content.digest
				) {
					throw new Error(`Article attachment '${attachment.id}' published a mismatched content version.`);
				}
				record.publication = publication;
			} catch (error) {
				publication.release();
				throw error;
			}
		}

		const publication = record.publication;
		if (
			publication.content.version !== capture.content.version
			|| publication.content.digest !== capture.content.digest
			|| publication.content.bounds.byteLength !== capture.content.byteLength
		) {
			throw new Error(`Article attachment '${attachment.id}' lost its exact staged content version.`);
		}
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: ArticleAttachmentRepresentationSchema,
				mediaType: ArticleAttachmentRepresentationMediaType,
				value: capture.representation,
			},
			content: publication.content,
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	}

	addSelectedArticlesToChat(chatResource: URI): void {
		this.assertActive();
		const reference = this.chatService.acquireModel(chatResource);
		try {
			const snapshot = reference.object.getSnapshot();
			const selectedArticleIds = this.presentationState.getSelectedArticleIds(chatResource);
			if (selectedArticleIds.length === 0) {
				throw new Error(`Chat '${chatResource.toString()}' has no selected Articles to attach.`);
			}
			if (selectedArticleIds.length > maximumSelectedArticleAttachments) {
				throw new RangeError(
					`A Chat submission cannot attach more than ${maximumSelectedArticleAttachments} selected Articles.`,
				);
			}
			const pendingArticleIds = new Set(snapshot.pendingAttachments.flatMap(attachment => {
				const articleId = pendingArticleId(attachment);
				return articleId === undefined ? [] : [articleId];
			}));
			const attachments = selectedArticleIds
				.filter(articleId => !pendingArticleIds.has(articleId))
				.map(articleId => {
					if (!this.fetchService.getArticle(articleId)) {
						throw new Error(`Selected Article '${articleId}' is unavailable.`);
					}
					return createArticleAttachment(articleId);
				});
			if (attachments.length === 0) {
				return;
			}
			for (const attachment of attachments) {
				this.records.set(attachment.id, { attachment, chatResource });
			}
			try {
				this.chatService.addPendingAttachments(chatResource, attachments);
			} catch (error) {
				for (const attachment of attachments) {
					this.records.delete(attachment.id);
				}
				throw error;
			}
		} finally {
			reference.dispose();
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const errors: unknown[] = [];
		for (const record of this.records.values()) {
			try {
				record.publication?.release();
			} catch (error) {
				errors.push(error);
			}
		}
		this.records.clear();
		super.dispose();
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Failed to release Article content publications.');
		}
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error('Article attachment producer is disposed.');
		}
	}
}

/** Registers complete readable Article attachments for the Workbench lifetime. */
export class ArticleChatAttachmentsContribution extends Disposable {
	constructor(
		@IChatService chatService: IChatService,
		@IFetchService fetchService: IFetchService,
		@IClientContentResourceService contentService: IClientContentResourceService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
		@IArticleChatPresentationState presentationState: IArticleChatPresentationState,
	) {
		super();
		const producer = this._register(new ArticleAttachmentProducer(
			chatService,
			fetchService,
			contentService,
			presentationState,
		));
		this._register(chatService.registerAttachmentProducer(producer));
		this._register(composerSourceService.registerSource({
			id: 'article.document',
			order: 130,
			icon: 'file-text',
			getLabel: ui => ui.chatArticleAddSelected,
			addToComposer: async chatResource => producer.addSelectedArticlesToChat(chatResource),
		}));
	}
}
