import type {
  EditorStatusItem,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';

export type StatusbarModeRenderContext = {
  primaryGroupElement: HTMLDivElement;
  secondaryGroupElement: HTMLDivElement;
  createTextElement: (className: string, text: string, title?: string) => HTMLElement;
  createStatusbarItemElement: (item: EditorStatusItem) => HTMLElement;
};

export type StatusbarModeRenderer = (
  status: EditorStatusState,
  context: StatusbarModeRenderContext,
) => void;

