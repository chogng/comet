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
  OpenAiCompatibleResponse,
  OpenAiCompatibleResponseFunctionCall,
  OpenAiCompatibleResponseInputItem,
  OpenAiCompatibleResponseRequest,
  OpenAiCompatibleResponseTool,
  ResolvedLlmRequest,
} from 'cs/code/electron-main/llm/llm';
import {
  extractTextContent,
  requestOpenAiCompatibleResponse,
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

function extractImageParts(parts: AgentMessagePart[]) {
  return parts.filter(
    (part): part is Extract<AgentMessagePart, { type: 'image' }> => part.type === 'image',
  );
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
): OpenAiCompatibleResponseTool {
  return {
    type: 'function',
    name: tool.id,
    description: tool.description,
    parameters: toOpenAiCompatibleParameters(tool.inputSchema),
  };
}

function serializeToolResultOutput(output: unknown) {
  if (typeof output === 'string') {
    return output;
  }

  return JSON.stringify(output ?? null);
}

function toOpenAiCompatibleInputItems(
  systemPrompt: string,
  messages: AgentMessage[],
): { instructions: string | undefined; input: OpenAiCompatibleResponseInputItem[] } {
  const instructions: string[] = [];
  const input: OpenAiCompatibleResponseInputItem[] = [];
  const normalizedSystemPrompt = cleanText(systemPrompt);

  if (normalizedSystemPrompt) {
    instructions.push(normalizedSystemPrompt);
  }

  for (const message of messages) {
    if (message.role === 'system') {
      const textContent = extractTextParts(message.parts).join('\n').trim();
      if (textContent) {
        instructions.push(textContent);
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of extractToolResultParts(message.parts)) {
        input.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: serializeToolResultOutput(part.output),
        });
      }
      continue;
    }

    const textParts = extractTextParts(message.parts);
    const textContent = textParts.join('\n').trim();
    const imageParts = extractImageParts(message.parts);

    if (textContent || imageParts.length > 0) {
      input.push({
        role: message.role,
        content: imageParts.length > 0
          ? [
            ...(textContent ? [{ type: 'input_text' as const, text: textContent }] : []),
            ...imageParts.map(part => ({
              type: 'input_image' as const,
              image_url: `data:${part.mimeType};base64,${part.data}`,
              detail: 'auto' as const,
            })),
          ]
          : textContent,
      });
    }

    for (const part of extractToolCallParts(message.parts)) {
      input.push({
        type: 'function_call',
        call_id: part.toolCallId,
        name: part.toolName,
        arguments: JSON.stringify(part.input ?? {}),
      });
    }
  }

  return {
    instructions: instructions.length > 0 ? instructions.join('\n\n') : undefined,
    input,
  };
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
  response: OpenAiCompatibleResponse,
): AgentCompletionResult['stopReason'] {
  const hasToolCall = response.output?.some((item) => item.type === 'function_call');
  if (hasToolCall) {
    return 'tool-call';
  }

  if (response.status === undefined || response.status === 'completed' || response.status === 'incomplete') {
    return 'completed';
  }

  return undefined;
}

function toAgentAssistantMessage(
  response: OpenAiCompatibleResponse,
): AgentCompletionResult {
  const parts: AgentMessagePart[] = [];
  const messageItems = response.output?.filter((item) => item.type === 'message') ?? [];
  const toolCallItems = response.output?.filter(
    (item): item is OpenAiCompatibleResponseFunctionCall => item.type === 'function_call',
  ) ?? [];
  const text = extractTextContent(
    messageItems.flatMap((item) => (Array.isArray(item.content) ? item.content : [])),
  );

  if (text) {
    parts.push({
      type: 'text',
      text,
    });
  }

  for (const toolCall of toolCallItems) {
    const toolName = cleanText(toolCall.name);
    if (!toolName) {
      continue;
    }

    parts.push({
      type: 'tool-call',
      toolCallId: cleanText(toolCall.call_id) || cleanText(toolCall.id) || createToolCallId(),
      toolName,
      input: parseToolCallInput(toolCall.arguments ?? ''),
    });
  }

  return {
    message: {
      role: 'assistant',
      parts,
      createdAt: Date.now(),
      id: cleanText(response.id) || undefined,
    },
    stopReason: mapFinishReason(response),
    providerMetadata: {
      responseId: cleanText(response.id) || null,
      status: response.status ?? null,
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
      const inputItems = toOpenAiCompatibleInputItems(
        completionRequest.systemPrompt,
        completionRequest.messages,
      );
      const payload: OpenAiCompatibleResponseRequest = {
        model: request.model,
        instructions: inputItems.instructions,
        reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
        service_tier: request.serviceTier,
        input: inputItems.input,
        tools:
          completionRequest.tools.length > 0
            ? completionRequest.tools.map(toOpenAiCompatibleTool)
            : undefined,
        tool_choice:
          completionRequest.tools.length > 0 ? 'auto' : undefined,
        temperature: 0.2,
        max_output_tokens: 1200,
      };
      const response =
        await requestOpenAiCompatibleResponse<OpenAiCompatibleResponse>(
          request,
          payload,
          60000,
          completionRequest.signal,
        );

      return toAgentAssistantMessage(response);
    },
  };
}
