import type {
  AgentCompletionRequest,
  AgentCompletionResult,
  AgentJsonSchema,
  AgentMessage,
  AgentMessagePart,
  AgentProviderAdapter,
  AgentToolDescriptor,
  AgentToolResultPart,
} from 'cs/agent/common/protocol';
import { cleanText } from 'cs/base/common/strings';
import type {
  OpenAiCompatibleChatCompletionMessage,
  OpenAiCompatibleChatCompletionRequest,
  OpenAiCompatibleChatCompletionResponse,
  OpenAiCompatibleChatCompletionTool,
  OpenAiCompatibleChatCompletionToolCall,
  ResolvedLlmRequest,
} from 'cs/code/electron-main/llm/llm';
import {
  extractTextContent,
  requestOpenAiCompatibleChatCompletion,
} from 'cs/code/electron-main/llm/llm';

function createToolCallId() {
  return `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractTextParts(parts: AgentMessagePart[]) {
  return parts
    .filter((part): part is Extract<AgentMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter((text) => typeof text === 'string' && text.trim().length > 0);
}

function extractToolCallParts(parts: AgentMessagePart[]) {
  return parts.filter(
    (part): part is Extract<AgentMessagePart, { type: 'tool-call' }> => part.type === 'tool-call',
  );
}

function extractToolResultParts(parts: AgentMessagePart[]) {
  return parts.filter(
    (part): part is AgentToolResultPart => part.type === 'tool-result',
  );
}

function toOpenAiCompatibleParameters(schema?: AgentJsonSchema): Record<string, unknown> {
  if (schema?.type === 'object') {
    return schema;
  }

  if (!schema) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
  }

  return {
    type: 'object',
    properties: {
      value: schema,
    },
    required: ['value'],
    additionalProperties: false,
  };
}

function toOpenAiCompatibleTool(
  tool: AgentToolDescriptor,
): OpenAiCompatibleChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: toOpenAiCompatibleParameters(tool.inputSchema),
    },
  };
}

function serializeToolResultOutput(output: unknown) {
  if (typeof output === 'string') {
    return output;
  }

  return JSON.stringify(output ?? null);
}

function toOpenAiCompatibleToolCalls(parts: AgentMessagePart[]) {
  const toolCalls = extractToolCallParts(parts).map(
    (part): OpenAiCompatibleChatCompletionToolCall => ({
      id: part.toolCallId,
      type: 'function',
      function: {
        name: part.toolName,
        arguments: JSON.stringify(part.input ?? {}),
      },
    }),
  );

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function toOpenAiCompatibleMessages(
  systemPrompt: string,
  messages: AgentMessage[],
): OpenAiCompatibleChatCompletionMessage[] {
  const normalizedMessages: OpenAiCompatibleChatCompletionMessage[] = [];
  const normalizedSystemPrompt = cleanText(systemPrompt);

  if (normalizedSystemPrompt) {
    normalizedMessages.push({
      role: 'system',
      content: normalizedSystemPrompt,
    });
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of extractToolResultParts(message.parts)) {
        normalizedMessages.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: serializeToolResultOutput(part.output),
        });
      }
      continue;
    }

    const textParts = extractTextParts(message.parts);
    const textContent = textParts.join('\n').trim();
    const toolCalls = toOpenAiCompatibleToolCalls(message.parts);

    normalizedMessages.push({
      role: message.role,
      content:
        message.role === 'assistant' && !textContent && toolCalls
          ? null
          : textContent,
      tool_calls: toolCalls,
    });
  }

  return normalizedMessages;
}

function parseToolCallInput(rawArguments: string): unknown {
  const cleanedArguments = cleanText(rawArguments);
  if (!cleanedArguments) {
    return {};
  }

  try {
    return JSON.parse(cleanedArguments) as unknown;
  } catch {
    return {
      raw: rawArguments,
      parseError: true,
    };
  }
}

function mapFinishReason(
  value: string | null | undefined,
): AgentCompletionResult['stopReason'] {
  if (value === 'tool_calls') {
    return 'tool-call';
  }

  if (value === 'stop' || value === 'length' || value === 'content_filter') {
    return 'completed';
  }

  return undefined;
}

function toAgentAssistantMessage(
  response: OpenAiCompatibleChatCompletionResponse,
): AgentCompletionResult {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const parts: AgentMessagePart[] = [];
  const text = extractTextContent(message?.content);

  if (text) {
    parts.push({
      type: 'text',
      text,
    });
  }

  for (const toolCall of message?.tool_calls ?? []) {
    if (!toolCall || toolCall.type !== 'function') {
      continue;
    }

    const toolName = cleanText(toolCall.function?.name);
    if (!toolName) {
      continue;
    }

    parts.push({
      type: 'tool-call',
      toolCallId: cleanText(toolCall.id) || createToolCallId(),
      toolName,
      input: parseToolCallInput(toolCall.function.arguments),
    });
  }

  return {
    message: {
      role: 'assistant',
      parts,
      createdAt: Date.now(),
      id: cleanText(response.id) || undefined,
    },
    stopReason: mapFinishReason(choice?.finish_reason),
    providerMetadata: {
      responseId: cleanText(response.id) || null,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    },
  };
}

export function createOpenAiCompatibleAgentAdapter(
  request: ResolvedLlmRequest,
): AgentProviderAdapter {
  return {
    id: `${request.provider}:${request.model}:openai-compatible-agent`,
    async completeTurn(
      completionRequest: AgentCompletionRequest,
    ): Promise<AgentCompletionResult> {
      const payload: OpenAiCompatibleChatCompletionRequest = {
        model: request.model,
        reasoning_effort: request.reasoningEffort,
        service_tier: request.serviceTier,
        messages: toOpenAiCompatibleMessages(
          completionRequest.systemPrompt,
          completionRequest.messages,
        ),
        tools:
          completionRequest.tools.length > 0
            ? completionRequest.tools.map(toOpenAiCompatibleTool)
            : undefined,
        tool_choice:
          completionRequest.tools.length > 0 ? 'auto' : undefined,
        temperature: 0.2,
        max_tokens: 1200,
      };
      const response =
        await requestOpenAiCompatibleChatCompletion<OpenAiCompatibleChatCompletionResponse>(
          request,
          payload,
          60000,
        );

      return toAgentAssistantMessage(response);
    },
  };
}
