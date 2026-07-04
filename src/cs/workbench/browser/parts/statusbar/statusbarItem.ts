import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import type { EditorStatusItem } from 'cs/workbench/browser/parts/editor/editorStatus';
import {
  canRunStatusbarCommand,
  runStatusbarCommand,
} from 'cs/workbench/browser/parts/statusbar/statusbarActions';

const hoverService = getHoverService();

export function createStatusbarItemElement(item: EditorStatusItem) {
  const itemElement = document.createElement('span');
  const canRunCommand = canRunStatusbarCommand(item);
  itemElement.dataset.statusbarItemId = item.id;
  itemElement.dataset.statusbarItemValue = item.value;
  if (item.title) {
    itemElement.dataset.statusbarItemTitle = item.title;
  }
  itemElement.className = [
    'comet-editor-statusbar-item',
    item.tone ? `is-${item.tone}` : '',
    canRunCommand ? 'is-actionable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const labelElement = document.createElement('span');
  labelElement.className = 'comet-editor-statusbar-item-label';
  labelElement.textContent = item.label;

  const valueElement = document.createElement('span');
  valueElement.className = 'comet-editor-statusbar-item-value';
  valueElement.textContent = item.value;

  hoverService.createHover(itemElement, {
    content: item.label,
    subtitle: item.title ?? item.value,
    actions: canRunCommand
      ? [
          {
            label: item.label,
            run: () => {
              runStatusbarCommand(item);
            },
          },
        ]
      : [],
  });

  if (canRunCommand) {
    itemElement.tabIndex = 0;
    itemElement.setAttribute('role', 'button');
    itemElement.addEventListener('click', () => {
      runStatusbarCommand(item);
    });
    itemElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      runStatusbarCommand(item);
    });
  }

  itemElement.append(labelElement, valueElement);
  return itemElement;
}
