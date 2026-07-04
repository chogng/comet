import {
  createDirtyDraftTabIdSet,
  isReusableEmptyDraftTab,
} from 'cs/workbench/browser/parts/editor/editorTabPolicy';
import type { EditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import {
  type DraftEditorOpenRequest,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { EditorOpenDelegate } from 'cs/workbench/services/editor/browser/editorOpenRegistry';

type DraftEditorOpenModel = Pick<
  EditorModel,
  'activateTab' | 'createDraftTab' | 'getSnapshot'
>;

export function createDraftEditorOpenDelegate(
  model: DraftEditorOpenModel,
): EditorOpenDelegate<DraftEditorOpenRequest> {
  return {
    canOpen(request): request is DraftEditorOpenRequest {
      return request.kind === 'draft';
    },
    open(request) {
      if (request.disposition === 'new-tab') {
        model.createDraftTab();
        return {
          handled: true,
          activeTabId: model.getSnapshot().activeTabId,
        };
      }

      const { activeTab, tabs, dirtyDraftTabIds } = model.getSnapshot();
      const dirtyDraftTabIdSet = createDirtyDraftTabIdSet(dirtyDraftTabIds);
      const existingEmptyDraftTab = isReusableEmptyDraftTab(
        activeTab,
        dirtyDraftTabIdSet,
      )
        ? activeTab
        : tabs.find((tab) =>
            isReusableEmptyDraftTab(tab, dirtyDraftTabIdSet),
          ) ?? null;

      if (existingEmptyDraftTab) {
        model.activateTab(existingEmptyDraftTab.id);
        return {
          handled: true,
          activeTabId: existingEmptyDraftTab.id,
        };
      }

      model.createDraftTab();
      return {
        handled: true,
        activeTabId: model.getSnapshot().activeTabId,
      };
    },
  };
}
