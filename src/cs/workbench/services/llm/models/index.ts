import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';
import anthropic from 'cs/workbench/services/llm/models/anthropic';
import custom from 'cs/workbench/services/llm/models/custom';
import deepseek from 'cs/workbench/services/llm/models/deepseek';
import gemini from 'cs/workbench/services/llm/models/gemini';
import glm from 'cs/workbench/services/llm/models/glm';
import kimi from 'cs/workbench/services/llm/models/kimi';
import openai from 'cs/workbench/services/llm/models/openai';

const providerModelGroups = [
  glm,
  kimi,
  deepseek,
  anthropic,
  openai,
  gemini,
  custom,
] as const;

export {
  anthropic,
  custom,
  deepseek,
  gemini,
  glm,
  kimi,
  openai,
};

export const llmModels: ReadonlyArray<LlmModelDefinition> = providerModelGroups.flat();
