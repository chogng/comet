import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { renderCommonStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/common';
import { toDisposable } from 'cs/base/common/lifecycle';
import type {
  StatusbarModeRenderContext,
  StatusbarModeRenderer,
} from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';

export type {
	StatusbarModeRenderContext,
	StatusbarModeRenderer,
} from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';

const statusbarModeRenderers = new Map<string, StatusbarModeRenderer>();
statusbarModeRenderers.set('empty', renderCommonStatusbarMode);

export function registerStatusbarModeRenderer(mode: string, renderer: StatusbarModeRenderer) {
	if (statusbarModeRenderers.has(mode)) {
		throw new Error(`Statusbar mode renderer '${mode}' is already registered.`);
	}
	statusbarModeRenderers.set(mode, renderer);
	return toDisposable(() => statusbarModeRenderers.delete(mode));
}

export function renderStatusbarMode(
	status: EditorStatusState,
	context: StatusbarModeRenderContext,
) {
	const modeRenderer = statusbarModeRenderers.get(status.paneMode);
	if (!modeRenderer) {
		throw new Error(`No statusbar mode renderer registered for '${status.paneMode}'.`);
	}
	modeRenderer(status, context);
}
