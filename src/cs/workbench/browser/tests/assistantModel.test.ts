import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentMessagePayload,
  Article,
  LlmSettings,
  RagAnswerResult,
  RagSettings,
  RunMainAgentTurnResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type {
  WritingEditorDocument,
  WritingEditorStableSelectionTarget,
} from 'cs/editor/common/writingEditorDocument';
import {
  createAssistantModel,
} from 'cs/workbench/browser/assistantModel';
import type {
  AssistantModelContext,
} from 'cs/workbench/browser/assistantModel';
import { locales } from 'language/locales';

type InvokeCapture = {
  commands: string[];
  payloads: unknown[];
};

function createInvokeDesktop(capture?: InvokeCapture): ElectronInvoke {
  return (async (command: string, args?: Record<string, unknown>) => {
    capture?.commands.push(command);
    capture?.payloads.push(args);

    if (command === 'run_main_agent_turn') {
      return {
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'A custom title from the first question' }],
          },
          {
            role: 'assistant',
            parts: [{ type: 'text', text: 'ok' }],
          },
        ] satisfies AgentMessagePayload[],
        stopReason: 'completed',
        finalText: 'ok',
        llmProvider: 'glm',
        llmModel: 'test-model',
        lastEvidenceResult: {
          answer: 'tool-answer',
          evidence: [],
          provider: 'moark',
          llmProvider: 'glm',
          llmModel: 'test-model',
          embeddingModel: 'test-embedding',
          rerankerModel: 'test-reranker',
          rerankApplied: false,
        } satisfies RagAnswerResult,
        lastPatchProposal: null,
        toolTrace: [],
      } satisfies RunMainAgentTurnResult;
    }

    throw new Error(`Unexpected command: ${command}`);
  }) as ElectronInvoke;
}

function createAssistantContext(
  locale: 'zh' | 'en',
  capture?: InvokeCapture,
  overrides: Partial<AssistantModelContext> = {},
) {
  const document: WritingEditorDocument = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_1',
          textAlign: null,
        },
        content: [{ type: 'text', text: 'Draft paragraph for the agent.' }],
      },
    ],
  };
  const selection: WritingEditorStableSelectionTarget = {
    blockId: 'block_1',
    kind: 'paragraph',
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
    },
    startOffset: 0,
    endOffset: 5,
    selectedText: 'Draft',
    blockText: 'Draft paragraph for the agent.',
    isCollapsed: false,
    isPlainTextEditable: true,
  };

  const context: AssistantModelContext = {
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(capture),
    ui: locales[locale],
    isKnowledgeBaseModeEnabled: false,
    articles: [] as Article[],
    llmSettings: {
      activeProvider: 'glm',
      providers: {
        glm: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'glm:test-model',
        },
        kimi: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'kimi:kimi-test-model',
        },
        deepseek: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'deepseek:deepseek-test-model',
        },
        anthropic: {
          apiKey: '',
          baseUrl: '',
          selectedModelOption: 'anthropic:claude-3-7-sonnet-20250219',
        },
        openai: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'openai:gpt-5',
        },
        gemini: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'gemini:gemini-2.5-flash',
        },
        custom: {
          apiKey: '',
          baseUrl: '',
          selectedModelOption: '',
        },
      },
    } satisfies LlmSettings,
    ragSettings: {
      enabled: true,
      activeProvider: 'moark',
      providers: {
        moark: {
          apiKey: '',
          baseUrl: 'https://example.test',
          embeddingModel: 'test-embedding',
          rerankerModel: 'test-reranker',
          embeddingPath: '/embeddings',
          rerankPath: '/rerank',
        },
      },
      retrievalCandidateCount: 8,
      retrievalTopK: 4,
    } satisfies RagSettings,
    getDraftBody: () => 'Draft paragraph for the agent.',
    getDraftDocument: () => document,
    getActiveDraftStableSelectionTarget: () => selection,
  };

  return {
    ...context,
    ...overrides,
  };
}

test('new conversations use the active locale title', () => {
  const assistantModel = createAssistantModel(createAssistantContext('en'));

  const initialSnapshot = assistantModel.getSnapshot();
  assert.equal(initialSnapshot.conversations[0]?.title, 'New chat');

  assistantModel.handleCreateConversation();

  const nextSnapshot = assistantModel.getSnapshot();
  assert.equal(nextSnapshot.conversations[1]?.title, 'New chat');
});

test('locale switches update only auto-generated conversation titles', async () => {
  const assistantModel = createAssistantModel(createAssistantContext('zh'));

  assistantModel.handleCreateConversation();
  assistantModel.handleCreateConversation();

  assistantModel.handleActivateConversation(
    assistantModel.getSnapshot().conversations[1]!.id,
  );
  assistantModel.setQuestion('A custom title from the first question');

  await assistantModel.handleAsk();
  assert.equal(assistantModel.getSnapshot().conversations[1]?.title, 'A custom title fro');

  assistantModel.setContext(createAssistantContext('en'));

  const snapshot = assistantModel.getSnapshot();
  assert.equal(snapshot.conversations[0]?.title, 'New chat');
  assert.equal(snapshot.conversations[1]?.title, 'A custom title fro');
  assert.equal(snapshot.conversations[2]?.title, 'New chat');
});

test('assistant asks through run_main_agent_turn and stores the returned answer', async () => {
  const capture: InvokeCapture = {
    commands: [],
    payloads: [],
  };
  const assistantModel = createAssistantModel(createAssistantContext('en', capture));

  assistantModel.setQuestion('What changed in the draft?');
  await assistantModel.handleAsk();

  const snapshot = assistantModel.getSnapshot();
  assert.deepEqual(capture.commands, ['run_main_agent_turn']);
  assert.deepEqual(capture.payloads[0], {
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'What changed in the draft?' }],
      },
    ],
    writingContext: null,
    draftBody: 'Draft paragraph for the agent.',
    editorSelection: {
      blockId: 'block_1',
      kind: 'paragraph',
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 6,
      },
      startOffset: 0,
      endOffset: 5,
      selectedText: 'Draft',
      blockText: 'Draft paragraph for the agent.',
      isCollapsed: false,
      isPlainTextEditable: true,
    },
    editorDocument: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: {
            blockId: 'block_1',
            textAlign: null,
          },
          content: [{ type: 'text', text: 'Draft paragraph for the agent.' }],
        },
      ],
    },
    editorTextUnits: [
      {
        blockId: 'block_1',
        kind: 'paragraph',
        text: 'Draft paragraph for the agent.',
        lines: [
          {
            lineNumber: 1,
            startOffset: 0,
            endOffset: 30,
            text: 'Draft paragraph for the agent.',
          },
        ],
      },
    ],
    articles: [],
    llm: {
      activeProvider: 'glm',
      providers: {
        glm: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'glm:test-model',
        },
        kimi: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'kimi:kimi-test-model',
        },
        deepseek: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'deepseek:deepseek-test-model',
        },
        anthropic: {
          apiKey: '',
          baseUrl: '',
          selectedModelOption: 'anthropic:claude-3-7-sonnet-20250219',
        },
        openai: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'openai:gpt-5',
        },
        gemini: {
          apiKey: '',
          baseUrl: 'https://example.test',
          selectedModelOption: 'gemini:gemini-2.5-flash',
        },
        custom: {
          apiKey: '',
          baseUrl: '',
          selectedModelOption: '',
        },
      },
    },
    rag: {
      enabled: true,
      activeProvider: 'moark',
      providers: {
        moark: {
          apiKey: '',
          baseUrl: 'https://example.test',
          embeddingModel: 'test-embedding',
          rerankerModel: 'test-reranker',
          embeddingPath: '/embeddings',
          rerankPath: '/rerank',
        },
      },
      retrievalCandidateCount: 8,
      retrievalTopK: 4,
    },
    availableTools: ['get_selection_context', 'list_text_units', 'apply_editor_patch'],
  });
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages[0]?.role, 'user');
  assert.equal(snapshot.messages[1]?.role, 'assistant');
  assert.equal(snapshot.messages[1]?.content, 'ok');
  assert.equal(snapshot.result?.llmModel, 'test-model');
});

test('assistant applies a pending text patch to the current draft locally', async () => {
  let currentDocument: WritingEditorDocument = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_1',
          textAlign: null,
        },
        content: [{ type: 'text', text: 'Draft paragraph for the agent.' }],
      },
    ],
  };
  const appliedDocuments: WritingEditorDocument[] = [];
  const assistantModel = createAssistantModel(
    createAssistantContext('en', undefined, {
      invokeDesktop: (async (command: string) => {
        if (command !== 'run_main_agent_turn') {
          throw new Error(`Unexpected command: ${command}`);
        }

        return {
          messages: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'Revise the draft sentence.' }],
            },
            {
              role: 'assistant',
              parts: [{ type: 'text', text: 'I prepared a patch for the draft.' }],
            },
          ] satisfies AgentMessagePayload[],
          stopReason: 'completed',
          finalText: 'I prepared a patch for the draft.',
          llmProvider: 'glm',
          llmModel: 'test-model',
          lastEvidenceResult: null,
          lastPatchProposal: {
            patch: {
              label: 'Tighten opening sentence',
              summary: 'Replace the draft sentence with a tighter revision.',
              operations: [
                {
                  kind: 'text-edit',
                  edit: {
                    kind: 'replaceBlock',
                    blockId: 'block_1',
                    expectedText: 'Draft paragraph for the agent.',
                    text: 'Revised paragraph for the agent.',
                  },
                },
              ],
            },
            accepted: true,
            operationsValidated: 1,
            failedOperationIndex: null,
            requiresCustomExecutor: false,
            validationError: null,
          },
          toolTrace: [],
        } satisfies RunMainAgentTurnResult;
      }) as ElectronInvoke,
      getDraftBody: () => 'Draft paragraph for the agent.',
      getDraftDocument: () => currentDocument,
      setDraftDocument: (value) => {
        currentDocument = value;
        appliedDocuments.push(value);
      },
    }),
  );

  assistantModel.setQuestion('Revise the draft sentence.');
  await assistantModel.handleAsk();

  const beforeApply = assistantModel.getSnapshot().messages[1];
  assert.equal(beforeApply?.role, 'assistant');
  assert.equal(beforeApply?.patchProposal?.isApplied, false);

  assistantModel.handleApplyPatch(beforeApply!.id);

  const afterApply = assistantModel.getSnapshot().messages[1];
  assert.equal(afterApply?.role, 'assistant');
  assert.equal(afterApply?.patchProposal?.isApplied, true);
  assert.equal(afterApply?.patchProposal?.applyError, null);
  assert.equal(appliedDocuments.length, 1);
  assert.equal(
    currentDocument.content?.[0]?.content?.[0]?.text,
    'Revised paragraph for the agent.',
  );
});

test('assistant subscriptions stop after disposal', () => {
  const assistantModel = createAssistantModel(createAssistantContext('en'));
  let notificationCount = 0;
  const disposeListener = assistantModel.subscribe(() => {
    notificationCount += 1;
  });

  assistantModel.handleCreateConversation();
  disposeListener();
  assistantModel.handleCreateConversation();

  assert.equal(notificationCount, 1);
});
