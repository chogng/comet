/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ArticleContextInput,
	LlmSettings,
	MainAgentAvailableToolId,
	MainAgentPatchProposal,
	RagAnswerResult,
	RagEvidenceItem,
	RagSettings,
	RunMainAgentTurnPayload,
	RunMainAgentTurnResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
	AgentMessage,
	AgentMessagePart,
	AgentTool,
} from 'cs/agent/common/protocol';
import {
	runAgentTurn,
} from 'cs/agent/common/runtime';
import { extractAgentText } from 'cs/agent/common/protocol';
import type {
	AgentEditorPatch,
	AgentEditorPatchOperation,
	ApplyEditorPatchInput,
	ApplyEditorPatchResult,
	GetSelectionContextResult,
	ListTextUnitsInput,
	ListTextUnitsResult,
	RetrieveEvidenceInput,
	RetrieveEvidenceResult,
} from 'cs/agent/common/editorTools';
import {
	defaultAgentTextUnitPageLimit,
	maximumAgentTextUnitPageLimit,
} from 'cs/agent/common/editorTools';
import { cleanText } from 'cs/base/common/strings';
import { createOpenAiCompatibleAgentAdapter } from 'cs/code/electron-main/agent/openaiCompatibleAdapter';
import {
	WritingEditorDocumentModel,
	applyWritingEditorEdit,
	collectWritingEditorTextUnits,
	findWritingEditorNodeByBlockId,
	isWritingEditorPlainTextEditableNode,
	parseWritingEditorDocument,
	writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import type {
	WritingEditorDocument,
	WritingEditorStableSelectionTarget,
	WritingEditorStableEditTarget,
	WritingEditorTextUnit,
	WritingEditorTextUnitKind,
} from 'cs/editor/common/writingEditorDocument';
import { resolveLlmRequestFromPayload } from 'cs/code/electron-main/llm/llm';
import { answerQuestionFromArticles } from 'cs/code/electron-main/rag/rag';
import { RagErrorCode, ragError } from 'cs/workbench/services/rag/ragErrors';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';
import {
	assertMainAgentHistoryWindow,
	assertMainAgentPayloadByteLimits,
} from 'cs/workbench/services/llm/mainAgentPayload';
import { parseChatImageAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

const defaultMainAgentSystemPrompt = [
	'You are the Comet Studio assistant.',
	'When the user is asking about the current draft, inspect the selection context or text units before answering instead of guessing.',
	'Use available tools when the answer depends on evidence from the provided literature context.',
	'When the user wants a draft edit, inspect text units first and propose a precise patch instead of claiming the edit is already applied.',
	'Prefer plain text-edit operations in apply_editor_patch. Structured insert operations may require a custom executor and will not auto-apply.',
	'If evidence is insufficient, say so plainly.',
	'Do not claim to have edited the document or changed application state unless a tool result explicitly confirms it.',
].join(' ');

const mainAgentMaxSteps = 6;
const maximumEditorToolOutputBytes = 256 * 1024;
const writingEditorTextUnitKinds = new Set<WritingEditorTextUnitKind>([
	'paragraph',
	'heading1',
	'heading2',
	'heading3',
	'blockquote',
	'figcaption',
]);
const editorTrackedBlockNodeTypes = new Set([
	'paragraph',
	'heading',
	'blockquote',
	'bullet_list',
	'ordered_list',
	'figure',
	'figcaption',
]);

type MainAgentContext = {
	writingContext: string;
	editorSelection: WritingEditorStableSelectionTarget | null;
	editorDocument: WritingEditorDocument | null;
	textUnits: WritingEditorTextUnit[];
	articleContexts: ArticleContextInput[];
	llmSettings: LlmSettings;
	ragSettings: RagSettings;
};

function isAgentRole(value: unknown): value is AgentMessage['role'] {
	return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function normalizeInteger(
	value: unknown,
	minimum?: number,
) {
	const candidate =
		typeof value === 'number' && Number.isFinite(value)
			? Math.floor(value)
			: null;
	if (candidate === null) {
		return null;
	}

	return minimum === undefined ? candidate : Math.max(candidate, minimum);
}

function normalizeOptionalExpectedText(value: unknown) {
	return typeof value === 'string' ? value : undefined;
}

function normalizeTextEditTarget(
	value: unknown,
): WritingEditorStableEditTarget | null {
	if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.blockId !== 'string') {
		return null;
	}

	const blockId = cleanText(value.blockId);
	if (!blockId) {
		return null;
	}

	const expectedText = normalizeOptionalExpectedText(value.expectedText);

	switch (value.kind) {
		case 'replaceBlock':
			return typeof value.text === 'string'
				? {
					kind: 'replaceBlock',
					blockId,
					expectedText,
					text: value.text,
				}
				: null;
		case 'replaceRange': {
			const from = normalizeInteger(value.from, 0);
			const to = normalizeInteger(value.to, 0);
			return typeof value.text === 'string' && from !== null && to !== null
				? {
					kind: 'replaceRange',
					blockId,
					expectedText,
					from,
					to,
					text: value.text,
				}
				: null;
		}
		case 'replaceLine': {
			const line = normalizeInteger(value.line, 1);
			return typeof value.text === 'string' && line !== null
				? {
					kind: 'replaceLine',
					blockId,
					expectedText,
					line,
					text: value.text,
				}
				: null;
		}
		case 'replaceLineRange': {
			const line = normalizeInteger(value.line, 1);
			const fromColumn = normalizeInteger(value.fromColumn, 1);
			const toColumn = normalizeInteger(value.toColumn, 1);
			return typeof value.text === 'string' &&
				line !== null &&
				fromColumn !== null &&
				toColumn !== null
				? {
					kind: 'replaceLineRange',
					blockId,
					expectedText,
					line,
					fromColumn,
					toColumn,
					text: value.text,
				}
				: null;
		}
		case 'replaceMatch': {
			const occurrenceCandidate =
				value.occurrence === undefined
					? undefined
					: normalizeInteger(value.occurrence, 1);
			const occurrence = occurrenceCandidate ?? undefined;
			return typeof value.match === 'string' &&
				typeof value.text === 'string' &&
				(value.occurrence === undefined || occurrenceCandidate !== null)
				? {
					kind: 'replaceMatch',
					blockId,
					expectedText,
					match: value.match,
					...(occurrence === undefined ? {} : { occurrence }),
					text: value.text,
				}
				: null;
		}
		default:
			return null;
	}
}

function normalizeAgentEditorPatchOperation(
	value: unknown,
): AgentEditorPatchOperation | null {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return null;
	}

	switch (value.kind) {
		case 'text-edit': {
			const edit = normalizeTextEditTarget(value.edit);
			return edit
				? {
					kind: 'text-edit',
					edit,
				}
				: null;
		}
		case 'insert-citation':
			return typeof value.anchorBlockId === 'string' &&
				Array.isArray(value.citationIds) &&
				value.citationIds.every((citationId) => typeof citationId === 'string')
				? {
					kind: 'insert-citation',
					anchorBlockId: value.anchorBlockId,
					citationIds: value.citationIds,
				}
				: null;
		case 'insert-figure-ref':
			return typeof value.anchorBlockId === 'string' &&
				typeof value.figureId === 'string'
				? {
					kind: 'insert-figure-ref',
					anchorBlockId: value.anchorBlockId,
					figureId: value.figureId,
				}
				: null;
		default:
			return null;
	}
}

function normalizeAgentEditorPatch(
	value: unknown,
): AgentEditorPatch | null {
	if (!isRecord(value) || typeof value.label !== 'string' || !Array.isArray(value.operations)) {
		return null;
	}

	const label = cleanText(value.label);
	if (!label) {
		return null;
	}

	const operations = value.operations
		.map((operation) => normalizeAgentEditorPatchOperation(operation))
		.filter((operation): operation is AgentEditorPatchOperation => Boolean(operation));

	if (operations.length === 0 || operations.length !== value.operations.length) {
		return null;
	}

	const summary = typeof value.summary === 'string' ? cleanText(value.summary) : '';

	return {
		label,
		summary: summary || undefined,
		operations,
	};
}

function normalizeApplyEditorPatchResult(
	value: unknown,
): Omit<MainAgentPatchProposal, 'patch'> | null {
	if (
		!isRecord(value) ||
		typeof value.accepted !== 'boolean' ||
		typeof value.requiresCustomExecutor !== 'boolean'
	) {
		return null;
	}

	const operationsValidated = normalizeInteger(value.operationsValidated, 0);
	const failedOperationIndex =
		value.failedOperationIndex === null
			? null
			: normalizeInteger(value.failedOperationIndex, 0);
	const validationError =
		typeof value.validationError === 'string' && value.validationError
			? value.validationError
			: null;

	if (
		operationsValidated === null ||
		(value.failedOperationIndex !== null && failedOperationIndex === null)
	) {
		return null;
	}

	return {
		accepted: value.accepted,
		operationsValidated,
		failedOperationIndex,
		requiresCustomExecutor: value.requiresCustomExecutor,
		validationError,
	};
}

function normalizeAgentPart(value: unknown): AgentMessagePart | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const part = value as Partial<AgentMessagePart> & Record<string, unknown>;
	if (part.type === 'text' && typeof part.text === 'string') {
		if (Object.keys(part).some(key => !['type', 'text'].includes(key))) {
			return null;
		}
		return {
			type: 'text',
			text: part.text,
		};
	}

	if (part.type === 'image') {
		if (Object.keys(part).some(key => !['type', 'id', 'name', 'mimeType', 'data'].includes(key))) {
			return null;
		}
		try {
			const attachment = parseChatImageAttachment({
				id: part.id,
				name: part.name,
				mimeType: part.mimeType,
				data: part.data,
			});
			return { type: 'image', ...attachment };
		} catch {
			return null;
		}
	}

	if (
		part.type === 'tool-call' &&
		typeof part.toolCallId === 'string' &&
		part.toolCallId.trim().length > 0 &&
		typeof part.toolName === 'string' &&
		part.toolName.trim().length > 0 &&
		Object.keys(part).every(key => ['type', 'toolCallId', 'toolName', 'input'].includes(key))
	) {
		return {
			type: 'tool-call',
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			input: part.input,
		};
	}

	if (
		part.type === 'tool-result' &&
		typeof part.toolCallId === 'string' &&
		part.toolCallId.trim().length > 0 &&
		typeof part.toolName === 'string' &&
		part.toolName.trim().length > 0 &&
		(part.isError === undefined || typeof part.isError === 'boolean') &&
		Object.keys(part).every(key => ['type', 'toolCallId', 'toolName', 'output', 'isError'].includes(key))
	) {
		return {
			type: 'tool-result',
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			output: part.output,
			isError: part.isError === true,
		};
	}

	return null;
}

function normalizeAgentMessage(value: unknown): AgentMessage | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Partial<AgentMessage> & Record<string, unknown>;
	if (!isAgentRole(candidate.role)) {
		return null;
	}
	if (Object.keys(candidate).some(key => !['role', 'parts', 'id', 'createdAt'].includes(key))) {
		return null;
	}

	if (!Array.isArray(candidate.parts) || candidate.parts.length === 0) {
		return null;
	}
	const normalizedParts = candidate.parts.map(part => normalizeAgentPart(part));
	if (normalizedParts.some(part => part === null)) {
		return null;
	}
	const parts = normalizedParts as AgentMessagePart[];
	if (candidate.role !== 'user' && parts.some(part => part.type === 'image')) {
		return null;
	}
	if ((candidate.id !== undefined && typeof candidate.id !== 'string')
		|| (candidate.createdAt !== undefined
			&& (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)))) {
		return null;
	}

	return {
		role: candidate.role,
		parts,
		id: typeof candidate.id === 'string' ? candidate.id : undefined,
		createdAt:
			typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
				? candidate.createdAt
				: undefined,
	};
}

function normalizeMainAgentMessages(
	payload: RunMainAgentTurnPayload,
): AgentMessage[] {
	if (!Array.isArray(payload.messages)) {
		throw new TypeError('Main-agent messages must be an array.');
	}
	const parsedMessages = payload.messages.map(message => normalizeAgentMessage(message));
	if (parsedMessages.some(message => message === null)) {
		throw new TypeError('Every main-agent history message must match the Agent message schema.');
	}
	const normalizedMessages = parsedMessages as AgentMessage[];
	if (normalizedMessages.length === 0) {
		throw new TypeError('Main-agent messages must contain at least one complete message.');
	}
	assertMainAgentHistoryWindow(normalizedMessages, payload.llm);

	return normalizedMessages;
}

function normalizeAvailableTools(
	value: unknown,
): MainAgentAvailableToolId[] {
	if (!Array.isArray(value)) {
		throw new TypeError('Main-agent availableTools must be an array.');
	}
	if (!value.every(
		(item): item is MainAgentAvailableToolId =>
			item === 'get_selection_context' ||
			item === 'list_text_units' ||
			item === 'apply_editor_patch' ||
			item === 'retrieve_evidence',
	)) {
		throw new TypeError('Main-agent availableTools contains an unsupported tool ID.');
	}
	if (new Set(value).size !== value.length) {
		throw new TypeError('Main-agent availableTools must not contain duplicate tool IDs.');
	}
	return [...value];
}

function assertMainAgentPayloadShape(payload: RunMainAgentTurnPayload): void {
	if (!isRecord(payload)) {
		throw new TypeError('The main-agent payload must be an object.');
	}
	const allowedProperties = new Set([
		'messages',
		'writingContext',
		'editorSelection',
		'editorDocument',
		'articleContexts',
		'llm',
		'rag',
		'availableTools',
	]);
	if (Object.keys(payload).some(key => !allowedProperties.has(key))) {
		throw new TypeError('The main-agent payload contains an unsupported property.');
	}
	if (!Array.isArray(payload.messages)) {
		throw new TypeError('Main-agent messages must be an array.');
	}
	if (!Array.isArray(payload.availableTools)) {
		throw new TypeError('Main-agent availableTools must be an array.');
	}
	if (payload.writingContext !== null && typeof payload.writingContext !== 'string') {
		throw new TypeError('Main-agent writingContext must be a string or null.');
	}
	if (payload.editorDocument !== null
		&& (!isRecord(payload.editorDocument) || Array.isArray(payload.editorDocument))) {
		throw new TypeError('Main-agent editorDocument must be an object or null.');
	}
	if (payload.editorSelection !== null
		&& (!isRecord(payload.editorSelection) || Array.isArray(payload.editorSelection))) {
		throw new TypeError('Main-agent editorSelection must be an object or null.');
	}
	if (!Array.isArray(payload.articleContexts)) {
		throw new TypeError('Main-agent articleContexts must be an array.');
	}
	if (!isRecord(payload.llm) || !isRecord(payload.rag)) {
		throw new TypeError('Main-agent llm and rag settings must be objects.');
	}
}

function validateEditorBlockIds(
	node: WritingEditorDocument,
	blockIds: Set<string>,
): void {
	if (editorTrackedBlockNodeTypes.has(node.type)) {
		const blockId = node.attrs?.blockId;
		if (typeof blockId !== 'string' || !blockId.trim()) {
			throw new TypeError('The main-agent Editor document contains a block without a stable ID.');
		}
		if (blockIds.has(blockId)) {
			throw new TypeError('The main-agent Editor document contains duplicate block IDs.');
		}
		blockIds.add(blockId);
	}
	for (const child of node.content ?? []) {
		validateEditorBlockIds(child, blockIds);
	}
}

function assertIntegerField(
	value: unknown,
	description: string,
	minimum: number,
): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new TypeError(`${description} must be an integer of at least ${minimum}.`);
	}
}

function resolveEditorSelection(
	value: RunMainAgentTurnPayload['editorSelection'],
	document: WritingEditorDocument,
): WritingEditorStableSelectionTarget | null {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)
		|| typeof value.blockId !== 'string'
		|| !value.blockId.trim()
		|| Object.keys(value).some(key => !['blockId', 'startOffset', 'endOffset'].includes(key))) {
		throw new TypeError('The main-agent Editor selection does not match its schema.');
	}
	assertIntegerField(value.startOffset, 'Editor selection startOffset', 0);
	assertIntegerField(value.endOffset, 'Editor selection endOffset', 0);
	if (value.endOffset < value.startOffset) {
		throw new RangeError('The main-agent Editor selection endOffset precedes startOffset.');
	}

	const documentModel = new WritingEditorDocumentModel(document);
	const textModel = documentModel.getTextModel(value.blockId);
	if (!textModel || value.endOffset > textModel.getValue().length) {
		throw new RangeError('The main-agent Editor selection does not address its document text unit.');
	}
	const blockText = textModel.getValue();
	const start = textModel.getPositionAt(value.startOffset);
	const end = textModel.getPositionAt(value.endOffset);
	const node = findWritingEditorNodeByBlockId(document, value.blockId);
	if (!node) {
		throw new TypeError('The main-agent Editor selection does not identify a document node.');
	}

	return {
		blockId: value.blockId,
		kind: textModel.kind,
		range: {
			startLineNumber: start.lineNumber,
			startColumn: start.column,
			endLineNumber: end.lineNumber,
			endColumn: end.column,
		},
		startOffset: value.startOffset,
		endOffset: value.endOffset,
		selectedText: blockText.slice(value.startOffset, value.endOffset),
		blockText,
		isCollapsed: value.startOffset === value.endOffset,
		isPlainTextEditable: isWritingEditorPlainTextEditableNode(node),
	};
}

function resolveEditorContext(payload: RunMainAgentTurnPayload): {
	readonly document: WritingEditorDocument | null;
	readonly selection: WritingEditorStableSelectionTarget | null;
	readonly body: string;
	readonly textUnits: WritingEditorTextUnit[];
} {
	if (payload.editorDocument === null) {
		if (payload.editorSelection !== null) {
			throw new TypeError('A main-agent Editor selection requires an Editor document.');
		}
		return { document: null, selection: null, body: '', textUnits: [] };
	}
	const document = parseWritingEditorDocument(payload.editorDocument);
	const blockIds = new Set<string>();
	validateEditorBlockIds(document, blockIds);
	const textUnits = collectWritingEditorTextUnits(document);
	if (textUnits.some(textUnit => !blockIds.has(textUnit.blockId))) {
		throw new TypeError('The main-agent Editor document contains an untracked text unit.');
	}
	return {
		document,
		selection: resolveEditorSelection(payload.editorSelection, document),
		body: writingEditorDocumentToPlainText(document),
		textUnits,
	};
}

function formatEditorWritingContext(
	body: string,
	selection: WritingEditorStableSelectionTarget | null,
): string {
	if (!selection) {
		return body;
	}
	return [
		'[selection]',
		`blockId: ${selection.blockId}`,
		`kind: ${selection.kind}`,
		`range: ${selection.range.startLineNumber}:${selection.range.startColumn}-`
		+ `${selection.range.endLineNumber}:${selection.range.endColumn}`,
		`offsets: ${selection.startOffset}-${selection.endOffset}`,
		`collapsed: ${selection.isCollapsed ? 'true' : 'false'}`,
		'',
		'[selectedText]',
		selection.selectedText,
		'',
		'[blockText]',
		selection.blockText,
		'',
		'[draft]',
		body,
	].join('\n');
}

function resolveToolArticleContexts(
	articleContexts: ArticleContextInput[],
	selectedSourceUrls?: string[],
) {
	if (!Array.isArray(selectedSourceUrls) || selectedSourceUrls.length === 0) {
		return articleContexts;
	}

	const selectedUrlSet = new Set(
		selectedSourceUrls
			.map((url) => cleanText(url))
			.filter(Boolean),
	);

	return articleContexts.filter(article => selectedUrlSet.has(cleanText(article.sourceUrl)));
}

function assertEditorToolOutputBudget(output: unknown, toolName: string): void {
	const serialized = JSON.stringify(output);
	if (new TextEncoder().encode(serialized).byteLength > maximumEditorToolOutputBytes) {
		throw new RangeError(
			`${toolName} output exceeds its ${maximumEditorToolOutputBytes}-byte limit.`,
		);
	}
}

function createGetSelectionContextTool(
	context: MainAgentContext,
): AgentTool {
	return {
		id: 'get_selection_context',
		displayName: 'Get Selection Context',
		description:
			'Read the current stable editor selection for grounded analysis.',
		surface: 'renderer',
		safety: 'read',
		inputSchema: {
			type: 'object',
			properties: {},
			additionalProperties: false,
		},
		tags: ['editor', 'selection'],
		async execute(input: unknown) {
			if (!isRecord(input) || Object.keys(input).length > 0) {
				throw new TypeError('get_selection_context accepts only an empty object.');
			}
			const selection = context.editorSelection
				? {
					blockId: context.editorSelection.blockId,
					kind: context.editorSelection.kind,
					range: context.editorSelection.range,
					startOffset: context.editorSelection.startOffset,
					endOffset: context.editorSelection.endOffset,
					selectedText: context.editorSelection.selectedText,
					isCollapsed: context.editorSelection.isCollapsed,
					isPlainTextEditable: context.editorSelection.isPlainTextEditable,
				}
				: null;
			const result = { selection } satisfies GetSelectionContextResult;
			assertEditorToolOutputBudget(result, 'get_selection_context');
			return result;
		},
	};
}

function createListTextUnitsTool(
	context: MainAgentContext,
): AgentTool {
	return {
		id: 'list_text_units',
		displayName: 'List Text Units',
		description:
			'List stable block-addressable text units from the current draft.',
		surface: 'renderer',
		safety: 'read',
		inputSchema: {
			type: 'object',
			properties: {
				kinds: {
					type: 'array',
					items: {
						type: 'string',
					},
				},
				cursor: {
					type: 'integer',
					minimum: 0,
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: maximumAgentTextUnitPageLimit,
				},
			},
			additionalProperties: false,
		},
		tags: ['editor', 'block-id'],
		async execute(input: unknown) {
			if (!isRecord(input) || Object.keys(input).some(key => !['kinds', 'cursor', 'limit'].includes(key))) {
				throw new TypeError('list_text_units input must match its declared schema.');
			}
			const normalizedInput = input as ListTextUnitsInput;
			if (normalizedInput.kinds !== undefined
				&& (!Array.isArray(normalizedInput.kinds)
					|| !normalizedInput.kinds.every(kind => writingEditorTextUnitKinds.has(kind)))) {
				throw new TypeError('list_text_units kinds contains an unsupported text-unit kind.');
			}
			const cursor = normalizedInput.cursor ?? 0;
			if (!Number.isSafeInteger(cursor) || cursor < 0) {
				throw new RangeError('list_text_units cursor must be a non-negative integer.');
			}
			const limit = normalizedInput.limit ?? defaultAgentTextUnitPageLimit;
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAgentTextUnitPageLimit) {
				throw new RangeError(
					`list_text_units limit must be an integer from 1 through ${maximumAgentTextUnitPageLimit}.`,
				);
			}
			const requestedKinds = normalizedInput.kinds === undefined
				? undefined
				: new Set(normalizedInput.kinds);
			const matchingUnits = requestedKinds
				? context.textUnits.filter(unit => requestedKinds.has(unit.kind))
				: context.textUnits;
			const units = matchingUnits.slice(cursor, cursor + limit);
			const nextCursor = cursor + units.length < matchingUnits.length
				? cursor + units.length
				: null;
			const result = {
				units,
				nextCursor,
				total: matchingUnits.length,
			} satisfies ListTextUnitsResult;
			assertEditorToolOutputBudget(result, 'list_text_units');
			return result;
		},
	};
}

function createRetrieveEvidenceTool(
	context: MainAgentContext,
): AgentTool {
	return {
		id: 'retrieve_evidence',
		displayName: 'Retrieve Evidence',
		description:
			'Run evidence retrieval over the provided article set and optional writing context before answering.',
		surface: 'main',
		safety: 'external',
		inputSchema: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
				},
				selectedSourceUrls: {
					type: 'array',
					items: {
						type: 'string',
					},
				},
				includeWritingContext: {
					type: 'boolean',
				},
			},
			required: ['question'],
			additionalProperties: false,
		},
		tags: ['rag', 'knowledge-base'],
		async execute(input: unknown) {
			const normalizedInput =
				input && typeof input === 'object'
					? (input as Partial<RetrieveEvidenceInput>)
					: {};
			const question = cleanText(normalizedInput.question);

			if (!question) {
				throw ragError(RagErrorCode.QueryEmpty);
			}

			const articleContexts = resolveToolArticleContexts(
				context.articleContexts,
				Array.isArray(normalizedInput.selectedSourceUrls)
					? normalizedInput.selectedSourceUrls
					: undefined,
			);
			const ragAnswer = await answerQuestionFromArticles(
				{
					question,
					writingContext:
						normalizedInput.includeWritingContext === false
							? null
							: context.writingContext || null,
					articleContexts,
					llm: context.llmSettings,
					rag: context.ragSettings,
				},
				{
					llm: context.llmSettings,
					rag: context.ragSettings,
				},
			);

			return {
				answer: ragAnswer.answer,
				evidenceCount: ragAnswer.evidence.length,
				sourceUrls: ragAnswer.evidence.map((item) => item.sourceUrl),
				evidence: ragAnswer.evidence,
				provider: ragAnswer.provider,
				llmProvider: ragAnswer.llmProvider,
				llmModel: ragAnswer.llmModel,
				embeddingModel: ragAnswer.embeddingModel,
				rerankerModel: ragAnswer.rerankerModel,
				rerankApplied: ragAnswer.rerankApplied,
			} satisfies RetrieveEvidenceResult;
		},
	};
}

function createApplyEditorPatchTool(
	context: MainAgentContext,
): AgentTool {
	return {
		id: 'apply_editor_patch',
		displayName: 'Apply Editor Patch',
		description:
			'Validate a proposed draft patch against the current editor snapshot. Use list_text_units first and prefer text-edit operations.',
		surface: 'renderer',
		safety: 'write',
		requiresConfirmation: true,
		inputSchema: {
			type: 'object',
			properties: {
				label: {
					type: 'string',
				},
				summary: {
					type: 'string',
				},
				operations: {
					type: 'array',
				},
			},
			required: ['label', 'operations'],
			additionalProperties: false,
		},
		tags: ['editor', 'patch'],
		async execute(input: unknown) {
			const patch = normalizeAgentEditorPatch(input as ApplyEditorPatchInput);
			if (!patch) {
				return {
					accepted: false,
					operationsValidated: 0,
					failedOperationIndex: null,
					requiresCustomExecutor: false,
					validationError: 'Patch payload is invalid.',
				} satisfies ApplyEditorPatchResult;
			}

			if (!context.editorDocument) {
				return {
					accepted: false,
					operationsValidated: 0,
					failedOperationIndex: null,
					requiresCustomExecutor: false,
					validationError: 'No editor document snapshot is available for patch validation.',
				} satisfies ApplyEditorPatchResult;
			}

			let nextDocument = context.editorDocument;
			let operationsValidated = 0;

			for (let index = 0; index < patch.operations.length; index += 1) {
				const operation = patch.operations[index]!;
				if (operation.kind !== 'text-edit') {
					return {
						accepted: false,
						operationsValidated,
						failedOperationIndex: index,
						requiresCustomExecutor: true,
						validationError:
							'Patch contains structured editor operations that require a custom executor.',
					} satisfies ApplyEditorPatchResult;
				}

				const result = applyWritingEditorEdit(nextDocument, operation.edit);
				if (!result.ok) {
					return {
						accepted: false,
						operationsValidated,
						failedOperationIndex: index,
						requiresCustomExecutor: false,
						validationError: result.message,
					} satisfies ApplyEditorPatchResult;
				}

				nextDocument = result.document;
				operationsValidated += 1;
			}

			return {
				accepted: true,
				operationsValidated,
				failedOperationIndex: null,
				requiresCustomExecutor: false,
			} satisfies ApplyEditorPatchResult;
		},
	};
}

function createMainAgentTools(
	context: MainAgentContext,
	availableTools: MainAgentAvailableToolId[],
) {
	const tools: AgentTool[] = [];

	if (availableTools.includes('get_selection_context')) {
		tools.push(createGetSelectionContextTool(context));
	}

	if (availableTools.includes('list_text_units')) {
		tools.push(createListTextUnitsTool(context));
	}

	if (availableTools.includes('apply_editor_patch') && context.editorDocument) {
		tools.push(createApplyEditorPatchTool(context));
	}

	if (availableTools.includes('retrieve_evidence')) {
		tools.push(createRetrieveEvidenceTool(context));
	}

	return tools;
}

function isRagEvidenceItem(value: unknown): value is RagEvidenceItem {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const item = value as Partial<RagEvidenceItem>;
	return (
		typeof item.rank === 'number' &&
		typeof item.title === 'string' &&
		(typeof item.journalTitle === 'string' || item.journalTitle === null) &&
		(typeof item.publishedAt === 'string' || item.publishedAt === null) &&
		typeof item.sourceUrl === 'string' &&
		(typeof item.score === 'number' || item.score === null) &&
		typeof item.excerpt === 'string'
	);
}

function normalizeRagAnswerResult(value: unknown): RagAnswerResult | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const result = value as Partial<RagAnswerResult>;
	if (
		typeof result.answer !== 'string' ||
		!Array.isArray(result.evidence) ||
		typeof result.provider !== 'string' ||
		typeof result.llmProvider !== 'string' ||
		typeof result.llmModel !== 'string' ||
		typeof result.embeddingModel !== 'string' ||
		typeof result.rerankerModel !== 'string' ||
		typeof result.rerankApplied !== 'boolean'
	) {
		return null;
	}

	if (!result.evidence.every((item) => isRagEvidenceItem(item))) {
		return null;
	}

	return {
		answer: result.answer,
		evidence: result.evidence,
		provider: result.provider,
		llmProvider: result.llmProvider,
		llmModel: result.llmModel,
		embeddingModel: result.embeddingModel,
		rerankerModel: result.rerankerModel,
		rerankApplied: result.rerankApplied,
	};
}

function extractLastEvidenceResult(
	steps: Awaited<ReturnType<typeof runAgentTurn>>['steps'],
): RagAnswerResult | null {
	const reversedSteps = [...steps].reverse();
	for (const step of reversedSteps) {
		if (
			step.kind !== 'tool' ||
			step.call.toolName !== 'retrieve_evidence' ||
			step.result.isError === true
		) {
			continue;
		}

		const output = step.result.output;
		if (!output || typeof output !== 'object') {
			continue;
		}

		const candidate = output as Partial<{
			answer: unknown;
			evidence: unknown;
			provider: unknown;
			llmProvider: unknown;
			llmModel: unknown;
			embeddingModel: unknown;
			rerankerModel: unknown;
			rerankApplied: unknown;
		}>;
		const normalized = normalizeRagAnswerResult({
			answer: candidate.answer,
			evidence: candidate.evidence,
			provider: candidate.provider,
			llmProvider: candidate.llmProvider,
			llmModel: candidate.llmModel,
			embeddingModel: candidate.embeddingModel,
			rerankerModel: candidate.rerankerModel,
			rerankApplied: candidate.rerankApplied,
		});

		if (normalized) {
			return normalized;
		}
	}

	return null;
}

function extractLastPatchProposal(
	steps: Awaited<ReturnType<typeof runAgentTurn>>['steps'],
): MainAgentPatchProposal | null {
	const reversedSteps = [...steps].reverse();
	for (const step of reversedSteps) {
		if (
			step.kind !== 'tool' ||
			step.call.toolName !== 'apply_editor_patch' ||
			step.result.isError === true
		) {
			continue;
		}

		const patch = normalizeAgentEditorPatch(step.call.input);
		const normalizedResult = normalizeApplyEditorPatchResult(step.result.output);

		if (!patch || !normalizedResult) {
			continue;
		}

		return {
			patch,
			...normalizedResult,
		};
	}

	return null;
}

export async function runMainAgentTurn(
	payload: RunMainAgentTurnPayload,
): Promise<RunMainAgentTurnResult> {
	assertMainAgentPayloadShape(payload);
	assertMainAgentPayloadByteLimits(payload);
	const messages = normalizeMainAgentMessages(payload);
	const llmSettings = payload.llm;
	const ragSettings = payload.rag;
	const llmRoute = resolveLlmRoute(llmSettings, 'reasoning');
	const request = resolveLlmRequestFromPayload({
		provider: llmRoute.provider,
		apiKey: llmRoute.apiKey,
		baseUrl: llmRoute.baseUrl,
		model: llmRoute.model,
		reasoningEffort: llmRoute.reasoningEffort,
		serviceTier: llmRoute.serviceTier,
	});
	const availableTools = normalizeAvailableTools(payload.availableTools);
	const editorContext = resolveEditorContext(payload);
	if (!editorContext.document && availableTools.some(tool =>
		tool === 'get_selection_context'
		|| tool === 'list_text_units'
		|| tool === 'apply_editor_patch')) {
		throw new TypeError('Main-agent Editor tools require an authoritative Editor document.');
	}
	const textWritingContext = cleanText(payload.writingContext);
	const editorWritingContext = editorContext.document
		? formatEditorWritingContext(editorContext.body, editorContext.selection)
		: '';
	const tools = createMainAgentTools(
		{
			writingContext: [textWritingContext, editorWritingContext].filter(Boolean).join('\n\n'),
			editorSelection: editorContext.selection,
			editorDocument: editorContext.document,
			textUnits: editorContext.textUnits,
			articleContexts: [...payload.articleContexts],
			llmSettings,
			ragSettings,
		},
		availableTools,
	);
	const result = await runAgentTurn({
		adapter: createOpenAiCompatibleAgentAdapter(request),
		systemPrompt: defaultMainAgentSystemPrompt,
		messages,
		tools,
		maxSteps: mainAgentMaxSteps,
	});

	return {
		stopReason: result.stopReason,
		finalText: result.lastAssistantMessage
			? extractAgentText(result.lastAssistantMessage)
			: '',
		llmProvider: llmRoute.provider,
		llmModel: llmRoute.model,
		lastEvidenceResult: extractLastEvidenceResult(result.steps),
		lastPatchProposal: extractLastPatchProposal(result.steps),
		toolTrace: result.steps
			.filter((step) => step.kind === 'tool')
			.map((step) => ({
				step: step.step,
				toolName: step.call.toolName,
				isError: step.result.isError === true,
			})),
	};
}
