import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentCompletionRequest, AgentTool } from 'cs/agent/common/protocol';
import { runAgentTurn } from 'cs/agent/common/runtime';

test('runAgentTurn executes tool calls and feeds tool results back into the transcript', async () => {
  let completionCount = 0;
  const observedRequests: Array<{
    systemPrompt: string;
    messages: AgentCompletionRequest['messages'];
  }> = [];
  const toolCalls: unknown[] = [];
  const adapter = {
    id: 'fake-adapter',
    async completeTurn(request: AgentCompletionRequest) {
      observedRequests.push({
        systemPrompt: request.systemPrompt,
        messages: structuredClone(request.messages),
      });
      completionCount += 1;

      if (completionCount === 1) {
        return {
          message: {
            role: 'assistant' as const,
            parts: [
              {
                type: 'tool-call' as const,
                toolCallId: 'tool-call-1',
                toolName: 'lookup_value',
                input: {
                  question: 'What is the summary?',
                },
              },
            ],
          },
          stopReason: 'tool-call' as const,
        };
      }

      return {
        message: {
          role: 'assistant' as const,
          parts: [
            {
              type: 'text' as const,
              text: 'Final grounded answer.',
            },
          ],
        },
        stopReason: 'completed' as const,
      };
    },
  };
  const tool: AgentTool = {
    id: 'lookup_value',
    displayName: 'Lookup Value',
    description: 'Fetch a synthetic answer.',
    surface: 'main',
    safety: 'read',
    async execute(input) {
      toolCalls.push(input);
      return {
        value: 'grounded evidence',
      };
    },
  };

  const result = await runAgentTurn({
    adapter,
    systemPrompt: 'You are a test assistant.',
    messages: [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Please answer the question.',
          },
        ],
      },
    ],
    tools: [tool],
  });

  assert.equal(result.stopReason, 'completed');
  assert.equal(result.steps.filter((step) => step.kind === 'assistant').length, 2);
  assert.equal(result.steps.filter((step) => step.kind === 'tool').length, 1);
  assert.deepEqual(toolCalls, [{ question: 'What is the summary?' }]);
  assert.equal(observedRequests.length, 2);
  assert.equal(observedRequests[1]?.messages.at(-1)?.role, 'tool');
  assert.equal(result.lastAssistantMessage?.role, 'assistant');
  assert.equal(result.lastAssistantMessage?.parts[0]?.type, 'text');
});
