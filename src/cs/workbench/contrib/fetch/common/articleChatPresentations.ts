/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import {
	createChatPresentationTypeId,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import type {
	ArticleId,
	ArticleListItemId,
} from 'cs/workbench/services/fetch/common/fetch';

export const ArticleListChatPresentationType =
	createChatPresentationTypeId('article.list.v1');
export const ArticleSourceEmptyChatPresentationType =
	createChatPresentationTypeId('article.source-empty.v1');
export const ArticleHistoryChatPresentationType =
	createChatPresentationTypeId('article.history.v1');

export interface IArticleListChatPresentationItem {
	readonly id: ArticleListItemId;
	readonly articleId: ArticleId;
	readonly title: string;
	readonly url: string;
	readonly metadata: string;
}

export interface IArticleListChatPresentation {
	readonly sourceLabel: string;
	readonly items: readonly IArticleListChatPresentationItem[];
}

export interface IArticleSourceEmptyChatPresentation {
	readonly sourceLabel: string;
	readonly message: string;
}

export interface IArticleEvidenceItem {
	readonly rank: number;
	readonly title: string;
	readonly journalTitle: string | null;
	readonly publishedAt: string | null;
	readonly sourceUrl: string;
	readonly score: number | null;
	readonly excerpt: string;
}

export interface IArticleEvidenceResult {
	readonly answer: string;
	readonly evidence: readonly IArticleEvidenceItem[];
	readonly provider: 'moark';
	readonly llmProvider: 'glm' | 'kimi' | 'deepseek' | 'anthropic' | 'openai' | 'gemini' | 'custom';
	readonly llmModel: string;
	readonly embeddingModel: string;
	readonly rerankerModel: string;
	readonly rerankApplied: boolean;
}

export interface IArticleHistoryChatPresentation {
	readonly articleIds: readonly ArticleId[];
	readonly evidenceResult: IArticleEvidenceResult | null;
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
	record: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string,
): void {
	if (Object.keys(record).length !== keys.length
		|| Object.keys(record).some(key => !keys.includes(key))) {
		throw new TypeError(`${label} contains unsupported or missing properties.`);
	}
}

function requireString(
	value: unknown,
	label: string,
	maximumLength: number,
	allowEmpty = false,
): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive integer.`);
	}
	return value;
}

function requireNullableString(value: unknown, label: string, maximumLength: number): string | null {
	return value === null ? null : requireString(value, label, maximumLength, true);
}

function requireNullableNumber(value: unknown, label: string): number | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${label} must be a finite number or null.`);
	}
	return value;
}

function requireCanonicalHttpUrl(value: unknown, label: string): string {
	const serialized = requireString(value, label, 8_192);
	const uri = URI.parse(serialized);
	if ((uri.scheme !== 'http' && uri.scheme !== 'https') || uri.toString(true) !== serialized) {
		throw new TypeError(`${label} must be a canonical HTTP(S) URI.`);
	}
	return serialized;
}

/** Strictly parses one typed Article-list presentation. */
export function parseArticleListChatPresentation(value: unknown): IArticleListChatPresentation {
	const presentation = requireRecord(value, 'Article list presentation');
	requireExactKeys(presentation, ['sourceLabel', 'items'], 'Article list presentation');
	if (!Array.isArray(presentation.items)
		|| presentation.items.length === 0
		|| presentation.items.length > 1_000) {
		throw new TypeError('Article list presentation items must be a bounded non-empty array.');
	}
	const occurrenceIds = new Set<string>();
	const items = presentation.items.map((rawItem, index) => {
		const item = requireRecord(rawItem, `Article list presentation item ${index}`);
		requireExactKeys(item, ['id', 'articleId', 'title', 'url', 'metadata'], `Article list presentation item ${index}`);
		const id = requireString(item.id, `Article list presentation item ${index} ID`, 2_048) as ArticleListItemId;
		if (occurrenceIds.has(id)) {
			throw new TypeError(`Article list presentation contains duplicate item ID '${id}'.`);
		}
		occurrenceIds.add(id);
		return Object.freeze({
			id,
			articleId: requireString(
				item.articleId,
				`Article list presentation item ${index} Article ID`,
				2_048,
			) as ArticleId,
			title: requireString(item.title, `Article list presentation item ${index} title`, 65_536),
			url: requireCanonicalHttpUrl(item.url, `Article list presentation item ${index} URL`),
			metadata: requireString(
				item.metadata,
				`Article list presentation item ${index} metadata`,
				65_536,
				true,
			),
		});
	});
	return Object.freeze({
		sourceLabel: requireString(presentation.sourceLabel, 'Article list source label', 1_024),
		items: Object.freeze(items),
	});
}

/** Strictly parses an Article-source empty result. */
export function parseArticleSourceEmptyChatPresentation(
	value: unknown,
): IArticleSourceEmptyChatPresentation {
	const presentation = requireRecord(value, 'Article source-empty presentation');
	requireExactKeys(presentation, ['sourceLabel', 'message'], 'Article source-empty presentation');
	return Object.freeze({
		sourceLabel: requireString(presentation.sourceLabel, 'Article source-empty label', 1_024),
		message: requireString(presentation.message, 'Article source-empty message', 65_536),
	});
}

function parseEvidenceItem(value: unknown, index: number): IArticleEvidenceItem {
	const item = requireRecord(value, `Article evidence ${index}`);
	requireExactKeys(item, [
		'rank', 'title', 'journalTitle', 'publishedAt', 'sourceUrl', 'score', 'excerpt',
	], `Article evidence ${index}`);
	return Object.freeze({
		rank: requirePositiveInteger(item.rank, `Article evidence ${index} rank`),
		title: requireString(item.title, `Article evidence ${index} title`, 65_536, true),
		journalTitle: requireNullableString(item.journalTitle, `Article evidence ${index} journal title`, 65_536),
		publishedAt: requireNullableString(item.publishedAt, `Article evidence ${index} publication time`, 8_192),
		sourceUrl: requireCanonicalHttpUrl(item.sourceUrl, `Article evidence ${index} source URL`),
		score: requireNullableNumber(item.score, `Article evidence ${index} score`),
		excerpt: requireString(item.excerpt, `Article evidence ${index} excerpt`, 4 * 1024 * 1024, true),
	});
}

function parseEvidenceResult(value: unknown): IArticleEvidenceResult {
	const result = requireRecord(value, 'Article evidence result');
	requireExactKeys(result, [
		'answer', 'evidence', 'provider', 'llmProvider', 'llmModel',
		'embeddingModel', 'rerankerModel', 'rerankApplied',
	], 'Article evidence result');
	if (!Array.isArray(result.evidence) || result.evidence.length > 4_096) {
		throw new TypeError('Article evidence must be a bounded array.');
	}
	if (result.provider !== 'moark') {
		throw new TypeError('Article evidence provider is unsupported.');
	}
	if (result.llmProvider !== 'glm'
		&& result.llmProvider !== 'kimi'
		&& result.llmProvider !== 'deepseek'
		&& result.llmProvider !== 'anthropic'
		&& result.llmProvider !== 'openai'
		&& result.llmProvider !== 'gemini'
		&& result.llmProvider !== 'custom') {
		throw new TypeError('Article evidence LLM provider is unsupported.');
	}
	if (typeof result.rerankApplied !== 'boolean') {
		throw new TypeError('Article evidence rerank state must be boolean.');
	}
	return Object.freeze({
		answer: requireString(result.answer, 'Article evidence answer', 16 * 1024 * 1024, true),
		evidence: Object.freeze(result.evidence.map(parseEvidenceItem)),
		provider: result.provider,
		llmProvider: result.llmProvider,
		llmModel: requireString(result.llmModel, 'Article evidence LLM model', 8_192),
		embeddingModel: requireString(result.embeddingModel, 'Article evidence embedding model', 8_192),
		rerankerModel: requireString(result.rerankerModel, 'Article evidence reranker model', 8_192),
		rerankApplied: result.rerankApplied,
	});
}

/** Strictly parses migrated Article references and evidence. */
export function parseArticleHistoryChatPresentation(value: unknown): IArticleHistoryChatPresentation {
	const presentation = requireRecord(value, 'Article history presentation');
	requireExactKeys(presentation, ['articleIds', 'evidenceResult'], 'Article history presentation');
	if (!Array.isArray(presentation.articleIds) || presentation.articleIds.length > 4_096) {
		throw new TypeError('Article history IDs must be a bounded array.');
	}
	const articleIds = Object.freeze(presentation.articleIds.map((id, index) =>
		requireString(id, `Article history ID ${index}`, 2_048) as ArticleId,
	));
	if (new Set(articleIds).size !== articleIds.length) {
		throw new TypeError('Article history IDs contain duplicates.');
	}
	const evidenceResult = presentation.evidenceResult === null
		? null
		: parseEvidenceResult(presentation.evidenceResult);
	if (articleIds.length === 0 && evidenceResult === null) {
		throw new TypeError('Article history presentation has no content.');
	}
	return Object.freeze({ articleIds, evidenceResult });
}

/** Constructs the one current opaque history value from legacy persisted fields. */
export function createArticleHistoryChatPresentation(
	articleIds: readonly ArticleId[],
	evidenceResult: unknown | null,
): IArticleHistoryChatPresentation {
	return parseArticleHistoryChatPresentation({ articleIds, evidenceResult });
}
