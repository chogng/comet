export const DEFAULT_EDITOR_GROUP_ID = 'editor-group-default';

export function normalizeEditorGroupId(value: string | null | undefined) {
  const normalizedGroupId = typeof value === 'string' ? value.trim() : '';
  return normalizedGroupId || DEFAULT_EDITOR_GROUP_ID;
}

export function createEditorGroupId(prefix = 'editor-group') {
  const normalizedPrefix = prefix.trim() || 'editor-group';
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${normalizedPrefix}-${Date.now().toString(36)}-${randomPart}`;
}
