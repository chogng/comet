import type {
  AgentCompletionResult,
  AgentMessage,
  AgentProviderAdapter,
  AgentStopReason,
  AgentTool,
  AgentToolCallPart,
  AgentToolResultPart,
} from 'cs/agent/common/protocol';
import {
  extractAgentToolCalls,
  toAgentToolDescriptor,
} from 'cs/agent/common/protocol';

const defaultMaxSteps = 6;

export type AgentAssistantStep = {
  kind: 'assistant';
  step: number;
  completion: AgentCompletionResult;
};

export type AgentToolStep = {
  kind: 'tool';
  step: number;
  call: AgentToolCallPart;
  result: AgentToolResultPart;
};

export type AgentRunStep = AgentAssistantStep | AgentToolStep;

export type AgentRunTurnParams = {
  adapter: AgentProviderAdapter;
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ReadonlyArray<AgentTool>;
  maxSteps?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type AgentRunTurnResult = {
  messages: AgentMessage[];
  steps: AgentRunStep[];
  stopReason: AgentStopReason;
  lastAssistantMessage: AgentMessage | null;
  lastProviderMetadata?: Record<string, unknown>;
};

function createToolRegistry(tools: ReadonlyArray<AgentTool>) {
  return new Map(tools.map((tool) => [tool.id, tool] as const));
}

function serializeToolError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function createToolResultMessage(
  part: AgentToolResultPart,
): AgentMessage {
  return {
    role: 'tool',
    parts: [part],
    createdAt: Date.now(),
  };
}

async function executeToolCall(
  call: AgentToolCallPart,
  toolsById: Map<string, AgentTool>,
  step: number,
  signal: AbortSignal | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<AgentToolResultPart> {
  const tool = toolsById.get(call.toolName);
  if (!tool) {
    return {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: {
        error: `Unknown agent tool: ${call.toolName}`,
      },
      isError: true,
    };
  }

  try {
    const output = await tool.execute(call.input, {
      callId: call.toolCallId,
      messageId: call.toolCallId,
      step,
      signal,
      metadata,
    });

    return {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    };
  } catch (error) {
    return {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: {
        error: serializeToolError(error),
      },
      isError: true,
    };
  }
}

export async function runAgentTurn({
  adapter,
  systemPrompt,
  messages,
  tools,
  maxSteps = defaultMaxSteps,
  signal,
  metadata,
}: AgentRunTurnParams): Promise<AgentRunTurnResult> {
  const toolsById = createToolRegistry(tools);
  const transcript = [...messages];
  const steps: AgentRunStep[] = [];
  let lastAssistantMessage: AgentMessage | null = null;
  let lastProviderMetadata: Record<string, unknown> | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      return {
        messages: transcript,
        steps,
        stopReason: 'cancelled',
        lastAssistantMessage,
        lastProviderMetadata,
      };
    }

    const completion = await adapter.completeTurn({
      systemPrompt,
      messages: transcript,
      tools: tools.map(toAgentToolDescriptor),
      signal,
      metadata,
    });
    const assistantMessage = completion.message;

    transcript.push(assistantMessage);
    steps.push({
      kind: 'assistant',
      step,
      completion,
    });
    lastAssistantMessage = assistantMessage;
    lastProviderMetadata = completion.providerMetadata;

    const toolCalls = extractAgentToolCalls(assistantMessage);
    if (toolCalls.length === 0) {
      return {
        messages: transcript,
        steps,
        stopReason: completion.stopReason ?? 'completed',
        lastAssistantMessage,
        lastProviderMetadata,
      };
    }

    for (const call of toolCalls) {
      const result = await executeToolCall(
        call,
        toolsById,
        step,
        signal,
        metadata,
      );
      transcript.push(createToolResultMessage(result));
      steps.push({
        kind: 'tool',
        step,
        call,
        result,
      });
    }
  }

  return {
    messages: transcript,
    steps,
    stopReason: 'max-steps',
    lastAssistantMessage,
    lastProviderMetadata,
  };
}
