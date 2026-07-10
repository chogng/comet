import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { JSDOM } from 'jsdom';

import { URI } from 'cs/base/common/uri';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import type {
  AgentMessagePayload,
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
import type {
  ChatServiceContext,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { locales } from 'language/locales';

let domEnvironment: JSDOM | null = null;

type InvokeCapture = {
  commands: string[];
  payloads: unknown[];
};

before(async () => {
  domEnvironment = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: domEnvironment.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: domEnvironment.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: domEnvironment.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'Event', {
    configurable: true,
    value: domEnvironment.window.Event,
  });
});

after(() => {
  domEnvironment?.window.close();
  domEnvironment = null;
});

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
  overrides: Partial<ChatServiceContext> = {},
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

  const context: ChatServiceContext = {
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(capture),
    ui: locales[locale],
    isKnowledgeBaseModeEnabled: false,
    articles: [] as FetchArticle[],
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

function createChatService(context: ChatServiceContext) {
  const chatService = new ChatService(new NoOpNotificationService());
  chatService.setContext(context);
  return chatService;
}

test('new conversations use the active locale title', () => {
  const assistantModel = createChatService(createAssistantContext('en'));

  const initialSnapshot = assistantModel.getSnapshot();
  assert.equal(initialSnapshot.conversations[0]?.title, 'New chat');

  assistantModel.createConversation();

  const nextSnapshot = assistantModel.getSnapshot();
  assert.equal(nextSnapshot.conversations[1]?.title, 'New chat');
});

test('locale switches update only auto-generated conversation titles', async () => {
  const assistantModel = createChatService(createAssistantContext('zh'));

  assistantModel.createConversation();
  assistantModel.createConversation();

  assistantModel.activateConversation(
    assistantModel.getSnapshot().conversations[1]!.id,
  );
  assistantModel.setQuestion('A custom title from the first question');

  await assistantModel.ask();
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
  const assistantModel = createChatService(createAssistantContext('en', capture));

  assistantModel.setQuestion('What changed in the draft?');
  await assistantModel.ask();

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
  const assistantMessage = snapshot.messages[1];
  assert(assistantMessage?.role === 'assistant');
  assert.equal(assistantMessage.content, 'ok');
  assert.equal(snapshot.result?.llmModel, 'test-model');
});

test('assistant inserts fetched article links without sending them as agent text turns', async () => {
  const capture: InvokeCapture = {
    commands: [],
    payloads: [],
  };
  const assistantModel = createChatService(createAssistantContext('en', capture));
  const articles: FetchArticle[] = [
    {
      sourceUri: URI.parse('https://www.science.org/doi/example').toJSON(),
      title: 'Fetched article',
      doi: '10.1126/example',
      publication: {
        id: 'science',
        title: 'Science',
        publisherId: 'science',
        publisherTitle: 'AAAS',
      },
      articleKind: 'researchArticle',
      sourceArticleType: 'Research Article',
      authors: [{ name: 'Ada Lovelace' }],
      abstract: 'Abstract',
      sections: [{ content: 'Description' }],
      figures: [],
      references: [],
      publishedAt: '2026-07-03',
      fetchedAt: '2026-07-04T00:00:00.000Z',
      fetchOrder: 1,
      articleListSourceId: 'science.current',
    },
    {
      sourceUri: URI.parse('https://www.science.org/doi/example-2').toJSON(),
      title: 'Second fetched article',
      doi: '10.1126/example-2',
      publication: {
        id: 'science',
        title: 'Science',
        publisherId: 'science',
        publisherTitle: 'AAAS',
      },
      articleKind: 'researchArticle',
      sourceArticleType: 'Research Article',
      authors: [{ name: 'Grace Hopper' }],
      abstract: 'Second abstract',
      sections: [{ content: 'Second description' }],
      figures: [],
      references: [],
      publishedAt: '2026-07-04',
      fetchedAt: '2026-07-04T00:00:01.000Z',
      fetchOrder: 2,
      articleListSourceId: 'science.current',
    },
  ];

  assistantModel.insertArticles(
    articles,
    'Science',
  );
  assert.deepEqual(assistantModel.collectArticleBatch(articles), articles);
  assert.deepEqual(assistantModel.collectSelectedArticleBatch(articles), articles);
  assert.equal(
    assistantModel.isArticleSelected('https://www.science.org/doi/example'),
    true,
  );
  assistantModel.toggleArticleSelected('https://www.science.org/doi/example');
  assert.deepEqual(assistantModel.collectSelectedArticleBatch(articles), [
    articles[1],
  ]);
  assistantModel.toggleArticleSelected('https://www.science.org/doi/example');
  assistantModel.setQuestion('Summarize the article.');
  await assistantModel.ask();

  const snapshot = assistantModel.getSnapshot();
  const articlesMessage = snapshot.messages[0];
  assert.equal(articlesMessage?.role, 'assistant');
  assert.equal(
    articlesMessage?.content,
    [
      'Science',
      '- [Fetched article](https://www.science.org/doi/example) - 2026-07-03 | Research Article',
      '- [Second fetched article](https://www.science.org/doi/example-2) - 2026-07-04 | Research Article',
    ].join('\n'),
  );
  assert.equal(articlesMessage?.includeInAgentHistory, false);
  assert.equal(snapshot.messages[1]?.role, 'user');
  assert.deepEqual((capture.payloads[0] as { messages: unknown[] }).messages, [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Summarize the article.' }],
    },
  ]);
});

test('assistant inserts empty article fetch result as markdown without sending it as agent text turn', async () => {
  const capture: InvokeCapture = {
    commands: [],
    payloads: [],
  };
  const assistantModel = createChatService(createAssistantContext('en', capture));

  assistantModel.insertArticleFetchEmptyResult(
    'Nature Photonics',
    'No articles matched the selected date range.',
  );
  assistantModel.setQuestion('What did we fetch?');
  await assistantModel.ask();

  const snapshot = assistantModel.getSnapshot();
  const emptyMessage = snapshot.messages[0];
  assert.equal(emptyMessage?.role, 'assistant');
  assert.equal(
    emptyMessage?.content,
    [
      '> No articles matched the selected date range.',
      '> Nature Photonics',
    ].join('\n'),
  );
  assert.equal(emptyMessage?.includeInAgentHistory, false);
  assert.equal(snapshot.messages[1]?.role, 'user');
  assert.deepEqual((capture.payloads[0] as { messages: unknown[] }).messages, [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'What did we fetch?' }],
    },
  ]);
});

test('assistant inserts context messages into agent text history', async () => {
  const capture: InvokeCapture = {
    commands: [],
    payloads: [],
  };
  const assistantModel = createChatService(createAssistantContext('en', capture));

  assistantModel.insertContextMessage(
    'Browser Console Logs',
    'Attached Console Logs from Integrated Browser\n\n```text\nhello\n```',
  );
  assistantModel.setQuestion('Explain the log.');
  await assistantModel.ask();

  const snapshot = assistantModel.getSnapshot();
  assert.equal(snapshot.messages[0]?.role, 'user');
  assert.equal(
    snapshot.messages[0]?.content,
    'Attached Console Logs from Integrated Browser\n\n```text\nhello\n```',
  );
  assert.equal(snapshot.messages[1]?.role, 'user');
  assert.deepEqual((capture.payloads[0] as { messages: unknown[] }).messages, [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Attached Console Logs from Integrated Browser\n\n```text\nhello\n```' }],
    },
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Explain the log.' }],
    },
  ]);
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
  const assistantModel = createChatService(
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
  await assistantModel.ask();

  const beforeApply = assistantModel.getSnapshot().messages[1];
  assert.equal(beforeApply?.role, 'assistant');
  assert.equal(beforeApply?.patchProposal?.isApplied, false);

  assistantModel.applyPatch(beforeApply!.id);

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
  const assistantModel = createChatService(createAssistantContext('en'));
  let notificationCount = 0;
  const disposeListener = assistantModel.subscribe(() => {
    notificationCount += 1;
  });

  assistantModel.createConversation();
  disposeListener();
  assistantModel.createConversation();

  assert.equal(notificationCount, 1);
});
