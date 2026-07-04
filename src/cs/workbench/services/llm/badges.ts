import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

export type LlmModelBadge = 'thinking' | 'fast' | 'reasoning' | 'chat' | 'image';

export function getLlmModelBadges(model: LlmModelDefinition): LlmModelBadge[] {
  const badges: LlmModelBadge[] = [];

  if (model.supports_thinking) {
    badges.push('thinking');
  }

  if (Boolean(model.reasoningEfforts?.length) || model.recommendedTasks.includes('reasoning')) {
    badges.push('reasoning');
  }

  if (model.supports_chat !== false) {
    badges.push('chat');
  }

  if (model.supports_image_input) {
    badges.push('image');
  }

  return badges;
}
