import type { DraftEditorCommandId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { WritingEditorStableSelectionTarget } from 'cs/editor/common/writingEditorDocument';
import { DraftEditorPane } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';

export type DraftEditorSurfaceActionId = 'undo' | 'redo';

export type ActiveDraftEditorCommandExecutor = {
  execute: (commandId: DraftEditorCommandId) => boolean;
  canExecute: (commandId: DraftEditorCommandId) => boolean;
  runAction: (actionId: DraftEditorSurfaceActionId) => boolean;
  getStableSelectionTarget: () => WritingEditorStableSelectionTarget | null;
};

export function createActiveDraftEditorCommandExecutor(
  getActivePane: () => AnyEditorPane | null,
): ActiveDraftEditorCommandExecutor {
  return {
    execute(commandId) {
      const activePane = getActivePane();
      if (!(activePane instanceof DraftEditorPane)) {
        return false;
      }

      return activePane.executeCommand(commandId);
    },
    canExecute(commandId) {
      const activePane = getActivePane();
      if (!(activePane instanceof DraftEditorPane)) {
        return false;
      }

      return activePane.canExecuteCommand(commandId);
    },
    runAction(actionId) {
      const activePane = getActivePane();
      if (!(activePane instanceof DraftEditorPane)) {
        return false;
      }

      return activePane.executeEditorAction(actionId);
    },
    getStableSelectionTarget() {
      const activePane = getActivePane();
      if (!(activePane instanceof DraftEditorPane)) {
        return null;
      }

      return activePane.getStableSelectionTarget();
    },
  };
}
