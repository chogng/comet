import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { renderBrowserStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/browser';
import { renderCommonStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/common';
import { renderDraftStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/draft';
import { renderPdfStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/pdf';
import type {
  StatusbarModeRenderContext,
  StatusbarModeRenderer,
} from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';

export type {
  StatusbarModeRenderContext,
  StatusbarModeRenderer,
} from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';

const statusbarModeRenderers: Record<EditorStatusState['paneMode'], StatusbarModeRenderer> = {
  empty: renderCommonStatusbarMode,
  draft: renderDraftStatusbarMode,
  browser: renderBrowserStatusbarMode,
  pdf: renderPdfStatusbarMode,
};

export function renderStatusbarMode(
  status: EditorStatusState,
  context: StatusbarModeRenderContext,
) {
  const modeRenderer = statusbarModeRenderers[status.paneMode] ?? renderCommonStatusbarMode;
  modeRenderer(status, context);
}
