import 'cs/base/browser/ui/hover/hover.css';
import {
  Disposable,
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';

export type HoverRenderable = string | Node | (() => string | Node);

export type HoverAction = {
  label: string;
  icon?: HoverRenderable;
  disabled?: boolean;
  run: (target: HTMLElement) => void;
};

export type HoverOptions = {
  content?: HoverRenderable;
  subtitle?: string;
  actions?: readonly HoverAction[];
  delay?: number;
  hideOnHover?: boolean;
  position?: 'auto' | 'above' | 'below';
  showPointer?: boolean;
  compact?: boolean;
  maxWidth?: number;
  className?: string;
};

export type HoverInput = HoverOptions | string | null | undefined;

export type HoverHandle = DisposableLike & {
  show: () => void;
  hide: () => void;
  update: (input: HoverInput) => void;
};

const DEFAULT_PLAIN_HOVER_DELAY_MS = 600;
const DEFAULT_ACTION_HOVER_DELAY_MS = 350;
const PLAIN_HOVER_HIDE_DELAY_MS = 120;
const ACTION_HOVER_HIDE_DELAY_MS = 90;
const HOVER_REENTRY_COOLDOWN_MS = 300;
const POINTER_OFFSET_PX = 10;
const POINTER_SAFE_MARGIN_PX = 18;
const VIEWPORT_MARGIN_PX = 8;

type HoverRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function isPointInsideRect(rect: HoverRect, clientX: number, clientY: number) {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function toHoverRect(rect: DOMRect | DOMRectReadOnly): HoverRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function addDisposableListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): DisposableLike {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function createTimeoutDisposable(callback: () => void, delay: number): DisposableLike {
  let handle: number | null = window.setTimeout(() => {
    handle = null;
    callback();
  }, delay);

  return toDisposable(() => {
    if (handle === null) {
      return;
    }

    window.clearTimeout(handle);
    handle = null;
  });
}

class HoverInteractionPolicy {
  private inputModality: 'keyboard' | 'pointer' = 'pointer';
  private pointerSuppressedArea: HoverRect | null = null;
  private globalListenersInstalled = false;
  private readonly globalListeners = new DisposableStore();

  installGlobalListeners() {
    if (this.globalListenersInstalled || typeof document === 'undefined') {
      return;
    }

    this.globalListenersInstalled = true;
    this.globalListeners.add(
      addDisposableListener(document, 'keydown', this.handleDocumentKeyDown, true),
    );
    this.globalListeners.add(
      addDisposableListener(document, 'pointerdown', this.handleDocumentPointerDown, true),
    );
    this.globalListeners.add(
      addDisposableListener(document, 'pointermove', this.handleDocumentPointerMove, true),
    );
    this.globalListeners.add(
      addDisposableListener(document, 'mousedown', this.handleDocumentMouseDown, true),
    );
    this.globalListeners.add(
      addDisposableListener(document, 'mousemove', this.handleDocumentMouseMove, true),
    );
  }

  notePointerHover() {
    this.inputModality = 'pointer';
  }

  suppressPointerHoverFromTarget(target: HTMLElement) {
    this.inputModality = 'pointer';
    this.pointerSuppressedArea = toHoverRect(target.getBoundingClientRect());
  }

  canSchedulePointerHover() {
    return this.pointerSuppressedArea === null;
  }

  shouldShowHoverOnFocus() {
    return this.inputModality === 'keyboard';
  }

  private clearPointerSuppression() {
    this.pointerSuppressedArea = null;
  }

  private updatePointerSuppressionFromPoint(clientX: number, clientY: number) {
    if (
      this.pointerSuppressedArea &&
      !isPointInsideRect(this.pointerSuppressedArea, clientX, clientY)
    ) {
      this.clearPointerSuppression();
    }
  }

  private readonly handleDocumentKeyDown = () => {
    this.inputModality = 'keyboard';
    this.clearPointerSuppression();
  };

  private readonly handleDocumentPointerDown = () => {
    this.inputModality = 'pointer';
  };

  private readonly handleDocumentPointerMove = (event: PointerEvent) => {
    this.updatePointerSuppressionFromPoint(event.clientX, event.clientY);
  };

  private readonly handleDocumentMouseDown = () => {
    this.inputModality = 'pointer';
  };

  private readonly handleDocumentMouseMove = (event: MouseEvent) => {
    this.updatePointerSuppressionFromPoint(event.clientX, event.clientY);
  };
}

const hoverInteractionPolicy = new HoverInteractionPolicy();

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function isHoverRenderableEmpty(content: HoverRenderable | undefined) {
  if (typeof content === 'string') {
    return content.trim().length === 0;
  }

  return !content;
}

function cloneHoverRenderable(content: HoverRenderable): Node {
  if (typeof content === 'function') {
    return cloneHoverRenderable(content());
  }

  if (typeof content === 'string') {
    return document.createTextNode(content);
  }

  return content.cloneNode(true);
}

function syncNativeHoverTitle(target: HTMLElement, input: HoverInput) {
  if (typeof input === 'string') {
    const title = input.trim();
    if (title) {
      target.title = title;
      return;
    }

    target.removeAttribute('title');
    return;
  }

  target.removeAttribute('title');
}

export function normalizeHoverInput(input: HoverInput): HoverOptions | null {
  if (typeof input === 'string') {
    if (!input.trim()) {
      return null;
    }

    return {
      content: input,
      delay: DEFAULT_PLAIN_HOVER_DELAY_MS,
      hideOnHover: true,
      position: 'auto',
      showPointer: true,
      compact: false,
      maxWidth: 320,
    };
  }

  if (!input) {
    return null;
  }

  const normalized: HoverOptions = {
    ...input,
    actions: input.actions ? [...input.actions] : [],
    delay:
      input.delay ??
      ((input.actions?.length ?? 0) > 0
        ? DEFAULT_ACTION_HOVER_DELAY_MS
        : DEFAULT_PLAIN_HOVER_DELAY_MS),
    hideOnHover:
      input.actions && input.actions.length > 0
        ? false
        : input.hideOnHover ?? typeof input.content === 'string',
    position: input.position ?? 'auto',
    showPointer: input.showPointer ?? true,
    compact: input.compact ?? false,
    maxWidth: input.maxWidth ?? 320,
  };

  const hasContent = !isHoverRenderableEmpty(normalized.content);
  const hasSubtitle = Boolean(normalized.subtitle?.trim());
  const hasActions = (normalized.actions?.length ?? 0) > 0;

  if (!hasContent && !hasSubtitle && !hasActions) {
    return null;
  }

  return normalized;
}

class HoverWidget {
  private readonly element = createElement('div', 'cs-hover-overlay');
  private readonly pointer = createElement(
    'div',
    'cs-hover-pointer',
  );
  private readonly card = createElement('div', 'cs-hover-card');
  private readonly domDisposables = new DisposableStore();
  private readonly mountDisposables = new DisposableStore();
  private readonly renderDisposables = new DisposableStore();
  private owner: HoverController | null = null;
  private target: HTMLElement | null = null;
  private pointerInside = false;
  private mounted = false;

  constructor() {
    this.element.append(this.pointer, this.card);
    this.domDisposables.add(
      addDisposableListener(this.card, 'mouseenter', this.handleMouseEnter),
    );
    this.domDisposables.add(
      addDisposableListener(this.card, 'mouseleave', this.handleMouseLeave),
    );
    this.domDisposables.add(
      addDisposableListener(this.card, 'pointerdown', this.handlePointerDown),
    );
  }

  isPointerInside() {
    return this.pointerInside;
  }

  show(target: HTMLElement, options: HoverOptions, owner: HoverController) {
    this.owner = owner;
    this.target = target;
    this.pointerInside = false;
    this.render(options);
    this.mount();
    this.layout(target, options);
  }

  hide() {
    this.owner = null;
    this.target = null;
    this.pointerInside = false;
    this.renderDisposables.clear();
    this.unmount();
  }

  private mount() {
    if (this.mounted) {
      return;
    }

    this.mounted = true;
    document.body.append(this.element);
    this.mountDisposables.add(
      addDisposableListener(document, 'mousedown', this.handleDocumentMouseDown, true),
    );
    this.mountDisposables.add(
      addDisposableListener(document, 'keydown', this.handleDocumentKeyDown, true),
    );
    this.mountDisposables.add(
      addDisposableListener(document, 'scroll', this.handleDocumentScroll, true),
    );
    this.mountDisposables.add(
      addDisposableListener(window, 'resize', this.handleWindowResize),
    );
  }

  private unmount() {
    if (!this.mounted) {
      return;
    }

    this.mounted = false;
    this.element.remove();
    this.mountDisposables.clear();
  }

  private render(options: HoverOptions) {
    this.renderDisposables.clear();
    this.card.className = 'cs-hover-card';
    this.card.classList.toggle('compact', Boolean(options.compact));
    this.card.classList.remove('right-aligned');
    if (options.className) {
      this.card.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }
    this.card.style.maxWidth = `${Math.max(options.maxWidth ?? 320, 132)}px`;
    this.card.setAttribute(
      'role',
      (options.actions?.length ?? 0) > 0 ? 'dialog' : 'tooltip',
    );

    const contentRow = createElement('div', 'cs-hover-row hover-row markdown-hover');
    const contents = createElement(
      'div',
      `cs-hover-contents hover-contents${typeof options.content === 'string' ? '' : ' is-node'}`,
    );

    if (!isHoverRenderableEmpty(options.content)) {
      const content = createElement('div', 'cs-hover-content');
      content.append(cloneHoverRenderable(options.content!));
      contents.append(content);
    }

    if (options.subtitle?.trim()) {
      const subtitle = createElement('div', 'cs-hover-subtitle');
      subtitle.textContent = options.subtitle;
      contents.append(subtitle);
    }

    contentRow.append(contents);
    const nodes: Node[] = [contentRow];
    if ((options.actions?.length ?? 0) > 0) {
      const statusBarElement = createElement('div', 'cs-hover-row hover-row status-bar');
      const actionsElement = createElement('div', 'cs-hover-actions actions');
      for (const action of options.actions ?? []) {
        const actionContainer = createElement(
          'div',
          'cs-hover-action-container action-container',
        );
        actionContainer.tabIndex = action.disabled ? -1 : 0;
        actionContainer.setAttribute(
          'aria-disabled',
          action.disabled ? 'true' : 'false',
        );
        if (action.disabled) {
          actionContainer.classList.add('disabled');
        }

        const button = createElement('button', 'cs-hover-action action') as HTMLButtonElement;
        button.type = 'button';
        button.disabled = Boolean(action.disabled);
        if (action.icon && !button.disabled) {
          const icon = createElement('span', 'cs-hover-action-icon icon');
          icon.append(cloneHoverRenderable(action.icon));
          button.append(icon);
        }
        button.append(document.createTextNode(action.label));
        actionContainer.append(button);

        const runAction = (event?: MouseEvent | KeyboardEvent) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (!this.target || action.disabled) {
            return;
          }
          action.run(this.target);
          this.hide();
        };

        this.renderDisposables.add(
          addDisposableListener(actionContainer, 'click', runAction),
        );
        this.renderDisposables.add(
          addDisposableListener(actionContainer, 'keyup', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return;
            }

            runAction(event);
          }),
        );
        actionsElement.append(actionContainer);
      }
      statusBarElement.append(actionsElement);
      nodes.push(statusBarElement);
    }

    this.card.replaceChildren(...nodes);
  }

  private layout(target: HTMLElement, options: HoverOptions) {
    const targetRect = target.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;

    this.element.classList.toggle('has-pointer', options.showPointer !== false);
    this.element.classList.remove('is-above', 'is-below');
    this.pointer.classList.remove('top', 'bottom');
    this.element.style.left = `${VIEWPORT_MARGIN_PX}px`;
    this.element.style.top = `${VIEWPORT_MARGIN_PX}px`;

    const hoverRect = this.element.getBoundingClientRect();
    const canFitBelow =
      targetRect.bottom + hoverRect.height + POINTER_OFFSET_PX + VIEWPORT_MARGIN_PX <=
      viewportHeight;
    const canFitAbove =
      targetRect.top - hoverRect.height - POINTER_OFFSET_PX - VIEWPORT_MARGIN_PX >= 0;
    const placement =
      options.position === 'above'
        ? 'above'
        : options.position === 'below'
          ? 'below'
          : canFitBelow || !canFitAbove
            ? 'below'
            : 'above';

    this.element.classList.add(placement === 'above' ? 'is-above' : 'is-below');
    this.pointer.classList.add(placement === 'above' ? 'bottom' : 'top');

    const nextTop =
      placement === 'above'
        ? targetRect.top - hoverRect.height - POINTER_OFFSET_PX
        : targetRect.bottom + POINTER_OFFSET_PX;
    const top = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(nextTop, viewportHeight - hoverRect.height - VIEWPORT_MARGIN_PX),
    );
    const nextLeft = targetRect.left + targetRect.width / 2 - hoverRect.width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(nextLeft, viewportWidth - hoverRect.width - VIEWPORT_MARGIN_PX),
    );
    const isRightAligned =
      nextLeft + hoverRect.width >= viewportWidth - VIEWPORT_MARGIN_PX;
    const pointerLeft = Math.max(
      POINTER_SAFE_MARGIN_PX,
      Math.min(
        targetRect.left + targetRect.width / 2 - left,
        hoverRect.width - POINTER_SAFE_MARGIN_PX,
      ),
    );

    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.pointer.style.left = `${Math.round(pointerLeft - 3)}px`;
    this.card.classList.toggle('right-aligned', isRightAligned);
    this.element.style.setProperty(
      '--cs-hover-pointer-left',
      `${Math.round(pointerLeft)}px`,
    );
  }

  private readonly handleMouseEnter = () => {
    this.pointerInside = true;
    this.owner?.handleOverlayEnter();
  };

  private readonly handleMouseLeave = () => {
    this.pointerInside = false;
    this.owner?.handleOverlayLeave();
  };

  private readonly handlePointerDown = () => {
    this.owner?.handleOverlayInteraction();
  };

  private readonly handleDocumentMouseDown = (event: MouseEvent) => {
    const targetNode = event.target;
    if (!(targetNode instanceof Node)) {
      this.hide();
      return;
    }

    if (this.card.contains(targetNode) || this.target?.contains(targetNode)) {
      return;
    }

    this.hide();
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  private readonly handleDocumentScroll = () => {
    this.hide();
  };

  private readonly handleWindowResize = () => {
    this.hide();
  };
}

const sharedHoverWidget = new HoverWidget();
let activeController: HoverController | null = null;
let lastHoverHideAt = 0;

class HoverController extends Disposable implements HoverHandle {
  private options: HoverOptions | null;
  private disposed = false;
  private readonly showTimer = new MutableDisposable<DisposableLike>();
  private readonly hideTimer = new MutableDisposable<DisposableLike>();

  constructor(
    private readonly target: HTMLElement,
    input: HoverInput,
  ) {
    super();
    hoverInteractionPolicy.installGlobalListeners();
    syncNativeHoverTitle(this.target, input);
    this.options = normalizeHoverInput(input);
    this._register(this.showTimer);
    this._register(this.hideTimer);
    this._register(addDisposableListener(this.target, 'mouseenter', this.handleMouseEnter));
    this._register(addDisposableListener(this.target, 'mouseleave', this.handleMouseLeave));
    this._register(
      addDisposableListener(this.target, 'pointerdown', this.handlePointerDown, true),
    );
    this._register(addDisposableListener(this.target, 'focus', this.handleFocus, true));
    this._register(addDisposableListener(this.target, 'blur', this.handleBlur, true));
  }

  show = () => {
    if (this.disposed || !this.options) {
      return;
    }

    this.clearShowTimer();
    this.clearHideTimer();

    if (activeController && activeController !== this) {
      activeController.hide();
    }

    activeController = this;
    sharedHoverWidget.show(this.target, this.options, this);
  };

  hide = () => {
    this.clearShowTimer();
    this.clearHideTimer();

    if (activeController !== this) {
      return;
    }

    activeController = null;
    sharedHoverWidget.hide();
  };

  update = (input: HoverInput) => {
    syncNativeHoverTitle(this.target, input);
    this.options = normalizeHoverInput(input);

    if (!this.options) {
      this.hide();
      return;
    }

    if (activeController === this) {
      sharedHoverWidget.show(this.target, this.options, this);
    }
  };

  dispose = () => {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hide();
    super.dispose();
  };

  handleOverlayEnter() {
    if (this.shouldHideOnHover()) {
      return;
    }
    this.clearHideTimer();
  }

  handleOverlayLeave() {
    this.scheduleHide(this.shouldHideOnHover() ? 0 : this.getHideDelay());
  }

  handleOverlayInteraction() {
    this.clearHideTimer();
  }

  private hasActions() {
    return (this.options?.actions?.length ?? 0) > 0;
  }

  private getHideDelay() {
    return this.hasActions() ? ACTION_HOVER_HIDE_DELAY_MS : PLAIN_HOVER_HIDE_DELAY_MS;
  }

  private shouldHideOnHover() {
    return Boolean(this.options?.hideOnHover) && !this.hasActions();
  }

  private scheduleShow(
    delay = this.options?.delay ??
      (this.hasActions()
        ? DEFAULT_ACTION_HOVER_DELAY_MS
        : DEFAULT_PLAIN_HOVER_DELAY_MS),
  ) {
    this.clearShowTimer();
    if (!this.options) {
      return;
    }

    if (!hoverInteractionPolicy.canSchedulePointerHover()) {
      return;
    }

    if (delay <= 0) {
      this.show();
      return;
    }

    const remainingCooldown = Math.max(
      0,
      HOVER_REENTRY_COOLDOWN_MS - (Date.now() - lastHoverHideAt),
    );
    const nextDelay = Math.max(delay, remainingCooldown);

    this.showTimer.value = createTimeoutDisposable(() => {
      this.show();
    }, nextDelay);
  }

  private scheduleHide(delay = 0) {
    this.clearHideTimer();
    this.hideTimer.value = createTimeoutDisposable(() => {
      if (!this.shouldHideOnHover() && sharedHoverWidget.isPointerInside()) {
        return;
      }
      lastHoverHideAt = Date.now();
      this.hide();
    }, delay);
  }

  private clearShowTimer() {
    this.showTimer.clear();
  }

  private clearHideTimer() {
    this.hideTimer.clear();
  }

  private readonly handleMouseEnter = () => {
    hoverInteractionPolicy.notePointerHover();
    this.clearHideTimer();
    if (activeController === this) {
      this.show();
      return;
    }
    this.scheduleShow();
  };

  private readonly handleMouseLeave = () => {
    this.clearShowTimer();
    if (activeController !== this) {
      return;
    }

    this.scheduleHide(this.getHideDelay());
  };

  private readonly handleFocus = () => {
    if (!hoverInteractionPolicy.shouldShowHoverOnFocus()) {
      return;
    }
    this.clearHideTimer();
    this.show();
  };

  private readonly handlePointerDown = () => {
    hoverInteractionPolicy.suppressPointerHoverFromTarget(this.target);
    this.clearShowTimer();
    if (activeController === this) {
      this.hide();
    }
  };

  private readonly handleBlur = () => {
    if (activeController !== this) {
      return;
    }

    this.scheduleHide(90);
  };
}

export function createHoverController(
  target: HTMLElement,
  input: HoverInput,
): HoverHandle {
  return new HoverController(target, input);
}
