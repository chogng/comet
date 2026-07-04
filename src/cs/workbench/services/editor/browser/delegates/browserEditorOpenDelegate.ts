import {
  EMPTY_BROWSER_TAB_URL,
  isEditorDraftTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import { isReusableEmptyBrowserTab } from 'cs/workbench/browser/parts/editor/editorTabPolicy';
import type { EditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import {
  createUnhandledEditorOpenResult,
  type BrowserEditorCurrentOpenRequest,
  type BrowserEditorNewTabOpenRequest,
  type BrowserEditorRevealOrOpenRequest,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { EditorOpenDelegate } from 'cs/workbench/services/editor/browser/editorOpenRegistry';

type BrowserEditorOpenRequest =
  | BrowserEditorCurrentOpenRequest
  | BrowserEditorNewTabOpenRequest
  | BrowserEditorRevealOrOpenRequest;

type BrowserEditorOpenModel = Pick<
  EditorModel,
  'activateTab' | 'createBrowserTab' | 'getSnapshot' | 'updateActiveContentTabUrl'
>;

export function createBrowserEditorOpenDelegate(
  model: BrowserEditorOpenModel,
): EditorOpenDelegate<BrowserEditorOpenRequest> {
  return {
    canOpen(request): request is BrowserEditorOpenRequest {
      return request.kind === 'browser';
    },
    open(request) {
      switch (request.disposition) {
        case 'current': {
          const { activeTab, activeTabId } = model.getSnapshot();
          if (!activeTab || isEditorDraftTabInput(activeTab)) {
            return createUnhandledEditorOpenResult();
          }

          model.updateActiveContentTabUrl(request.url, request.options);
          return {
            handled: true,
            activeTabId,
          };
        }
        case 'new-tab': {
          const normalizedUrl = request.url.trim();
          if (!normalizedUrl) {
            return createUnhandledEditorOpenResult();
          }

          model.createBrowserTab(normalizedUrl, {}, {
            reuseExisting: false,
          });
          return {
            handled: true,
            activeTabId: model.getSnapshot().activeTabId,
          };
        }
        case 'reveal-or-open': {
          if (request.url === undefined) {
            const { activeTab, tabs } = model.getSnapshot();
            const existingEmptyBrowserTab = isReusableEmptyBrowserTab(activeTab)
              ? activeTab
              : tabs.find((tab) => isReusableEmptyBrowserTab(tab)) ?? null;
            if (existingEmptyBrowserTab) {
              model.activateTab(existingEmptyBrowserTab.id);
              return {
                handled: true,
                activeTabId: existingEmptyBrowserTab.id,
              };
            }

            model.createBrowserTab(EMPTY_BROWSER_TAB_URL);
            return {
              handled: true,
              activeTabId: model.getSnapshot().activeTabId,
            };
          }

          const normalizedUrl = request.url.trim();
          if (!normalizedUrl) {
            return createUnhandledEditorOpenResult();
          }

          model.createBrowserTab(normalizedUrl);
          return {
            handled: true,
            activeTabId: model.getSnapshot().activeTabId,
          };
        }
      }
    },
  };
}
