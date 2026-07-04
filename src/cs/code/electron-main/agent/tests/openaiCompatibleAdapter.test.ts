import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAiCompatibleAgentAdapter } from 'cs/code/electron-main/agent/openaiCompatibleAdapter';

const request = {
  provider: 'glm' as const,
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1',
  model: 'glm-4.6',
};

test('openai-compatible agent adapter sends tools and maps tool calls', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  let requestUrl = '';

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;

    return new Response(
      JSON.stringify({
        id: 'resp_1',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'retrieve_evidence',
                    arguments: '{"question":"What changed?"}',
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
  }) as typeof globalThis.fetch;

  try {
    const adapter = createOpenAiCompatibleAgentAdapter(request);
    const result = await adapter.completeTurn({
      systemPrompt: 'Use tools when needed.',
      messages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please gather evidence.',
            },
          ],
        },
      ],
      tools: [
        {
          id: 'retrieve_evidence',
          displayName: 'Retrieve Evidence',
          description: 'Fetch evidence.',
          surface: 'main',
          safety: 'external',
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
              },
            },
            required: ['question'],
            additionalProperties: false,
          },
        },
      ],
    });

    assert.ok(body);
    const requestBody = body as {
      model?: string;
      messages?: Array<{ role: string }>;
      tools?: Array<{ function: { name: string } }>;
    };
    assert.equal(requestUrl, 'https://example.test/v1/chat/completions');
    assert.equal(requestBody.model, 'glm-4.6');
    assert.equal(requestBody.messages?.[0]?.role, 'system');
    assert.equal(requestBody.tools?.[0]?.function.name, 'retrieve_evidence');
    assert.equal(result.stopReason, 'tool-call');
    assert.deepEqual(result.message.parts, [
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'retrieve_evidence',
        input: {
          question: 'What changed?',
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('openai-compatible agent adapter extracts assistant text from content arrays', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: 'resp_2',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'Grounded answer.',
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
    )) as typeof globalThis.fetch;

  try {
    const adapter = createOpenAiCompatibleAgentAdapter(request);
    const result = await adapter.completeTurn({
      systemPrompt: 'Answer directly.',
      messages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Summarize the article.',
            },
          ],
        },
      ],
      tools: [],
    });

    assert.equal(result.stopReason, 'completed');
    assert.deepEqual(result.message.parts, [
      {
        type: 'text',
        text: 'Grounded answer.',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
