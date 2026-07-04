import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type { LocaleMessages } from 'language/locales';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createModalView } from 'cs/base/browser/ui/modal/modal';
import { $ } from 'cs/base/browser/dom';
import type { WorkbenchEditorCommandDefinition } from 'cs/workbench/browser/editorCommands';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IDisposable } from 'cs/base/common/lifecycle';

export function showWorkbenchTextInputModal(params: {
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  ui: LocaleMessages;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const hoverService = getHoverService();
    const body = $<HTMLElementTagNameMap['div']>('div.comet-workbench-editor-modal-body');
    const label = $<HTMLElementTagNameMap['label']>('label.comet-workbench-editor-modal-label', undefined, params.label);
    const inputHost = $<HTMLElementTagNameMap['div']>('div');
    const inputBox = new InputBox(inputHost, undefined, {
      value: params.defaultValue ?? '',
      placeholder: params.placeholder ?? '',
      className: 'comet-workbench-editor-modal-input',
    });
    const actions = $<HTMLElementTagNameMap['div']>('div.comet-workbench-editor-modal-actions');
    const cancelButton = $<HTMLElementTagNameMap['button']>('button.comet-btn-base.comet-btn-secondary.comet-btn-md', undefined, params.ui.editorModalCancel) as HTMLButtonElement;
    const submitButton = $<HTMLElementTagNameMap['button']>('button.comet-btn-base.comet-btn-primary.comet-btn-md', undefined, params.ui.editorModalConfirm) as HTMLButtonElement;

    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) {
        return;
      }

      resolved = true;
      modal.dispose();
      inputBox.dispose();
      resolve(value);
    };

    cancelButton.type = 'button';
    submitButton.type = 'button';
    cancelButton.addEventListener('click', () => finish(null));
    submitButton.addEventListener('click', () => finish(inputBox.value.trim()));

    inputBox.inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(inputBox.value.trim());
      }
    });

    actions.append(cancelButton, submitButton);
    body.append(label, inputHost, actions);

    const modal = createModalView({
      open: true,
      title: params.title,
      content: body,
      closeLabel: params.ui.toastClose,
      onClose: () => finish(null),
      panelClassName: 'comet-workbench-editor-modal-panel',
      hoverService,
    });

    modal.open();
    queueMicrotask(() => inputBox.focus());
  });
}

export function showWorkbenchSaveConfirmModal(params: {
  title: string;
  message: string;
  saveLabel: string;
  discardLabel: string;
  cancelLabel: string;
  closeLabel: string;
  cancellationToken?: CancellationToken;
}): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    const hoverService = getHoverService();
    const body = $<HTMLElementTagNameMap['div']>('div.comet-workbench-editor-modal-body');
    const message = $<HTMLElementTagNameMap['p']>('p.comet-workbench-editor-confirm-message', undefined, params.message);
    const actions = $<HTMLElementTagNameMap['div']>('div.comet-workbench-editor-modal-actions');
    const cancelButton = $<HTMLElementTagNameMap['button']>('button.comet-btn-base.comet-btn-secondary.comet-btn-md', undefined, params.cancelLabel) as HTMLButtonElement;
    const discardButton = $<HTMLElementTagNameMap['button']>('button.comet-btn-base.comet-btn-secondary.comet-btn-md', undefined, params.discardLabel) as HTMLButtonElement;
    const saveButton = $<HTMLElementTagNameMap['button']>('button.comet-btn-base.comet-btn-primary.comet-btn-md', undefined, params.saveLabel) as HTMLButtonElement;

    let resolved = false;
    let cancellationListener: IDisposable | undefined;
    const finish = (value: 'save' | 'discard' | 'cancel') => {
      if (resolved) {
        return;
      }

      resolved = true;
      cancellationListener?.dispose();
      modal.dispose();
      resolve(value);
    };

    cancelButton.type = 'button';
    discardButton.type = 'button';
    saveButton.type = 'button';
    cancelButton.addEventListener('click', () => finish('cancel'));
    discardButton.addEventListener('click', () => finish('discard'));
    saveButton.addEventListener('click', () => finish('save'));

    actions.append(cancelButton, discardButton, saveButton);
    body.append(message, actions);

    const modal = createModalView({
      open: true,
      title: params.title,
      content: body,
      closeLabel: params.closeLabel,
      onClose: () => finish('cancel'),
      panelClassName: 'comet-workbench-editor-modal-panel',
      hoverService,
    });

    cancellationListener = params.cancellationToken?.onCancellationRequested(() => finish('cancel'));
    if (!resolved) {
      modal.open();
      queueMicrotask(() => saveButton.focus());
    }
  });
}

export function showWorkbenchCommandPaletteModal(params: {
  title: string;
  ui: LocaleMessages;
  commands: ReadonlyArray<WorkbenchEditorCommandDefinition & { labelText: string }>;
  onSelect: (commandId: WorkbenchEditorCommandDefinition['id']) => void;
}) {
  const hoverService = getHoverService();
	const body = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-body');
	const list = $<HTMLElementTagNameMap['div']>('div.comet-workbench-command-palette-list');

  const modal = createModalView({
    open: true,
    title: params.title,
    content: body,
    closeLabel: params.ui.toastClose,
    onClose: () => modal.dispose(),
    panelClassName: 'comet-workbench-command-palette-panel',
    hoverService,
  });

  for (const command of params.commands) {
    const button = $<HTMLElementTagNameMap['button']>('button.comet-workbench-command-palette-item.comet-btn-base.comet-btn-secondary.comet-btn-md') as HTMLButtonElement;
		const text = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-text', undefined, command.labelText);
    const shortcut = $<HTMLElementTagNameMap['span']>('span.comet-workbench-command-palette-shortcut', undefined, command.shortcutLabel);
    button.type = 'button';
    button.disabled = !command.enabled;
    button.append(text, shortcut);
    button.addEventListener('click', () => {
      if (!command.enabled) {
        return;
      }
      params.onSelect(command.id);
      modal.dispose();
    });
    list.append(button);
  }

  body.append(list);
  modal.open();
}
