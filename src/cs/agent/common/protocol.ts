export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentToolSafety = 'read' | 'write' | 'external';
export type AgentToolSurface = 'renderer' | 'main' | 'shared';
export type AgentStopReason =
  | 'completed'
  | 'tool-call'
  | 'max-steps'
  | 'cancelled';

export type AgentJsonScalar = string | number | boolean | null;

export type AgentJsonSchema =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean' | 'null';
      description?: string;
      enum?: AgentJsonScalar[];
    }
  | {
      type: 'array';
      description?: string;
      items?: AgentJsonSchema;
    }
  | {
      type: 'object';
      description?: string;
      properties?: Record<string, AgentJsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
    };

export type AgentTextPart = {
  type: 'text';
  text: string;
};

export type AgentToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type AgentToolResultPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError?: boolean;
};

export type AgentMessagePart =
  | AgentTextPart
  | AgentToolCallPart
  | AgentToolResultPart;

export type AgentMessage = {
  role: AgentRole;
  parts: AgentMessagePart[];
  id?: string;
  createdAt?: number;
};

export type AgentToolDescriptor = {
  id: string;
  displayName: string;
  description: string;
  surface: AgentToolSurface;
  safety: AgentToolSafety;
  requiresConfirmation?: boolean;
  inputSchema?: AgentJsonSchema;
  tags?: string[];
};

export type AgentToolExecutionContext = {
  callId: string;
  messageId: string;
  step: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type AgentTool = AgentToolDescriptor & {
  execute: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => Promise<unknown>;
};

export type AgentCompletionRequest = {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: AgentToolDescriptor[];
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type AgentCompletionResult = {
  message: AgentMessage;
  stopReason?: AgentStopReason;
  providerMetadata?: Record<string, unknown>;
};

export interface AgentProviderAdapter {
  readonly id: string;

  completeTurn(
    request: AgentCompletionRequest,
  ): Promise<AgentCompletionResult>;
}

export function toAgentToolDescriptor(tool: AgentTool): AgentToolDescriptor {
  return {
    id: tool.id,
    displayName: tool.displayName,
    description: tool.description,
    surface: tool.surface,
    safety: tool.safety,
    requiresConfirmation: tool.requiresConfirmation,
    inputSchema: tool.inputSchema,
    tags: tool.tags ? [...tool.tags] : undefined,
  };
}

export function isAgentTextPart(
  part: AgentMessagePart,
): part is AgentTextPart {
  return part.type === 'text';
}

export function isAgentToolCallPart(
  part: AgentMessagePart,
): part is AgentToolCallPart {
  return part.type === 'tool-call';
}

export function isAgentToolResultPart(
  part: AgentMessagePart,
): part is AgentToolResultPart {
  return part.type === 'tool-result';
}

export function extractAgentText(message: AgentMessage): string {
  return message.parts
    .filter(isAgentTextPart)
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function extractAgentToolCalls(
  message: AgentMessage,
): AgentToolCallPart[] {
  return message.parts.filter(isAgentToolCallPart);
}
