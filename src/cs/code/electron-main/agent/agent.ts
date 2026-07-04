import type {
  AppSettings,
  Article,
  LlmSettings,
  MainAgentAvailableToolId,
  MainAgentPatchProposal,
  RagAnswerResult,
  RagEvidenceItem,
  RagSettings,
  RunMainAgentTurnPayload,
  RunMainAgentTurnResult,
  WritingEditorDocumentPayload,
  WritingEditorStableSelectionTargetPayload,
  WritingEditorTextUnitPayload,
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
  GetSelectionContextInput,
  GetSelectionContextResult,
  ListTextUnitsInput,
  ListTextUnitsResult,
  RetrieveEvidenceInput,
  RetrieveEvidenceResult,
} from 'cs/agent/common/editorTools';
import { appError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { createOpenAiCompatibleAgentAdapter } from 'cs/code/electron-main/agent/openaiCompatibleAdapter';
import {
  applyWritingEditorEdit,
} from 'cs/editor/common/writingEditorDocument';
import type {
  WritingEditorStableEditTarget,
} from 'cs/editor/common/writingEditorDocument';
import { resolveLlmRequestFromPayload } from 'cs/code/electron-main/llm/llm';
import { answerQuestionFromArticles } from 'cs/code/electron-main/rag/rag';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';

const defaultMainAgentSystemPrompt = [
  'You are the Comet Studio assistant.',
  'When the user is asking about the current draft, inspect the selection context or text units before answering instead of guessing.',
  'Use available tools when the answer depends on evidence from the provided literature context.',
  'When the user wants a draft edit, inspect text units first and propose a precise patch instead of claiming the edit is already applied.',
  'Prefer plain text-edit operations in apply_editor_patch. Structured insert operations may require a custom executor and will not auto-apply.',
  'If evidence is insufficient, say so plainly.',
  'Do not claim to have edited the document or changed application state unless a tool result explicitly confirms it.',
].join(' ');

const defaultMainAgentTools: MainAgentAvailableToolId[] = [
  'get_selection_context',
  'list_text_units',
  'apply_editor_patch',
  'retrieve_evidence',
];
const defaultMaxSteps = 6;

type MainAgentContext = {
  writingContext: string;
  draftBody: string;
  editorSelection: WritingEditorStableSelectionTargetPayload | null;
  editorDocument: WritingEditorDocumentPayload | null;
  editorTextUnits: WritingEditorTextUnitPayload[];
  articles: Article[];
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
    return {
      type: 'text',
      text: part.text,
    };
  }

  if (
    part.type === 'tool-call' &&
    typeof part.toolCallId === 'string' &&
    typeof part.toolName === 'string'
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
    typeof part.toolName === 'string'
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

  const parts = Array.isArray(candidate.parts)
    ? candidate.parts
        .map((part) => normalizeAgentPart(part))
        .filter((part): part is AgentMessagePart => Boolean(part))
    : [];

  if (parts.length === 0) {
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

function createUserTextMessage(text: string): AgentMessage {
  return {
    role: 'user',
    parts: [
      {
        type: 'text',
        text,
      },
    ],
    createdAt: Date.now(),
  };
}

function normalizeMainAgentMessages(
  payload: RunMainAgentTurnPayload,
): AgentMessage[] {
  const normalizedMessages = Array.isArray(payload.messages)
    ? payload.messages
        .map((message) => normalizeAgentMessage(message))
        .filter((message): message is AgentMessage => Boolean(message))
    : [];
  const question = cleanText(payload.question);

  if (question) {
    normalizedMessages.push(createUserTextMessage(question));
  }

  if (normalizedMessages.length === 0) {
    throw appError('UNKNOWN_ERROR', {
      message: 'Main agent turn requires at least one normalized message or question.',
    });
  }

  return normalizedMessages;
}

function normalizeMaxSteps(value: unknown) {
  const candidate = Math.floor(Number(value));
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return defaultMaxSteps;
  }

  return Math.min(candidate, 12);
}

function normalizeAvailableTools(
  value: unknown,
): MainAgentAvailableToolId[] {
  if (!Array.isArray(value)) {
    return [...defaultMainAgentTools];
  }

  const normalized = value.filter(
    (item): item is MainAgentAvailableToolId =>
      item === 'get_selection_context' ||
      item === 'list_text_units' ||
      item === 'apply_editor_patch' ||
      item === 'retrieve_evidence',
  );

  return Array.from(new Set(normalized));
}

function resolveToolArticles(
  allArticles: Article[],
  selectedSourceUrls?: string[],
) {
  if (!Array.isArray(selectedSourceUrls) || selectedSourceUrls.length === 0) {
    return allArticles;
  }

  const selectedUrlSet = new Set(
    selectedSourceUrls
      .map((url) => cleanText(url))
      .filter(Boolean),
  );

  return allArticles.filter((article) => selectedUrlSet.has(cleanText(article.sourceUrl)));
}

function createGetSelectionContextTool(
  context: MainAgentContext,
): AgentTool {
  return {
    id: 'get_selection_context',
    displayName: 'Get Selection Context',
    description:
      'Read the current stable editor selection and draft snapshot for grounded analysis.',
    surface: 'renderer',
    safety: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        includeDocument: {
          type: 'boolean',
        },
      },
      additionalProperties: false,
    },
    tags: ['editor', 'selection'],
    async execute(input: unknown) {
      const normalizedInput =
        input && typeof input === 'object'
          ? (input as Partial<GetSelectionContextInput>)
          : {};

      return {
        selection: context.editorSelection,
        draftBody: context.draftBody,
        document:
          normalizedInput.includeDocument === true
            ? context.editorDocument ?? undefined
            : undefined,
      } satisfies GetSelectionContextResult;
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
      },
      additionalProperties: false,
    },
    tags: ['editor', 'block-id'],
    async execute(input: unknown) {
      const normalizedInput =
        input && typeof input === 'object'
          ? (input as Partial<ListTextUnitsInput>)
          : {};
      const requestedKinds = Array.isArray(normalizedInput.kinds)
        ? new Set(
            normalizedInput.kinds.filter(
              (kind): kind is WritingEditorTextUnitPayload['kind'] =>
                typeof kind === 'string',
            ),
          )
        : null;

      return {
        units:
          requestedKinds && requestedKinds.size > 0
            ? context.editorTextUnits.filter((unit) => requestedKinds.has(unit.kind))
            : context.editorTextUnits,
      } satisfies ListTextUnitsResult;
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
        throw appError('RAG_QUERY_EMPTY');
      }

      const articles = resolveToolArticles(
        context.articles,
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
          articles,
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
  payload: RunMainAgentTurnPayload = {},
  appSettings: Pick<AppSettings, 'llm' | 'rag'>,
): Promise<RunMainAgentTurnResult> {
  const messages = normalizeMainAgentMessages(payload);
  const llmSettings = payload.llm ?? appSettings.llm;
  const ragSettings = payload.rag ?? appSettings.rag;
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
  const tools = createMainAgentTools(
    {
      writingContext: cleanText(payload.writingContext),
      draftBody: cleanText(payload.draftBody),
      editorSelection: payload.editorSelection ?? null,
      editorDocument: payload.editorDocument ?? null,
      editorTextUnits: Array.isArray(payload.editorTextUnits)
        ? payload.editorTextUnits
        : [],
      articles: Array.isArray(payload.articles) ? payload.articles : [],
      llmSettings,
      ragSettings,
    },
    availableTools,
  );
  const result = await runAgentTurn({
    adapter: createOpenAiCompatibleAgentAdapter(request),
    systemPrompt: cleanText(payload.systemPrompt) || defaultMainAgentSystemPrompt,
    messages,
    tools,
    maxSteps: normalizeMaxSteps(payload.maxSteps),
  });

  return {
    messages: result.messages,
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
