import type { LocaleMessages } from 'language/locales';
import { commandService, commandsRegistry } from 'cs/platform/commands/common/commands';
import {
  getDraftEditorCommandIds,
  getDraftEditorWorkbenchLabel,
  getDraftEditorShortcutLabel,
} from 'cs/editor/browser/text/editorCommandRegistry';
import type { WritingEditorStableSelectionTarget } from 'cs/editor/common/writingEditorDocument';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';

export type WorkbenchEditorCommandId = DraftEditorCommandId | 'saveDraft';

export type WorkbenchEditorCommandHandlers = {
  executeActiveDraftCommand: (commandId: DraftEditorCommandId) => boolean;
  canExecuteActiveDraftCommand: (commandId: DraftEditorCommandId) => boolean;
  getActiveDraftStableSelectionTarget: () => WritingEditorStableSelectionTarget | null;
  saveActiveDraft: () => boolean;
  canSaveActiveDraft: () => boolean;
};

export type WorkbenchEditorCommandDefinition = {
  id: WorkbenchEditorCommandId;
  label: (ui: LocaleMessages) => string;
  shortcutLabel: string;
  enabled: boolean;
};

const WORKBENCH_EDITOR_COMMAND_IDS: readonly WorkbenchEditorCommandId[] = [
  'saveDraft',
  ...getDraftEditorCommandIds(),
];

function createWorkbenchEditorCommandDefinition(
  id: WorkbenchEditorCommandId,
): WorkbenchEditorCommandDefinition {
  if (id === 'saveDraft') {
    return {
      id,
      label: (ui: LocaleMessages) => ui.editorSaveDraft,
      shortcutLabel: 'Mod+S',
      enabled: canExecuteWorkbenchEditorCommand(id),
    };
  }

  return {
    id,
    label: (ui: LocaleMessages) => getDraftEditorWorkbenchLabel(id, ui),
    shortcutLabel: getDraftEditorShortcutLabel(id),
    enabled: canExecuteWorkbenchEditorCommand(id),
  };
}

export function getWorkbenchEditorCommandDefinitions(): ReadonlyArray<WorkbenchEditorCommandDefinition> {
  return WORKBENCH_EDITOR_COMMAND_IDS.map((id) =>
    createWorkbenchEditorCommandDefinition(id),
  );
}

let workbenchEditorCommandHandlers: WorkbenchEditorCommandHandlers | null = null;

export function setWorkbenchEditorCommandHandlers(
  handlers: WorkbenchEditorCommandHandlers | null,
) {
  workbenchEditorCommandHandlers = handlers;
}

export function getWorkbenchEditorCommandHandlers() {
  return workbenchEditorCommandHandlers;
}

export function executeWorkbenchEditorCommand(commandId: WorkbenchEditorCommandId) {
  return commandService.executeCommand<boolean>(commandId) ?? false;
}

function executeRegisteredWorkbenchEditorCommand(commandId: WorkbenchEditorCommandId) {
  if (commandId === 'saveDraft') {
    if (!workbenchEditorCommandHandlers?.canSaveActiveDraft()) {
      return false;
    }

    return workbenchEditorCommandHandlers?.saveActiveDraft() ?? false;
  }

  if (!workbenchEditorCommandHandlers?.canExecuteActiveDraftCommand(commandId)) {
    return false;
  }

  return (
    workbenchEditorCommandHandlers?.executeActiveDraftCommand(commandId) ?? false
  );
}

export function canExecuteWorkbenchEditorCommand(commandId: WorkbenchEditorCommandId) {
  if (commandId === 'saveDraft') {
    return workbenchEditorCommandHandlers?.canSaveActiveDraft() ?? false;
  }

  return workbenchEditorCommandHandlers?.canExecuteActiveDraftCommand(commandId) ?? false;
}

export function getWorkbenchActiveDraftStableSelectionTarget() {
  return (
    workbenchEditorCommandHandlers?.getActiveDraftStableSelectionTarget() ?? null
  );
}

export function getWorkbenchEditorCommandDefinition(
  commandId: WorkbenchEditorCommandId,
) {
  return createWorkbenchEditorCommandDefinition(commandId);
}

for (const commandId of WORKBENCH_EDITOR_COMMAND_IDS) {
  commandsRegistry.registerCommand(commandId, () =>
    executeRegisteredWorkbenchEditorCommand(commandId),
  );
}
