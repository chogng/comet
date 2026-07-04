import type { StatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';
import { renderCommonStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/common';

export const renderDraftStatusbarMode: StatusbarModeRenderer = (status, context) => {
  renderCommonStatusbarMode(status, context);
};
