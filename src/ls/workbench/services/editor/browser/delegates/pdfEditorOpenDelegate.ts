import { EMPTY_PDF_TAB_URL } from 'ls/workbench/browser/parts/editor/editorInput';
import { isReusableEmptyPdfTab } from 'ls/workbench/browser/parts/editor/editorTabPolicy';
import type { EditorModel } from 'ls/workbench/browser/parts/editor/editorModel';
import {
  createUnhandledEditorOpenResult,
  type PdfEditorOpenRequest,
} from 'ls/workbench/services/editor/common/editorOpenTypes';
import type { EditorOpenDelegate } from 'ls/workbench/services/editor/browser/editorOpenRegistry';

type PdfEditorOpenModel = Pick<
  EditorModel,
  'activateTab' | 'createPdfTab' | 'getSnapshot'
>;

export function createPdfEditorOpenDelegate(
  model: PdfEditorOpenModel,
): EditorOpenDelegate<PdfEditorOpenRequest> {
  return {
    canOpen(request): request is PdfEditorOpenRequest {
      return request.kind === 'pdf';
    },
    open(request) {
      const normalizedUrl = request.url?.trim() ?? '';
      if (!normalizedUrl) {
        if (request.disposition === 'reveal-or-open') {
          const { activeTab, tabs } = model.getSnapshot();
          const existingEmptyPdfTab = isReusableEmptyPdfTab(activeTab)
            ? activeTab
            : tabs.find((tab) => isReusableEmptyPdfTab(tab)) ?? null;
          if (existingEmptyPdfTab) {
            model.activateTab(existingEmptyPdfTab.id);
            return {
              handled: true,
              activeTabId: existingEmptyPdfTab.id,
            };
          }
        }

        model.createPdfTab(EMPTY_PDF_TAB_URL, {}, {
          reuseExisting: request.disposition !== 'new-tab',
        });
        return {
          handled: true,
          activeTabId: model.getSnapshot().activeTabId,
        };
      }

      model.createPdfTab(normalizedUrl, {}, {
        reuseExisting: request.disposition !== 'new-tab',
      });
      return {
        handled: true,
        activeTabId: model.getSnapshot().activeTabId,
      };
    },
  };
}
