import { matchesShortcutLabel } from 'cs/editor/browser/text/editorCommandRegistry';
import {
  canExecuteWorkbenchEditorCommand,
  executeWorkbenchEditorCommand,
  getWorkbenchEditorCommandDefinitions,
} from 'cs/workbench/browser/editorCommands';

import { showWorkbenchEditorCommandPalette } from 'cs/workbench/browser/workbenchEditorPalette';

function isFormControlEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function isContentEditableEventTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.isContentEditable;
}

function isEditableEventTarget(target: EventTarget | null) {
  return (
    isFormControlEventTarget(target) ||
    isContentEditableEventTarget(target)
  );
}

function hasPrimaryModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

export function handleWorkbenchEditorShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return false;
  }

  if (
    hasPrimaryModifier(event) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 's'
  ) {
    if (isFormControlEventTarget(event.target)) {
      return false;
    }

    if (!canExecuteWorkbenchEditorCommand('saveDraft')) {
      return false;
    }

    const handled = executeWorkbenchEditorCommand('saveDraft');
    if (!handled) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  if (isEditableEventTarget(event.target)) {
    return false;
  }

  if (hasPrimaryModifier(event) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
    const handled = showWorkbenchEditorCommandPalette();
    if (!handled) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  const matchingDefinition = getWorkbenchEditorCommandDefinitions().find((definition) =>
    matchesShortcutLabel(definition.shortcutLabel, event),
  );
  if (!matchingDefinition) {
    return false;
  }

  if (!canExecuteWorkbenchEditorCommand(matchingDefinition.id)) {
    return false;
  }

  const handled = executeWorkbenchEditorCommand(matchingDefinition.id);
  if (!handled) {
    return false;
  }

  event.preventDefault();
  return true;
}
