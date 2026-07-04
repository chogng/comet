export const EDITOR_FRAME_SLOT_ATTR = 'data-editor-frame-slot' as const;

export const EDITOR_FRAME_SLOTS = {
  topbar: 'topbar',
  toolbar: 'toolbar',
  content: 'content',
} as const;

export type EditorFrameSlot =
  (typeof EDITOR_FRAME_SLOTS)[keyof typeof EDITOR_FRAME_SLOTS];

export function setEditorFrameSlot(element: HTMLElement, slot: EditorFrameSlot) {
  element.dataset.editorFrameSlot = slot;
}

export function getEditorFrameSlot(element: HTMLElement) {
  return element.dataset.editorFrameSlot as EditorFrameSlot | undefined;
}
