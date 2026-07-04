import 'cs/base/browser/ui/aria/aria.css';

export type AriaRole =
  | 'tree'
  | 'treeitem'
  | 'list'
  | 'listitem'
  | 'listbox'
  | 'option'
  | 'checkbox'
  | 'button'
  | 'menu'
  | 'menuitem'
  | 'presentation'
  | 'none';

const MAX_MESSAGE_LENGTH = 20_000;

let ariaContainer: HTMLElement | null = null;
let alertContainer: HTMLElement | null = null;
let alertContainerAlt: HTMLElement | null = null;
let statusContainer: HTMLElement | null = null;
let statusContainerAlt: HTMLElement | null = null;

function clearNode(node: HTMLElement) {
  node.replaceChildren();
}

function isMacintosh() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const platform = String(navigator.platform ?? '').toLowerCase();
  return (
    platform === 'darwin' ||
    platform.includes('mac') ||
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod')
  );
}

function createLiveRegion(
  parent: HTMLElement,
  className: string,
  configure: (element: HTMLElement) => void,
) {
  const element = document.createElement('div');
  element.className = className;
  configure(element);
  parent.append(element);
  return element;
}

function insertMessage(target: HTMLElement, message: string) {
  clearNode(target);
  target.textContent = message.slice(0, MAX_MESSAGE_LENGTH);

  // Toggling visibility nudges some screen readers to re-announce the updated region.
  target.style.visibility = 'hidden';
  target.style.visibility = 'visible';
}

function announce(
  message: string,
  primary: HTMLElement,
  alternate: HTMLElement,
) {
  if (primary.textContent !== message) {
    clearNode(alternate);
    insertMessage(primary, message);
    return;
  }

  clearNode(primary);
  insertMessage(alternate, message);
}

export function setARIAContainer(parent: HTMLElement) {
  ariaContainer?.remove();

  ariaContainer = document.createElement('div');
  ariaContainer.className = 'comet-aria-container';

  alertContainer = createLiveRegion(ariaContainer, 'comet-aria-alert', (element) => {
    element.setAttribute('role', 'alert');
    element.setAttribute('aria-atomic', 'true');
  });
  alertContainerAlt = createLiveRegion(ariaContainer, 'comet-aria-alert', (element) => {
    element.setAttribute('role', 'alert');
    element.setAttribute('aria-atomic', 'true');
  });

  statusContainer = createLiveRegion(ariaContainer, 'comet-aria-status', (element) => {
    element.setAttribute('role', 'complementary');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
  });
  statusContainerAlt = createLiveRegion(ariaContainer, 'comet-aria-status', (element) => {
    element.setAttribute('role', 'complementary');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
  });

  parent.append(ariaContainer);
}

export function alert(message: string): void {
  if (!ariaContainer || !alertContainer || !alertContainerAlt) {
    return;
  }

  announce(message, alertContainer, alertContainerAlt);
}

export function status(message: string): void {
  if (!ariaContainer) {
    return;
  }

  if (isMacintosh()) {
    alert(message);
    return;
  }

  if (!statusContainer || !statusContainerAlt) {
    return;
  }

  announce(message, statusContainer, statusContainerAlt);
}
