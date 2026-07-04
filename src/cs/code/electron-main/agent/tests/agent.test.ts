import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  LlmSettings,
  RagSettings,
  RunMainAgentTurnPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { runMainAgentTurn } from 'cs/code/electron-main/agent/agent';

const llmSettings: LlmSettings = {
  activeProvider: 'glm',
  providers: {
    glm: {
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      selectedModelOption: 'glm:glm-4.6',
    },
    kimi: {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      selectedModelOption: 'kimi:kimi-test-model',
    },
    deepseek: {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      selectedModelOption: 'deepseek:deepseek-test-model',
    },
    anthropic: {
      apiKey: '',
      baseUrl: '',
      selectedModelOption: 'anthropic:claude-3-7-sonnet-20250219',
    },
    openai: {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      selectedModelOption: 'openai:gpt-5',
    },
    gemini: {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      selectedModelOption: 'gemini:gemini-2.5-flash',
    },
    custom: {
      apiKey: '',
      baseUrl: '',
      selectedModelOption: '',
    },
  },
};

const ragSettings: RagSettings = {
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
};

test('runMainAgentTurn returns the last validated patch proposal from apply_editor_patch', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;

    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          id: 'resp_patch_1',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_patch_1',
                    type: 'function',
                    function: {
                      name: 'apply_editor_patch',
                      arguments: JSON.stringify({
                        label: 'Tighten draft sentence',
                        summary: 'Replace the first paragraph with a shorter sentence.',
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
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: 'resp_patch_2',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Patch prepared.',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }) as typeof globalThis.fetch;

  const payload: RunMainAgentTurnPayload = {
    messages: [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Tighten the draft sentence.',
          },
        ],
      },
    ],
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
    availableTools: ['apply_editor_patch'],
    llm: llmSettings,
    rag: ragSettings,
  };

  try {
    const result = await runMainAgentTurn(payload, {
      llm: llmSettings,
      rag: ragSettings,
    });

    assert.equal(result.finalText, 'Patch prepared.');
    assert.deepEqual(result.lastPatchProposal, {
      patch: {
        label: 'Tighten draft sentence',
        summary: 'Replace the first paragraph with a shorter sentence.',
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
    });
    assert.deepEqual(result.toolTrace, [
      {
        step: 0,
        toolName: 'apply_editor_patch',
        isError: false,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
