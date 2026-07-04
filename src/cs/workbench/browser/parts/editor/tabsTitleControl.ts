import { createActionBarView, type ActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import {
  getHoverService,
} from 'cs/platform/hover/browser/hoverService';
import type {
  HoverHandle,
} from 'cs/base/browser/ui/hover/hover';
import { createLxIcon, type LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { HorizontalScrollbar } from 'cs/base/browser/ui/scrollbar/horizontalScrollbar';
import {
  createMouseContextMenuAnchor,
  type ContextMenuAction,
} from 'cs/base/browser/contextmenu';
import {
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import type { EditorGroupTabItem } from 'cs/workbench/browser/parts/editor/editorGroupModel';
import {
  TitleControl,
  type TitleControlProps,
} from 'cs/workbench/browser/parts/editor/titleControl';
import {
  createContextMenuService,
  type WorkbenchContextMenuService,
} from 'app/cs/workbench/services/contextmenu/electron-browser/contextmenuService';

type TabView = {
  element: HTMLDivElement;
  mainButton: HTMLButtonElement;
  mainHover: HoverHandle;
  actionsView: ActionBarView;
  icon: HTMLSpanElement;
  labelText: HTMLSpanElement;
  dispose: () => void;
};

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

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function getTabPaneModeIconName(
  paneMode: EditorGroupTabItem['paneMode'],
): LxIconName {
  switch (paneMode) {
    case 'draft':
      return 'draft';
    case 'pdf':
      return 'file-text';
    case 'file':
      return 'file-text';
    case 'terminal':
      return 'terminal';
    case 'git-changes':
      return 'git-branch';
    default:
      return 'browser-1';
  }
}

function isTabClosable(tab: Pick<EditorGroupTabItem, 'targetTabId' | 'state'>) {
  return Boolean(tab.targetTabId && tab.state.isClosable);
}

function createDirtyCloseButtonContent() {
  const container = createElement('span', 'editor-tab-dirty-close-icon');
  container.append(
    createLxIcon('unsave', 'editor-tab-close-icon-unsave'),
    createLxIcon('close', 'editor-tab-close-icon-close'),
  );
  return container;
}

function normalizeTabFaviconUrl(value: string | undefined) {
  return String(value ?? '').trim();
}

function isDragEventLike(event: Event): event is DragEvent {
  return 'dataTransfer' in event;
}

type DragState = {
  sourceViewTabId: string;
  sourceTabId: string;
  targetSlotIndex: number | null;
};

const DROP_POSITION_HYSTERESIS_PX = 6;

function createTabFaviconImageElement(
  faviconUrl: string,
  onError: () => void,
) {
  const faviconImage = createElement('img', 'editor-tab-favicon');
  faviconImage.alt = '';
  faviconImage.decoding = 'async';
  faviconImage.draggable = false;
  faviconImage.loading = 'eager';
  faviconImage.referrerPolicy = 'no-referrer';
  faviconImage.src = faviconUrl;
  faviconImage.addEventListener('error', onError, { once: true });
  return faviconImage;
}

export class TabsTitleControl extends TitleControl {
  private readonly disposables = new DisposableStore();
  private readonly resizeObserver = new MutableDisposable<DisposableLike>();
  private readonly layoutAnimationFrame = new MutableDisposable<DisposableLike>();
  private readonly tabsScrollbar = new MutableDisposable<HorizontalScrollbar>();
  private readonly contextMenuService: WorkbenchContextMenuService;
  private container: HTMLDivElement | null = null;
  private scrollableRoot: HTMLDivElement | null = null;
  private readonly tabViews = new Map<string, TabView>();
  private shouldRevealActiveTab = false;
  private lastRenderedTabIds: string[] = [];
  private lastRenderedActiveViewTabId: string | null = null;
  private readonly hoverService = getHoverService();
  private dragState: DragState | null = null;
  private dragPreviewElement: HTMLDivElement | null = null;

  constructor(
    props: TitleControlProps,
    options: {
      contextMenuService?: WorkbenchContextMenuService;
    } = {},
  ) {
    super(props);
    this.contextMenuService =
      options.contextMenuService ?? createContextMenuService();
  }

  protected override create() {
    this.container = createElement('div', 'editor-tabs-container horizontal-scrollbar-strip');
    this.container.setAttribute('role', 'tablist');
    const scrollHost = createElement(
      'div',
      'editor-tabs-scroll-host horizontal-scrollbar-host',
    );
    const scrollbarTrack = createElement(
      'div',
      'editor-tabs-scrollbar horizontal-scrollbar-track',
    );
    scrollbarTrack.setAttribute('aria-hidden', 'true');
    const scrollbarThumb = createElement(
      'div',
      'editor-tabs-scrollbar-thumb horizontal-scrollbar-thumb',
    );
    scrollbarThumb.setAttribute('aria-hidden', 'true');
    scrollbarTrack.append(scrollbarThumb);
    scrollHost.append(this.container, scrollbarTrack);
    const tabsScrollbar = new HorizontalScrollbar(
      scrollHost,
      this.container,
      scrollbarTrack,
      scrollbarThumb,
      {
        scrollYToX: true,
        mouseWheelSmoothScroll: false,
        consumeMouseWheelIfScrollbarIsNeeded: true,
      },
    );
    this.tabsScrollbar.value = tabsScrollbar;
    this.scrollableRoot = scrollHost;
    this.disposables.add(addDisposableListener(this.container, 'scroll', this.handleContainerScroll, {
      passive: true,
    }));
    this.disposables.add(addDisposableListener(scrollHost, 'dragover', this.handleContainerDragOver));
    this.disposables.add(addDisposableListener(scrollHost, 'drop', this.handleContainerDrop));
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        this.scheduleLayoutSync(false);
      });
      resizeObserver.observe(this.container);
      if (this.scrollableRoot) {
        resizeObserver.observe(this.scrollableRoot);
      }
      this.resizeObserver.value = toDisposable(() => {
        resizeObserver.disconnect();
      });
    } else {
      this.disposables.add(addDisposableListener(window, 'resize', this.handleWindowResize));
    }
    this.redraw();

    return this.scrollableRoot ?? this.container;
  }

  protected override update() {
    this.redraw();
  }

  override dispose() {
    this.clearDragState();
    this.layoutAnimationFrame.dispose();
    this.resizeObserver.dispose();
    this.tabsScrollbar.dispose();
    this.disposables.dispose();
    this.contextMenuService.dispose();
    for (const tabView of this.tabViews.values()) {
      tabView.dispose();
    }
    this.tabViews.clear();
    this.scrollableRoot = null;
    this.container = null;

    super.dispose();
  }

  private redraw() {
    if (!this.container) {
      return;
    }

    const nextTabElements: HTMLDivElement[] = [];
    const nextTabIds = new Set<string>();
    const totalTabs = this.props.group.tabs.length;

    for (const [index, tab] of this.props.group.tabs.entries()) {
      let tabView = this.tabViews.get(tab.id);
      if (!tabView) {
        tabView = this.createTabView();
        this.tabViews.set(tab.id, tabView);
      }

      this.updateTabView(tabView, tab, index, totalTabs);
      nextTabElements.push(tabView.element);
      nextTabIds.add(tab.id);
    }

    for (const [tabId, tabView] of [...this.tabViews.entries()]) {
      if (nextTabIds.has(tabId)) {
        continue;
      }

      tabView.dispose();
      this.tabViews.delete(tabId);
    }

    this.syncTabOrder(nextTabElements);
    const nextRenderedTabIds = this.props.group.tabs.map((tab) => tab.id);
    const nextActiveViewTabId = this.findActiveViewTabId(this.props.group.tabs);
    const shouldRevealActiveTab = this.shouldRevealAfterRedraw(
      nextRenderedTabIds,
      nextActiveViewTabId,
    );
    this.lastRenderedTabIds = nextRenderedTabIds;
    this.lastRenderedActiveViewTabId = nextActiveViewTabId;
    this.scheduleLayoutSync(shouldRevealActiveTab);
  }

  private createTabView(): TabView {
    const tabElement = createElement('div', 'editor-tab');
    const viewDisposables = new DisposableStore();
    const mainButton = createElement(
      'button',
      'editor-tab-main btn-base btn-md',
    );
    mainButton.type = 'button';
    mainButton.setAttribute('role', 'tab');
    viewDisposables.add(addDisposableListener(tabElement, 'pointerenter', () => {
      tabElement.dataset.hovered = 'true';
    }));
    viewDisposables.add(addDisposableListener(tabElement, 'pointerleave', () => {
      delete tabElement.dataset.hovered;
    }));
    viewDisposables.add(addDisposableListener(tabElement, 'dragstart', this.handleTabDragStart));
    viewDisposables.add(addDisposableListener(tabElement, 'dragover', this.handleTabDragOver));
    viewDisposables.add(addDisposableListener(tabElement, 'drop', this.handleTabDrop));
    viewDisposables.add(addDisposableListener(tabElement, 'dragend', this.handleTabDragEnd));

    const label = createElement('span', 'editor-tab-label');
    const icon = createElement('span', 'editor-tab-icon');
    const labelText = createElement('span', 'editor-tab-label-text');
    label.append(icon, labelText);
    mainButton.append(label);
    const mainHover = this.hoverService.createHover(mainButton, null);
    const actionsView = createActionBarView({
      className: 'editor-tab-actions',
      ariaRole: 'group',
    });
    tabElement.append(mainButton, actionsView.getElement());

    return {
      element: tabElement,
      mainButton,
      mainHover,
      actionsView,
      icon,
      labelText,
      dispose: () => {
        viewDisposables.dispose();
        mainHover.dispose();
        actionsView.dispose();
        tabElement.remove();
      },
    };
  }

  private updateTabView(
    tabView: TabView,
    tab: EditorGroupTabItem,
    index: number,
    totalTabs: number,
  ) {
    const closable = isTabClosable(tab);
    tabView.element.classList.toggle('is-active', tab.state.isActive);
    tabView.element.classList.toggle('is-closable', closable);
    tabView.element.classList.toggle('is-dirty', tab.state.isDirty);
    tabView.element.classList.toggle('has-title', Boolean(tab.label.trim()));
    tabView.element.classList.toggle('is-available', Boolean(tab.targetTabId));
    tabView.element.dataset.paneMode = tab.paneMode;
    tabView.element.dataset.tabId = tab.id;
    tabView.element.dataset.targetTabId = tab.targetTabId ?? '';
    const canReorder = Boolean(
      this.props.onReorderTab &&
        tab.targetTabId,
    );
    tabView.mainButton.draggable = canReorder;

    tabView.mainButton.setAttribute('aria-selected', String(tab.state.isActive));
    tabView.mainButton.setAttribute('aria-posinset', String(index + 1));
    tabView.mainButton.setAttribute('aria-setsize', String(totalTabs));
    tabView.mainButton.tabIndex = 0;
    tabView.mainHover.update(tab.title);
    tabView.mainButton.disabled = false;
    tabView.element.oncontextmenu = (event) => {
      this.openTabContextMenu(event, tab);
    };
    tabView.mainButton.onclick = () => {
      if (tab.targetTabId) {
        this.props.onActivateTab(tab.targetTabId);
        return;
      }

      this.props.onOpenPaneMode(tab.paneMode);
    };

    const createFallbackPaneIcon = () =>
      createLxIcon(getTabPaneModeIconName(tab.paneMode));
    const faviconUrl =
      tab.paneMode === 'browser'
        ? normalizeTabFaviconUrl(tab.faviconUrl)
        : '';

    if (faviconUrl) {
      const faviconImage = createTabFaviconImageElement(faviconUrl, () => {
        if (tabView.icon.contains(faviconImage)) {
          tabView.icon.replaceChildren(createFallbackPaneIcon());
        }
      });
      tabView.icon.replaceChildren(faviconImage);
    } else {
      tabView.icon.replaceChildren(createFallbackPaneIcon());
    }

    tabView.labelText.textContent = tab.label;
    tabView.actionsView.setProps({
      className: 'editor-tab-actions',
      ariaRole: 'group',
      items: closable
        ? [
            {
              id: `close-${tab.id}`,
              label: this.props.labels.close,
              title: this.props.labels.close,
              mode: 'icon',
              buttonClassName: 'editor-tab-close-btn',
              content: tab.state.isDirty
                ? createDirtyCloseButtonContent()
                : createLxIcon('close'),
              onClick: (event) => {
                event.stopPropagation();
                void this.props.onCloseTab(tab.targetTabId!);
              },
            },
          ]
        : [],
    });
  }

  private getReorderableTabMetadata(element: HTMLElement) {
    if (!this.props.onReorderTab) {
      return null;
    }

    const viewTabId = element.dataset.tabId?.trim() ?? '';
    const targetTabId = element.dataset.targetTabId?.trim() ?? '';
    if (!viewTabId || !targetTabId) {
      return null;
    }

    return {
      viewTabId,
      targetTabId,
    };
  }

  private getReorderableTabElements() {
    if (!this.container) {
      return [];
    }

    return Array.from(this.container.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.classList.contains('editor-tab'),
    );
  }

  private getTabMidpoint(tabElement: HTMLElement) {
    const rect = tabElement.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  private getViewTabIndex(viewTabId: string) {
    return this.props.group.tabs.findIndex((tab) => tab.id === viewTabId);
  }

  private resolveDropSlotIndexFromTab(
    event: DragEvent,
    tabElement: HTMLElement,
  ) {
    const viewTabId = tabElement.dataset.tabId?.trim() ?? '';
    const tabIndex = this.getViewTabIndex(viewTabId);
    if (tabIndex < 0) {
      return null;
    }

    const rect = tabElement.getBoundingClientRect();
    if (rect.width <= 0) {
      return tabIndex + 1;
    }

    const midpoint = rect.left + rect.width / 2;
    const currentTargetSlotIndex = this.dragState?.targetSlotIndex ?? null;
    const leadingSlotIndex = tabIndex;
    const trailingSlotIndex = tabIndex + 1;
    if (
      currentTargetSlotIndex === leadingSlotIndex &&
      event.clientX <= midpoint + DROP_POSITION_HYSTERESIS_PX
    ) {
      return leadingSlotIndex;
    }
    if (
      currentTargetSlotIndex === trailingSlotIndex &&
      event.clientX >= midpoint - DROP_POSITION_HYSTERESIS_PX
    ) {
      return trailingSlotIndex;
    }

    return event.clientX < midpoint ? leadingSlotIndex : trailingSlotIndex;
  }

  private resolveDropSlotIndexFromStrip(event: DragEvent) {
    const tabElements = this.getReorderableTabElements();
    if (tabElements.length === 0) {
      return null;
    }

    const currentTargetSlotIndex = this.dragState?.targetSlotIndex ?? null;
    if (currentTargetSlotIndex !== null) {
      const leftBoundary =
        currentTargetSlotIndex <= 0
          ? Number.NEGATIVE_INFINITY
          : this.getTabMidpoint(tabElements[currentTargetSlotIndex - 1]!);
      const rightBoundary =
        currentTargetSlotIndex >= tabElements.length
          ? Number.POSITIVE_INFINITY
          : this.getTabMidpoint(tabElements[currentTargetSlotIndex]!);

      if (
        event.clientX >= leftBoundary - DROP_POSITION_HYSTERESIS_PX &&
        event.clientX <= rightBoundary + DROP_POSITION_HYSTERESIS_PX
      ) {
        return currentTargetSlotIndex;
      }
    }

    for (let index = 0; index < tabElements.length; index += 1) {
      const tabElement = tabElements[index];
      if (!tabElement) {
        continue;
      }

      const rect = tabElement.getBoundingClientRect();
      if (rect.width <= 0) {
        continue;
      }

      if (event.clientX < this.getTabMidpoint(tabElement)) {
        return index;
      }
    }

    return tabElements.length;
  }

  private getScrollHostRelativeX(clientX: number) {
    if (!this.scrollableRoot) {
      return 0;
    }

    const scrollHostRect = this.scrollableRoot.getBoundingClientRect();
    return clientX - scrollHostRect.left;
  }

  private resolveDropIndicatorLeft(targetSlotIndex: number) {
    if (!this.container) {
      return null;
    }

    const tabCount = this.props.group.tabs.length;
    const normalizedTargetSlotIndex = Math.max(
      0,
      Math.min(targetSlotIndex, tabCount),
    );

    const previousViewTabId =
      this.props.group.tabs[normalizedTargetSlotIndex - 1]?.id ?? null;
    const nextViewTabId =
      this.props.group.tabs[normalizedTargetSlotIndex]?.id ?? null;
    const previousTabElement = previousViewTabId
      ? this.tabViews.get(previousViewTabId)?.element ?? null
      : null;
    const nextTabElement = nextViewTabId
      ? this.tabViews.get(nextViewTabId)?.element ?? null
      : null;

    if (previousTabElement && nextTabElement) {
      const previousRect = previousTabElement.getBoundingClientRect();
      const nextRect = nextTabElement.getBoundingClientRect();
      const previousRight =
        previousRect.width > 0
          ? this.getScrollHostRelativeX(previousRect.right)
          : null;
      const nextLeft =
        nextRect.width > 0
          ? this.getScrollHostRelativeX(nextRect.left)
          : null;
      if (
        previousRight !== null &&
        nextLeft !== null &&
        nextLeft > previousRight
      ) {
        return (previousRight + nextLeft) / 2;
      }
      return nextLeft ?? previousRight;
    }

    if (nextTabElement) {
      const nextRect = nextTabElement.getBoundingClientRect();
      return this.getScrollHostRelativeX(nextRect.left);
    }

    if (previousTabElement) {
      const previousRect = previousTabElement.getBoundingClientRect();
      return this.getScrollHostRelativeX(previousRect.right);
    }

    return null;
  }

  private updateDropIndicator(left: number | null) {
    if (!this.scrollableRoot) {
      return;
    }

    if (left === null) {
      this.scrollableRoot.classList.remove('is-drop-indicator-visible');
      this.scrollableRoot.style.removeProperty(
        '--editor-tab-drop-indicator-left',
      );
      return;
    }

    this.scrollableRoot.classList.add('is-drop-indicator-visible');
    this.scrollableRoot.style.setProperty(
      '--editor-tab-drop-indicator-left',
      `${left}px`,
    );
  }

  private syncDropTargetFromEvent(event: DragEvent) {
    if (!this.dragState) {
      return null;
    }

    const targetElement = event.currentTarget;
    const targetMetadata =
      targetElement instanceof HTMLElement
        ? this.getReorderableTabMetadata(targetElement)
        : null;
    const targetSlotIndex =
      targetMetadata && targetMetadata.targetTabId !== this.dragState.sourceTabId
        ? this.resolveDropSlotIndexFromTab(event, targetElement as HTMLElement)
        : this.resolveDropSlotIndexFromStrip(event);
    if (targetSlotIndex === null) {
      this.setDropTarget(null);
      return null;
    }

    this.setDropTarget(targetSlotIndex);

    return {
      targetSlotIndex,
    };
  }

  private syncDropTargetFromContainerEvent(event: DragEvent) {
    return this.syncDropTargetFromEvent(event);
  }

  private setDropTarget(targetSlotIndex: number | null) {
    this.dragState = this.dragState
      ? {
          ...this.dragState,
          targetSlotIndex,
        }
      : null;
    this.updateDropIndicator(
      targetSlotIndex !== null
        ? this.resolveDropIndicatorLeft(targetSlotIndex)
        : null,
    );
  }

  private clearDragState() {
    this.disposeDragPreviewElement();
    this.updateDropIndicator(null);
    const sourceTabElement = this.dragState?.sourceViewTabId
      ? this.tabViews.get(this.dragState.sourceViewTabId)?.element ?? null
      : null;
    if (sourceTabElement) {
      sourceTabElement.classList.remove('is-dragging');
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        sourceTabElement.contains(activeElement)
      ) {
        activeElement.blur();
      }
    }

    this.dragState = null;
    for (const tabView of this.tabViews.values()) {
      delete tabView.element.dataset.hovered;
      tabView.element.classList.remove('is-dragging');
    }
  }

  private createDragPreviewElement(sourceTabElement: HTMLElement) {
    this.disposeDragPreviewElement();

    const previewElement = sourceTabElement.cloneNode(true);
    if (!(previewElement instanceof HTMLDivElement)) {
      return null;
    }

    previewElement.classList.add('editor-tab-drag-preview');
    previewElement.classList.remove('is-dragging');
    previewElement.removeAttribute('data-hovered');

    const { width, height } = sourceTabElement.getBoundingClientRect();
    if (width > 0) {
      previewElement.style.width = `${width}px`;
      previewElement.style.maxWidth = `${width}px`;
    }
    if (height > 0) {
      previewElement.style.height = `${height}px`;
    }

    document.body.append(previewElement);
    this.dragPreviewElement = previewElement;
    return previewElement;
  }

  private disposeDragPreviewElement() {
    this.dragPreviewElement?.remove();
    this.dragPreviewElement = null;
  }

  private openTabContextMenu(
    event: MouseEvent,
    tab: EditorGroupTabItem,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (!tab.targetTabId) {
      return;
    }

    const actions: ContextMenuAction[] = [
      ...(tab.state.isClosable
        ? [
            {
              value: 'close' as const,
              label: this.props.labels.close,
            },
            this.props.onCloseOtherTabs
              ? {
                  value: 'close-others' as const,
                  label: this.props.labels.closeOthers ?? 'Close Others',
                }
              : null,
            this.props.onCloseAllTabs
              ? {
                  value: 'close-all' as const,
                  label: this.props.labels.closeAll ?? 'Close All',
                }
              : null,
          ]
        : []),
      this.props.onRenameTab
        ? {
            value: 'rename',
            label: this.props.labels.rename ?? 'Rename',
          }
        : null,
    ].filter((action): action is ContextMenuAction => Boolean(action));
    if (actions.length === 0) {
      return;
    }

    this.contextMenuService.showContextMenu({
      getAnchor: () => createMouseContextMenuAnchor(event),
      getActions: () => actions,
      getMenuData: () => 'editor-tab-context',
      alignment: 'start',
      onSelect: (value) => {
        switch (value) {
          case 'close':
            void this.props.onCloseTab(tab.targetTabId!);
            break;
          case 'close-others':
            void this.props.onCloseOtherTabs?.(tab.targetTabId!);
            break;
          case 'close-all':
            void this.props.onCloseAllTabs?.();
            break;
          case 'rename':
            void this.props.onRenameTab?.(tab.targetTabId!);
            break;
        }
      },
    });
  }

  private syncTabOrder(nextTabElements: HTMLDivElement[]) {
    if (!this.container) {
      return;
    }

    let currentNode = this.container.firstChild;
    for (const nextTabElement of nextTabElements) {
      if (nextTabElement === currentNode) {
        currentNode = currentNode?.nextSibling ?? null;
        continue;
      }

      this.container.insertBefore(nextTabElement, currentNode);
    }

    while (currentNode) {
      const nextSibling = currentNode.nextSibling;
      this.container.removeChild(currentNode);
      currentNode = nextSibling;
    }
  }

  private scheduleLayoutSync(revealActiveTab = true) {
    this.shouldRevealActiveTab = this.shouldRevealActiveTab || revealActiveTab;
    if (this.layoutAnimationFrame.value) {
      return;
    }

    let animationFrameHandle = 0;
    const animationFrameDisposable = toDisposable(() => {
      window.cancelAnimationFrame(animationFrameHandle);
    });
    this.layoutAnimationFrame.value = animationFrameDisposable;
    animationFrameHandle = window.requestAnimationFrame(() => {
      if (this.layoutAnimationFrame.value === animationFrameDisposable) {
        this.layoutAnimationFrame.clearAndLeak();
      }
      this.tabsScrollbar.value?.renderNow();
      this.syncOverflowState();
      if (this.shouldRevealActiveTab) {
        this.revealActiveTab();
      }
      this.shouldRevealActiveTab = false;
      this.syncOverflowState();
      this.tabsScrollbar.value?.renderNow();
    });
  }

  private syncOverflowState() {
    if (!this.container) {
      return;
    }

    const lastTab = this.container.lastElementChild as HTMLElement | null;
    const contentRight = lastTab
      ? lastTab.offsetLeft + lastTab.offsetWidth
      : this.container.scrollWidth;
    const maxScrollLeft = Math.max(
      0,
      contentRight - this.container.clientWidth,
    );
    const isOverflowing =
      this.container.clientWidth > 0 && maxScrollLeft > 1;
    const scrollLeft = this.container.scrollLeft;

    this.container.classList.toggle('is-overflowing', isOverflowing);
    this.container.classList.toggle(
      'is-scroll-start',
      !isOverflowing || scrollLeft <= 1,
    );
    this.container.classList.toggle(
      'is-scroll-end',
      !isOverflowing || scrollLeft >= maxScrollLeft - 1,
    );
  }

  private revealActiveTab() {
    if (!this.container) {
      return;
    }

    const activeTab = this.container.querySelector(
      '.editor-tab.is-active',
    ) as HTMLElement | null;
    if (!activeTab) {
      return;
    }

    const visibleLeft = this.container.scrollLeft;
    const visibleRight = visibleLeft + this.container.clientWidth;
    const activeLeft = activeTab.offsetLeft;
    const activeRight = activeLeft + activeTab.offsetWidth;

    if (activeLeft < visibleLeft) {
      this.container.scrollLeft = activeLeft;
      return;
    }

    if (activeRight > visibleRight) {
      this.container.scrollLeft = Math.max(
        0,
        activeRight - this.container.clientWidth,
      );
    }
  }

  private shouldRevealAfterRedraw(
    tabIds: readonly string[],
    activeViewTabId: string | null,
  ) {
    const activeViewChanged = this.lastRenderedActiveViewTabId !== activeViewTabId;
    const tabOrderChanged =
      this.lastRenderedTabIds.length !== tabIds.length ||
      tabIds.some((tabId, index) => this.lastRenderedTabIds[index] !== tabId);

    if ((!activeViewChanged && !tabOrderChanged) || !activeViewTabId) {
      return false;
    }

    return !this.isViewTabFullyVisible(activeViewTabId);
  }

  private findActiveViewTabId(tabs: readonly EditorGroupTabItem[]) {
    return tabs.find((tab) => tab.state.isActive)?.id ?? null;
  }

  private isViewTabFullyVisible(tabId: string) {
    if (!this.container) {
      return false;
    }

    const tabElement = this.tabViews.get(tabId)?.element;
    if (!tabElement) {
      return false;
    }

    const visibleLeft = this.container.scrollLeft;
    const visibleRight = visibleLeft + this.container.clientWidth;
    const tabLeft = tabElement.offsetLeft;
    const tabRight = tabLeft + tabElement.offsetWidth;

    return tabLeft >= visibleLeft && tabRight <= visibleRight;
  }

  private readonly handleContainerScroll = () => {
    this.syncOverflowState();
  };

  private readonly handleWindowResize = () => {
    this.scheduleLayoutSync(false);
  };

  private readonly handleTabDragStart = (event: Event) => {
    if (!isDragEventLike(event)) {
      return;
    }

    const tabElement = event.currentTarget;
    if (!(tabElement instanceof HTMLElement)) {
      return;
    }

    const tabMetadata = this.getReorderableTabMetadata(tabElement);
    if (!tabMetadata) {
      return;
    }

    if (this.props.group.activeTabId !== tabMetadata.viewTabId) {
      this.props.onActivateTab(tabMetadata.targetTabId);
    }

    this.clearDragState();
    this.dragState = {
      sourceViewTabId: tabMetadata.viewTabId,
      sourceTabId: tabMetadata.targetTabId,
      targetSlotIndex: null,
    };
    delete tabElement.dataset.hovered;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && tabElement.contains(activeElement)) {
      activeElement.blur();
    }
    tabElement.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tabMetadata.targetTabId);
      const dragPreviewElement = this.createDragPreviewElement(tabElement);
      if (dragPreviewElement && typeof event.dataTransfer.setDragImage === 'function') {
        const { height } = tabElement.getBoundingClientRect();
        event.dataTransfer.setDragImage(
          dragPreviewElement,
          0,
          Math.max(0, Math.round(height / 2)),
        );
      }
    }
  };

  private readonly handleTabDragOver = (event: Event) => {
    if (!isDragEventLike(event) || !this.dragState) {
      return;
    }

    const nextDropTarget = this.syncDropTargetFromEvent(event);
    if (!nextDropTarget) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  private readonly handleTabDrop = (event: Event) => {
    if (!isDragEventLike(event) || !this.dragState) {
      return;
    }

    const nextDropTarget = this.syncDropTargetFromEvent(event);
    if (!nextDropTarget || !this.props.onReorderTab) {
      this.clearDragState();
      return;
    }

    event.preventDefault();
    const { sourceTabId } = this.dragState;
    const { targetSlotIndex } = nextDropTarget;
    this.clearDragState();
    void this.props.onReorderTab(sourceTabId, targetSlotIndex);
  };

  private readonly handleContainerDragOver = (event: Event) => {
    if (!isDragEventLike(event) || !this.dragState) {
      return;
    }

    if (
      event.target instanceof HTMLElement &&
      event.target.closest('.editor-tab')
    ) {
      return;
    }

    const nextDropTarget = this.syncDropTargetFromContainerEvent(event);
    if (!nextDropTarget) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  private readonly handleContainerDrop = (event: Event) => {
    if (!isDragEventLike(event) || !this.dragState) {
      return;
    }

    if (
      event.target instanceof HTMLElement &&
      event.target.closest('.editor-tab')
    ) {
      return;
    }

    if (!this.props.onReorderTab) {
      return;
    }

    const nextDropTarget = this.syncDropTargetFromContainerEvent(event);
    if (!nextDropTarget) {
      this.clearDragState();
      return;
    }

    event.preventDefault();
    const { sourceTabId } = this.dragState;
    const { targetSlotIndex } = nextDropTarget;
    this.clearDragState();
    void this.props.onReorderTab(sourceTabId, targetSlotIndex);
  };

  private readonly handleTabDragEnd = () => {
    this.clearDragState();
  };
}
