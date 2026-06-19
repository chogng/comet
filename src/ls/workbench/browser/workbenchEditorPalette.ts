import { getLocaleMessages } from 'language/i18n';
import { localeService } from 'ls/workbench/services/localization/browser/localeService';
import {
  executeWorkbenchEditorCommand,
  getWorkbenchEditorCommandDefinitions,
} from 'ls/workbench/browser/editorCommands';
import { showWorkbenchCommandPaletteModal } from 'ls/workbench/browser/workbenchEditorModals';

export function showWorkbenchEditorCommandPalette() {
  const ui = getLocaleMessages(localeService.getLocale());
  const definitions = getWorkbenchEditorCommandDefinitions();
  showWorkbenchCommandPaletteModal({
    title: ui.editorCommandPaletteTitle,
    ui,
    commands: definitions.map((definition) => ({
      ...definition,
      labelText: definition.label(ui),
    })),
    onSelect: (commandId) => {
      executeWorkbenchEditorCommand(commandId);
    },
  });
  return true;
}
