/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AgentMessagePayload,
	ArticleContextInput,
	LlmSettings,
	RunMainAgentTurnPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
	getEffectiveInputTokenLimit,
	getLlmModelByIdForProvider,
} from 'cs/workbench/services/llm/registry';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';

const historyInputTokenShare = 0.5;
const historyBytesPerInputToken = 3;
const maximumArticleContextCount = 60;
const maximumArticleAuthorCount = 256;
const maximumArticleContextBytes = 4 * 1024 * 1024;
const maximumMainAgentWritingContextBytes = 1024 * 1024;
const maximumMainAgentEditorDocumentBytes = 8 * 1024 * 1024;
const maximumMainAgentPayloadBytes = 16 * 1024 * 1024;

const articleContextFieldByteLimits = Object.freeze({
	sourceUrl: 16 * 1024,
	doi: 2 * 1024,
	title: 64 * 1024,
	author: 4 * 1024,
	abstract: 1024 * 1024,
	journalTitle: 64 * 1024,
	publishedAt: 4 * 1024,
});
const articleContextProperties = new Set([
	'sourceUrl',
	'doi',
	'title',
	'authors',
	'abstract',
	'journalTitle',
	'publishedAt',
]);

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function serializedByteLength(value: unknown, description: string): number {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch (error) {
		throw new TypeError(`${description} must be JSON-serializable.`, { cause: error });
	}
	if (serialized === undefined) {
		throw new TypeError(`${description} must have a JSON representation.`);
	}
	return utf8ByteLength(serialized);
}

function assertRequiredString(
	value: unknown,
	description: string,
	maximumBytes: number,
): asserts value is string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError(`${description} must be a non-empty string.`);
	}
	if (utf8ByteLength(value) > maximumBytes) {
		throw new RangeError(`${description} exceeds its ${maximumBytes}-byte limit.`);
	}
}

function assertOptionalString(
	value: unknown,
	description: string,
	maximumBytes: number,
): asserts value is string | undefined {
	if (value === undefined) {
		return;
	}
	assertRequiredString(value, description, maximumBytes);
}

function resolveHistoryByteBudget(settings: LlmSettings): number {
	const route = resolveLlmRoute(settings, 'reasoning');
	const model = getLlmModelByIdForProvider(route.provider, route.model);
	if (!model) {
		throw new Error(`Language model '${route.provider}:${route.model}' has no registered context budget.`);
	}
	const providerSettings = settings.providers[route.provider];
	const inputTokenLimit = getEffectiveInputTokenLimit(
		model,
		providerSettings.useMaxContextWindow === true,
	) ?? model.context_window_tokens;
	if (!inputTokenLimit || !Number.isSafeInteger(inputTokenLimit) || inputTokenLimit <= 0) {
		throw new Error(`Language model '${route.provider}:${route.model}' has no valid input-token limit.`);
	}
	return Math.floor(inputTokenLimit * historyInputTokenShare) * historyBytesPerInputToken;
}

function groupMessagesByUserTurn(
	messages: readonly AgentMessagePayload[],
): readonly (readonly AgentMessagePayload[])[] {
	const turns: AgentMessagePayload[][] = [];
	let currentTurn: AgentMessagePayload[] = [];
	for (const message of messages) {
		if (message.role === 'user' && currentTurn.length > 0) {
			turns.push(currentTurn);
			currentTurn = [];
		}
		currentTurn.push(message);
	}
	if (currentTurn.length > 0) {
		turns.push(currentTurn);
	}
	return turns;
}

function messageArrayByteLength(messages: readonly AgentMessagePayload[]): number {
	if (messages.length === 0) {
		return 2;
	}
	return 2 + messages.reduce((total, message, index) => {
		return total + serializedByteLength(message, 'An agent history message') + (index > 0 ? 1 : 0);
	}, 0);
}

/** Selects the newest complete user turns that fit the resolved model's history budget. */
export function createMainAgentHistoryWindow(
	messages: readonly AgentMessagePayload[],
	settings: LlmSettings,
): AgentMessagePayload[] {
	const budget = resolveHistoryByteBudget(settings);
	const turns = groupMessagesByUserTurn(messages);
	let selectedStart = turns.length;
	let selectedMessageCount = 0;
	let selectedByteLength = 2;
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		const turnByteLength = turn.reduce((total, message, messageIndex) => {
			return total
				+ serializedByteLength(message, 'An agent history message')
				+ (messageIndex > 0 ? 1 : 0);
		}, 0);
		const candidateByteLength = selectedByteLength
			+ turnByteLength
			+ (selectedMessageCount > 0 ? 1 : 0);
		if (candidateByteLength > budget) {
			if (selectedMessageCount === 0) {
				throw new RangeError(`The newest agent history turn exceeds its ${budget}-byte model budget.`);
			}
			break;
		}
		selectedStart = index;
		selectedMessageCount += turn.length;
		selectedByteLength = candidateByteLength;
	}
	return turns.slice(selectedStart).flat();
}

/** Rejects a history payload that does not already fit the resolved model budget. */
export function assertMainAgentHistoryWindow(
	messages: readonly AgentMessagePayload[],
	settings: LlmSettings,
): void {
	const budget = resolveHistoryByteBudget(settings);
	if (messageArrayByteLength(messages) > budget) {
		throw new RangeError(`Agent history exceeds its ${budget}-byte model budget.`);
	}
}

/** Validates every native Article context field and the aggregate serialized size. */
export function assertArticleContexts(
	articleContexts: readonly ArticleContextInput[],
): void {
	if (articleContexts.length > maximumArticleContextCount) {
		throw new RangeError(`Article context count exceeds its limit of ${maximumArticleContextCount}.`);
	}
	articleContexts.forEach((article, articleIndex) => {
		if (!article || typeof article !== 'object' || Array.isArray(article)) {
			throw new TypeError(`Article context ${articleIndex} must be an object.`);
		}
		if (Object.keys(article).some(key => !articleContextProperties.has(key))) {
			throw new TypeError(`Article context ${articleIndex} contains an unsupported property.`);
		}
		assertRequiredString(
			article.sourceUrl,
			`Article context ${articleIndex} sourceUrl`,
			articleContextFieldByteLimits.sourceUrl,
		);
		assertOptionalString(
			article.doi,
			`Article context ${articleIndex} doi`,
			articleContextFieldByteLimits.doi,
		);
		assertRequiredString(
			article.title,
			`Article context ${articleIndex} title`,
			articleContextFieldByteLimits.title,
		);
		if (!Array.isArray(article.authors)) {
			throw new TypeError(`Article context ${articleIndex} authors must be an array.`);
		}
		if (article.authors.length > maximumArticleAuthorCount) {
			throw new RangeError(
				`Article context ${articleIndex} author count exceeds its limit of ${maximumArticleAuthorCount}.`,
			);
		}
		article.authors.forEach((author, authorIndex) => assertRequiredString(
			author,
			`Article context ${articleIndex} author ${authorIndex}`,
			articleContextFieldByteLimits.author,
		));
		assertOptionalString(
			article.abstract,
			`Article context ${articleIndex} abstract`,
			articleContextFieldByteLimits.abstract,
		);
		assertRequiredString(
			article.journalTitle,
			`Article context ${articleIndex} journalTitle`,
			articleContextFieldByteLimits.journalTitle,
		);
		assertOptionalString(
			article.publishedAt,
			`Article context ${articleIndex} publishedAt`,
			articleContextFieldByteLimits.publishedAt,
		);
	});
	if (serializedByteLength(articleContexts, 'Article contexts') > maximumArticleContextBytes) {
		throw new RangeError(`Article contexts exceed their ${maximumArticleContextBytes}-byte aggregate limit.`);
	}
}

/** Validates renderer-to-main payload budgets before native invocation. */
export function assertMainAgentPayloadByteLimits(payload: RunMainAgentTurnPayload): void {
	assertMainAgentHistoryWindow(payload.messages, payload.llm);
	if (payload.writingContext !== null
		&& utf8ByteLength(payload.writingContext) > maximumMainAgentWritingContextBytes) {
		throw new RangeError(
			`Main-agent writing context exceeds its ${maximumMainAgentWritingContextBytes}-byte limit.`,
		);
	}
	if (payload.editorDocument !== null
		&& serializedByteLength(payload.editorDocument, 'The Editor document') > maximumMainAgentEditorDocumentBytes) {
		throw new RangeError(
			`The Editor document exceeds its ${maximumMainAgentEditorDocumentBytes}-byte limit.`,
		);
	}
	assertArticleContexts(payload.articleContexts);
	if (serializedByteLength(payload, 'The main-agent payload') > maximumMainAgentPayloadBytes) {
		throw new RangeError(`The main-agent payload exceeds its ${maximumMainAgentPayloadBytes}-byte limit.`);
	}
}
