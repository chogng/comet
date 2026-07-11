import { Verbosity } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { BrowserEditorPaneState } from 'cs/workbench/contrib/browserView/browser/browserEditorPane';

export function createBrowserEditorPaneState(
	input: EditorInput,
	labels: EditorPartLabels,
	browserState?: BrowserEditorPaneState,
): EditorPaneRuntimeState {
	return {
		status: {
			ariaLabel: labels.status.statusbarAriaLabel,
			paneMode: 'browser',
			modeLabel: labels.sourceMode,
			leftItems: [],
			rightItems: [{ id: 'url', label: labels.status.url, value: input.getDescription(Verbosity.LONG) ?? '' }],
		},
		metadata: browserState ? { kind: 'browser', value: browserState } : undefined,
	};
}
