import { getLocaleMessages } from 'language/i18n';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import { $ } from 'cs/base/browser/dom';
import { Dialog } from 'cs/base/browser/ui/dialog/dialog';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { DisposableStore } from 'cs/base/common/lifecycle';
import {
  executeWorkbenchEditorCommand,
  getWorkbenchEditorCommandDefinitions,
} from 'cs/workbench/browser/editorCommands';

export function showWorkbenchEditorCommandPalette() {
  const ui = getLocaleMessages(localeService.getLocale());
  const definitions = getWorkbenchEditorCommandDefinitions();
  const dialog = new Dialog({
    title: ui.editorCommandPaletteTitle,
    message: '',
    buttons: [{
      label: ui.toastClose,
    }],
    cancelId: 0,
    closeLabel: ui.toastClose,
    renderBody: (container, controls) => {
      const disposables = new DisposableStore();
      const body = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-body');
      const list = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-list');

      for (const definition of definitions) {
        const content = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-text');
        const label = $<HTMLElementTagNameMap['span']>('span', undefined, definition.label(ui));
        const shortcut = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-shortcut', undefined, definition.shortcutLabel);
        content.append(label, shortcut);
        const button = disposables.add(new ButtonView({
          className: 'comet-workbench-command-palette-item',
          content,
          disabled: !definition.enabled,
          onClick: () => {
            if (!definition.enabled) {
              return;
            }
            executeWorkbenchEditorCommand(definition.id);
            controls.close(0);
          },
        }));
        list.append(button.getElement());
      }

      body.append(list);
      container.append(body);
      return disposables;
    },
  });
  void dialog.show().finally(() => dialog.dispose());
  return true;
}
