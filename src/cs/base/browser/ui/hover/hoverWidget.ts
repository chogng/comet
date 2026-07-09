import 'cs/base/browser/ui/hover/hoverWidget.css';
import {
  Disposable,
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import { $ } from 'cs/base/browser/dom';
import { Widget } from 'cs/base/browser/ui/widget';

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

export const enum HoverPosition {
  LEFT,
  RIGHT,
  BELOW,
  ABOVE,
}

const DEFAULT_PLAIN_HOVER_DELAY_MS = 600;
const DEFAULT_ACTION_HOVER_DELAY_MS = 350;
const PLAIN_HOVER_HIDE_DELAY_MS = 120;
const ACTION_HOVER_HIDE_DELAY_MS = 200;
const HOVER_REENTRY_COOLDOWN_MS = 300;
const HOVER_ABOVE_OFFSET_PX = 4;
const HOVER_BELOW_OFFSET_PX = 10;
const HOVER_EXIT_ANIMATION_MS = 90;
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

const hoverInteractionPolicy = new HoverInteractionPolicy();function isHoverRenderableEmpty(content: HoverRenderable | undefined) {
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

class CompositeMouseTracker extends Widget {
  private isMouseIn = true;
  private suppressNextMouseOut = false;
  private readonly mouseTimer = this._register(new MutableDisposable<DisposableLike>());

  constructor(
    elements: readonly HTMLElement[],
    private readonly onMouseOut: () => void,
    private readonly eventDebounceDelay: number,
  ) {
    super();

    for (const element of elements) {
      this.onmouseover(element, this.handleMouseOver);
      this.onmouseleave(element, this.handleMouseLeave);
    }
  }

  suppressPendingMouseOut() {
    if (!this.isMouseIn) {
      this.suppressNextMouseOut = true;
    }
  }

  private readonly handleMouseOver = () => {
    this.isMouseIn = true;
    this.suppressNextMouseOut = false;
    this.mouseTimer.clear();
  };

  private readonly handleMouseLeave = () => {
    this.isMouseIn = false;
    this.mouseTimer.value = createTimeoutDisposable(() => {
      if (!this.isMouseIn && !this.suppressNextMouseOut) {
        this.onMouseOut();
      }
    }, this.eventDebounceDelay);
  };
}

class HoverWidget {
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-hover-overlay');
  private readonly card = $<HTMLElementTagNameMap['div']>('div.comet-hover-card');
  private readonly domDisposables = new DisposableStore();
  private readonly mountDisposables = new DisposableStore();
  private readonly renderDisposables = new DisposableStore();
  private owner: HoverController | null = null;
  private target: HTMLElement | null = null;
  private pointerInside = false;
  private mounted = false;
  private closeAnimationHandle: number | undefined;

  constructor() {
    this.element.append(this.card);
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

  getHoverElement() {
    return this.card;
  }

  focus() {
    this.card.tabIndex = -1;
    const focusTarget = this.card.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? this.card;
    focusTarget.focus();
  }

  show(
    target: HTMLElement,
    anchor: HTMLElement,
    options: HoverOptions,
    owner: HoverController,
  ) {
    this.owner = owner;
    this.target = target;
    this.pointerInside = false;
    this.clearCloseAnimation();
    this.card.classList.remove('comet-is-closing');
    this.render(options);
    this.mount();
    this.layout(anchor, options);
    this.card.classList.add('comet-is-opening');
  }

  hide() {
    if (!this.mounted) {
      return;
    }

    this.owner = null;
    this.target = null;
    this.pointerInside = false;
    this.renderDisposables.clear();
    this.card.classList.remove('comet-is-opening');
    if (this.card.classList.contains('comet-is-closing')) {
      return;
    }

    this.card.classList.add('comet-is-closing');
    this.closeAnimationHandle = window.setTimeout(() => {
      this.closeAnimationHandle = undefined;
      this.unmount();
    }, HOVER_EXIT_ANIMATION_MS);
  }

  private clearCloseAnimation() {
    if (this.closeAnimationHandle === undefined) {
      return;
    }

    window.clearTimeout(this.closeAnimationHandle);
    this.closeAnimationHandle = undefined;
  }

  private mount() {
    if (this.mounted) {
      if (!this.element.isConnected) {
        document.body.append(this.element);
      }
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
    this.clearCloseAnimation();
    this.element.remove();
    this.mountDisposables.clear();
    this.card.classList.remove('comet-is-opening', 'comet-is-closing');
  }

  private render(options: HoverOptions) {
    this.renderDisposables.clear();
    this.card.className = 'comet-hover-card';
    this.card.classList.toggle('comet-is-compact', Boolean(options.compact));
    this.card.classList.remove('comet-is-right-aligned');
    if (options.className) {
      this.card.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }
    this.card.style.maxWidth = `${Math.max(options.maxWidth ?? 320, 132)}px`;
    this.card.setAttribute(
      'role',
      (options.actions?.length ?? 0) > 0 ? 'dialog' : 'tooltip',
    );

    const contentRow = $<HTMLElementTagNameMap['div']>('div.comet-hover-row.comet-hover-markdown');
    const contents = $<HTMLElementTagNameMap['div']>('div', { class: `comet-hover-contents${typeof options.content === 'string' ? '' : ' comet-is-node'}` });

    if (!isHoverRenderableEmpty(options.content)) {
      const content = $<HTMLElementTagNameMap['div']>('div.comet-hover-content');
      content.append(cloneHoverRenderable(options.content!));
      contents.append(content);
    }

    if (options.subtitle?.trim()) {
      const subtitle = $<HTMLElementTagNameMap['div']>('div.comet-hover-subtitle');
      subtitle.textContent = options.subtitle;
      contents.append(subtitle);
    }

    contentRow.append(contents);
    const nodes: Node[] = [contentRow];
    if ((options.actions?.length ?? 0) > 0) {
      const statusBarElement = $<HTMLElementTagNameMap['div']>('div.comet-hover-row.comet-hover-status-bar');
      const actionsElement = $<HTMLElementTagNameMap['div']>('div.comet-hover-actions');
      for (const action of options.actions ?? []) {
        const actionContainer = $<HTMLElementTagNameMap['div']>('div.comet-hover-action-container');
        actionContainer.tabIndex = action.disabled ? -1 : 0;
        actionContainer.setAttribute(
          'aria-disabled',
          action.disabled ? 'true' : 'false',
        );
        if (action.disabled) {
          actionContainer.classList.add('comet-is-disabled');
        }

const button = $<HTMLElementTagNameMap['button']>('button.comet-hover-action') as HTMLButtonElement;
        button.type = 'button';
        button.disabled = Boolean(action.disabled);
        if (action.icon && !button.disabled) {
          const icon = $<HTMLElementTagNameMap['span']>('span.comet-hover-action-icon');
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

    this.element.classList.remove('comet-is-above', 'comet-is-below');
    this.element.style.left = `${VIEWPORT_MARGIN_PX}px`;
    this.element.style.top = `${VIEWPORT_MARGIN_PX}px`;

    const hoverRect = this.element.getBoundingClientRect();
    const canFitBelow =
      targetRect.bottom + hoverRect.height + HOVER_BELOW_OFFSET_PX + VIEWPORT_MARGIN_PX <=
      viewportHeight;
    const canFitAbove =
      targetRect.top - hoverRect.height - HOVER_ABOVE_OFFSET_PX - VIEWPORT_MARGIN_PX >= 0;
    let placement: 'above' | 'below';
    if (options.position === 'above' || options.position === 'below') {
      placement = options.position;
    } else {
      placement = canFitAbove || !canFitBelow ? 'above' : 'below';
    }

    this.element.classList.add(placement === 'above' ? 'comet-is-above' : 'comet-is-below');
    const nextTop =
      placement === 'above'
        ? targetRect.top - hoverRect.height - HOVER_ABOVE_OFFSET_PX
        : targetRect.bottom + HOVER_BELOW_OFFSET_PX;
    const top = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(nextTop, viewportHeight - hoverRect.height - VIEWPORT_MARGIN_PX),
    );
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const nextLeft = targetCenterX - hoverRect.width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(nextLeft, viewportWidth - hoverRect.width - VIEWPORT_MARGIN_PX),
    );
    const isRightAligned =
      nextLeft + hoverRect.width >= viewportWidth - VIEWPORT_MARGIN_PX;

    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.card.classList.toggle('comet-is-right-aligned', isRightAligned);
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
  private readonly mouseTracker = new MutableDisposable<CompositeMouseTracker>();

  constructor(
    private readonly target: HTMLElement,
    input: HoverInput,
    private readonly anchor: HTMLElement = target,
  ) {
    super();
    hoverInteractionPolicy.installGlobalListeners();
    syncNativeHoverTitle(this.target, input);
    this.options = normalizeHoverInput(input);
    this._register(this.showTimer);
    this._register(this.hideTimer);
    this._register(this.mouseTracker);
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
    this.mouseTracker.value?.suppressPendingMouseOut();
    sharedHoverWidget.show(this.target, this.anchor, this.options, this);
    this.updateMouseTracker();
  };

  hide = () => {
    this.clearShowTimer();
    this.clearHideTimer();
    this.mouseTracker.clear();

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
      this.mouseTracker.value?.suppressPendingMouseOut();
      sharedHoverWidget.show(this.target, this.anchor, this.options, this);
      this.updateMouseTracker();
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
    if (!this.shouldHideOnHover()) {
      return;
    }
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

  private updateMouseTracker() {
    this.mouseTracker.clear();
    if (this.shouldHideOnHover()) {
      return;
    }

    this.mouseTracker.value = new CompositeMouseTracker(
      [this.target, sharedHoverWidget.getHoverElement()],
      () => {
        if (activeController === this) {
          this.hide();
        }
      },
      this.getHideDelay(),
    );
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

    if (!this.shouldHideOnHover()) {
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
  anchor?: HTMLElement,
): HoverHandle {
  return new HoverController(target, input, anchor);
}

export function hideActiveHover(): void {
  activeController?.hide();
}

export function focusActiveHover(): void {
  if (!activeController) {
    return;
  }

  sharedHoverWidget.focus();
}
