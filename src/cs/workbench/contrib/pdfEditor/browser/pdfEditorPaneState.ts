import type { PdfReaderRuntimeStatus } from 'cs/editor/browser/pdf/pdfDocumentReader';
import { Verbosity } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorContentStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';

function createContentStatus(status: PdfReaderRuntimeStatus): EditorContentStatusState | undefined {
	if (status.state === 'idle') {
		return undefined;
	}
	const value = status.detail && status.state === 'error'
		? `${status.message}: ${status.detail}`
		: status.message;
	const hitTest = status.hitTest;
	return {
		message: value,
		detail: status.detail,
		tone: status.state === 'error' ? 'error' : status.state === 'loading' ? 'muted' : 'accent',
		items: hitTest ? [
			{ id: 'pdf-hit-line', label: 'Line', value: `P${hitTest.page} L${hitTest.lineIndex}`, tone: 'muted', title: `${hitTest.lineId}\n${hitTest.text}` },
			{ id: 'pdf-hit-point', label: 'PDF', value: `${Math.round(hitTest.pdfX)},${Math.round(hitTest.pdfY)}`, tone: 'muted', title: `char=${hitTest.charOffset}, deltaY=${hitTest.lineDeltaY.toFixed(2)}` },
		] : undefined,
	};
}

export function createPdfEditorPaneState(
	input: EditorInput,
	labels: EditorPartLabels,
	readerStatus: PdfReaderRuntimeStatus,
): EditorPaneRuntimeState {
	const contentStatus = createContentStatus(readerStatus);
	return {
		status: {
			ariaLabel: labels.status.statusbarAriaLabel,
			paneMode: 'pdf',
			modeLabel: labels.pdfMode,
			leftItems: contentStatus?.message ? [
				{ id: 'content-status', label: labels.pdfMode, value: contentStatus.message, tone: contentStatus.tone, title: contentStatus.detail },
				...(contentStatus.items ?? []),
			] : [],
			rightItems: [{ id: 'url', label: labels.status.url, value: input.getDescription(Verbosity.LONG) ?? '' }],
		},
	};
}
