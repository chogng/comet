import {
  createActionBarView,
  type ActionBarItem,
  type ActionView,
} from 'ls/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import {
  createDomDropdownMenuPresenter,
  createDropdownView,
} from 'ls/base/browser/ui/dropdown/dropdown';
import { getHoverService } from 'ls/base/browser/ui/hover/hover';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';

import type { WritingEditorToolbarState } from 'ls/editor/browser/text/commands';
import { createEditorDraftToolbarStyleModel } from 'ls/editor/browser/text/editorDraftToolbarStyleModel';
import {
  createWritingEditorToolbarButtonGroups,
  type WritingEditorToolbarActions,
  type WritingEditorToolbarButtonConfig,
  type WritingEditorToolbarDropdownConfig,
  type WritingEditorToolbarItemConfig,
  type WritingEditorToolbarMenuItemConfig,
  type WritingEditorToolbarSplitButtonConfig,
} from 'ls/editor/browser/text/editorCommandRegistry';
import type { WritingEditorSurfaceLabels } from 'ls/editor/browser/text/editor';

export type DraftEditorToolbarActions = WritingEditorToolbarActions;

export type DraftEditorToolbarProps = {
  labels: WritingEditorSurfaceLabels;
  toolbarState: WritingEditorToolbarState;
  actions: DraftEditorToolbarActions;
};

type ToolbarGroupConfig = {
  title: string;
  items: readonly WritingEditorToolbarItemConfig[];
};

type ToolbarLayoutConfig = {
  groups: readonly ToolbarGroupConfig[];
  overflowMenuItems: readonly WritingEditorToolbarMenuItemConfig[];
};

type ToolbarDisplayLayoutConfig = ToolbarLayoutConfig & {
  overflowCandidateCount: number;
};

type OverflowCandidate = {
  groupIndex: number;
  itemIndex: number;
  menuItem: WritingEditorToolbarMenuItemConfig;
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

const hoverService = getHoverService();
const DRAFT_TOOLBAR_OVERFLOW_MENU_DATA = 'draft-toolbar-overflow';
const DRAFT_TOOLBAR_SPLIT_MENU_DATA = 'draft-toolbar-split';

function createGroupItemKey(groupIndex: number, itemIndex: number) {
  return `${groupIndex}:${itemIndex}`;
}

export class DraftEditorToolbar {
  private props: DraftEditorToolbarProps;
  private readonly element = createElement(
    'div',
    'editor-mode-toolbar editor-draft-toolbar',
  );
  private readonly contentElement = createElement('div', 'editor-draft-toolbar-content');
  private readonly trailingElement = createElement('div', 'editor-draft-toolbar-trailing');
  private toolbarViews: Array<{ dispose: () => void }> = [];
  private adaptiveOverflowCount = 0;
  private overflowCandidateCount = 0;
  private overflowSyncHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  private disposed = false;

  constructor(props: DraftEditorToolbarProps) {
    this.props = props;
    this.element.append(this.contentElement, this.trailingElement);
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        this.scheduleOverflowSync();
      })
      : null;
    this.resizeObserver?.observe(this.element);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: DraftEditorToolbarProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelOverflowSync();
    this.resizeObserver?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    this.disposeToolbarViews();
    this.element.replaceChildren();
  }

  private render(options?: { skipOverflowSync?: boolean }) {
    this.disposeToolbarViews();
    const layout = this.createDisplayLayout(this.createToolbarLayout());
    this.overflowCandidateCount = layout.overflowCandidateCount;
    const fragment = document.createDocumentFragment();
    for (const group of layout.groups) {
      fragment.append(this.createToolbarGroup(group));
    }
    this.contentElement.replaceChildren(fragment);
    this.trailingElement.replaceChildren();

    if (layout.overflowMenuItems.length > 0) {
      const overflowView = this.createOverflowMenu(layout.overflowMenuItems);
      this.trailingElement.append(overflowView.getElement());
    }

    if (!options?.skipOverflowSync) {
      this.scheduleOverflowSync();
    }
  }

  private createDisplayLayout(layout: ToolbarLayoutConfig): ToolbarDisplayLayoutConfig {
    const overflowCandidates = this.collectOverflowCandidates(layout.groups);
    this.clampAdaptiveOverflowCount(overflowCandidates.length);
    // Collapse from the tail so the visual order keeps leading actions stable.
    const collapsedCandidates = this.getCollapsedCandidates(overflowCandidates);
    const groups = this.filterCollapsedItems(layout.groups, collapsedCandidates);

    return {
      groups,
      overflowMenuItems: [
        // Keep command-level overflow entries first, then append width-driven collapsed actions.
        ...layout.overflowMenuItems,
        ...collapsedCandidates.map((candidate) => candidate.menuItem),
      ],
      overflowCandidateCount: overflowCandidates.length,
    };
  }

  private collectOverflowCandidates(groups: readonly ToolbarGroupConfig[]): OverflowCandidate[] {
    const candidates: OverflowCandidate[] = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
        const menuItem = this.createAdaptiveOverflowMenuItem(
          group.items[itemIndex],
          createGroupItemKey(groupIndex, itemIndex),
        );
        if (!menuItem) {
          continue;
        }
        candidates.push({
          groupIndex,
          itemIndex,
          menuItem,
        });
      }
    }
    return candidates;
  }

  private createAdaptiveOverflowMenuItem(
    item: WritingEditorToolbarItemConfig,
    overflowId: string,
  ): WritingEditorToolbarMenuItemConfig | null {
    // Split buttons and dropdown fields keep their richer inline affordances.
    // Only plain action buttons collapse into the terminal "more" menu.
    if ('menu' in item || 'options' in item) {
      return null;
    }

    return {
      id: `toolbar-overflow-action-${overflowId}`,
      label: item.label,
      title: item.label,
      checked: item.isToggle ? Boolean(item.isActive) : undefined,
      disabled: item.disabled,
      onClick: () => {
        item.onClick();
      },
    };
  }

  private clampAdaptiveOverflowCount(maxOverflowCount: number) {
    if (this.adaptiveOverflowCount <= maxOverflowCount) {
      return;
    }
    this.adaptiveOverflowCount = maxOverflowCount;
  }

  private getCollapsedCandidates(candidates: readonly OverflowCandidate[]) {
    if (this.adaptiveOverflowCount <= 0) {
      return [];
    }

    return candidates.slice(
      Math.max(candidates.length - this.adaptiveOverflowCount, 0),
    );
  }

  private filterCollapsedItems(
    groups: readonly ToolbarGroupConfig[],
    collapsedCandidates: readonly OverflowCandidate[],
  ): ToolbarGroupConfig[] {
    const hiddenToolbarItems = new Set(
      collapsedCandidates.map((candidate) => createGroupItemKey(candidate.groupIndex, candidate.itemIndex)),
    );
    return groups
      .map<ToolbarGroupConfig>((group, groupIndex) => ({
        title: group.title,
        items: group.items.filter(
          (_, itemIndex) => !hiddenToolbarItems.has(createGroupItemKey(groupIndex, itemIndex)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }

  private scheduleOverflowSync() {
    if (this.disposed) {
      return;
    }

    this.cancelOverflowSync();
    this.overflowSyncHandle = setTimeout(() => {
      this.overflowSyncHandle = null;
      this.syncAdaptiveOverflow();
    }, 0);
  }

  private cancelOverflowSync() {
    if (this.overflowSyncHandle === null) {
      return;
    }

    clearTimeout(this.overflowSyncHandle);
    this.overflowSyncHandle = null;
  }

  private syncAdaptiveOverflow() {
    if (this.disposed || !this.canMeasureOverflow()) {
      return;
    }

    const maxOverflowCount = this.overflowCandidateCount;
    let nextOverflowCount = Math.min(this.adaptiveOverflowCount, maxOverflowCount);
    if (nextOverflowCount !== this.adaptiveOverflowCount) {
      this.adaptiveOverflowCount = nextOverflowCount;
      this.render({ skipOverflowSync: true });
      if (!this.canMeasureOverflow()) {
        return;
      }
    }

    // Phase 1: keep moving actions into "more" until the toolbar fits.
    while (!this.isToolbarLayoutFitting() && nextOverflowCount < maxOverflowCount) {
      nextOverflowCount += 1;
      this.adaptiveOverflowCount = nextOverflowCount;
      this.render({ skipOverflowSync: true });
      if (!this.canMeasureOverflow()) {
        return;
      }
    }

    // Phase 2: try to pull actions back out so we keep the minimum collapsed set.
    while (nextOverflowCount > 0) {
      this.adaptiveOverflowCount = nextOverflowCount - 1;
      this.render({ skipOverflowSync: true });
      if (!this.canMeasureOverflow()) {
        return;
      }
      if (this.isToolbarLayoutFitting()) {
        nextOverflowCount -= 1;
        continue;
      }

      this.adaptiveOverflowCount = nextOverflowCount;
      this.render({ skipOverflowSync: true });
      break;
    }
  }

  private canMeasureOverflow() {
    return this.element.getBoundingClientRect().width > 0;
  }

  private isToolbarLayoutFitting() {
    const toolbarWidth = this.element.getBoundingClientRect().width;
    if (!(toolbarWidth > 0)) {
      return true;
    }

    const trailingMarginLeft = this.trailingElement.childElementCount > 0
      ? Number.parseFloat(getComputedStyle(this.trailingElement).marginLeft || '0') || 0
      : 0;
    const contentWidth = this.contentElement.scrollWidth;
    const trailingWidth = this.trailingElement.getBoundingClientRect().width;
    return (contentWidth + trailingWidth + trailingMarginLeft) <= (toolbarWidth + 0.5);
  }

  private createToolbarLayout(): ToolbarLayoutConfig {
    const { labels, toolbarState, actions } = this.props;
    const styleModel = createEditorDraftToolbarStyleModel({
      fontFamilyValue: toolbarState.fontFamily,
      fontSizeValue: toolbarState.fontSize,
      defaultTextStyleLabel: labels.defaultTextStyle,
    });

    return createWritingEditorToolbarButtonGroups({
      labels,
      toolbarState,
      actions,
      dropdownOptions: {
        setFontFamily: styleModel.fontFamily.options,
        setFontSize: styleModel.fontSize.options,
      },
      styleModel,
    });
  }

  private createToolbarGroup(groupConfig: ToolbarGroupConfig) {
    const actionBarView = createActionBarView({
      className: 'editor-draft-toolbar-group',
      ariaLabel: groupConfig.title,
      items: groupConfig.items.map((itemConfig) => this.createToolbarItem(itemConfig)),
    });
    const group = actionBarView.getElement();

    this.attachActionbarMouseDown(group);

    this.toolbarViews.push(actionBarView);
    return group;
  }

  private createToolbarItem(itemConfig: WritingEditorToolbarItemConfig): ActionBarItem {
    if ('menu' in itemConfig) {
      return this.createToolbarSplitButton(itemConfig);
    }

    if ('options' in itemConfig) {
      return this.createToolbarDropdown(itemConfig);
    }

    return this.createToolbarButton(itemConfig);
  }

  private createOverflowMenu(overflowMenuItems: readonly WritingEditorToolbarMenuItemConfig[]) {
    const overflowView = createActionBarView({
      className: 'editor-draft-toolbar-group editor-draft-toolbar-more',
      ariaRole: 'group',
      items: [
        createDropdownMenuActionViewItem({
          label: this.props.labels.toolbarMore,
          title: this.props.labels.toolbarMore,
          mode: 'icon',
          buttonClassName: 'editor-draft-toolbar-btn',
          content: createLxIcon('more'),
          overlayAlignment: 'end',
          menuData: DRAFT_TOOLBAR_OVERFLOW_MENU_DATA,
          menu: overflowMenuItems.map((item) => this.toActionbarMenuItem(item)),
          hoverService,
        }),
      ],
    });
    this.attachActionbarMouseDown(overflowView.getElement());
    this.toolbarViews.push(overflowView);
    return overflowView;
  }

  private toActionbarMenuItem(item: WritingEditorToolbarMenuItemConfig) {
    return {
      id: item.id,
      label: item.label,
      title: item.title,
      checked: item.checked,
      disabled: item.disabled,
      onClick: () => {
        item.onClick();
      },
    };
  }

  private createToolbarDropdown(dropdownConfig: WritingEditorToolbarDropdownConfig) {
    const menuPresenter = createDomDropdownMenuPresenter({ layer: 'portal' });
    const dropdown = createDropdownView({
      className: 'editor-draft-toolbar-dropdown',
      menuPresenter,
      title: dropdownConfig.title,
      value: dropdownConfig.value,
      placeholder: dropdownConfig.placeholder,
      options: [...dropdownConfig.options],
      onChange: ({ target }) => {
        dropdownConfig.onChange(target.value);
      },
    });

    return {
      render: (container?: HTMLElement) => {
        if (!container) {
          return;
        }
        container.replaceChildren(dropdown.getElement());
      },
      getElement: () => dropdown.getElement(),
      getFocusableElement: () => dropdown.getElement(),
      focus: () => {
        dropdown.focus();
      },
      blur: () => {
        dropdown.blur();
      },
      dispose: () => {
        menuPresenter.dispose();
        dropdown.dispose();
      },
    } satisfies ActionView;
  }

  private createToolbarSplitButton(splitButtonConfig: WritingEditorToolbarSplitButtonConfig) {
    const primaryContent = createElement('span', 'editor-draft-toolbar-btn-icon');
    const usesCustomPrimaryContent = !splitButtonConfig.buttonIcon;
    const primaryMode =
      splitButtonConfig.buttonMode
      ?? (usesCustomPrimaryContent ? 'custom' : 'icon');

    if (primaryMode !== 'text' && splitButtonConfig.buttonIcon) {
      primaryContent.append(createLxIcon(splitButtonConfig.buttonIcon));
    }

    if (primaryMode !== 'text' && !splitButtonConfig.buttonIcon) {
      const glyph = createElement('span', 'editor-draft-toolbar-btn-glyph');
      glyph.textContent = splitButtonConfig.buttonGlyph ?? splitButtonConfig.buttonLabel;
      primaryContent.append(glyph);
    }

    return {
      type: 'split',
      className: 'actionbar-split editor-draft-toolbar-split',
      primary: {
        label: splitButtonConfig.buttonLabel,
        hover: splitButtonConfig.buttonLabel,
        content: primaryMode === 'text' ? undefined : primaryContent,
        mode: primaryMode,
        buttonClassName: 'editor-draft-toolbar-btn editor-draft-toolbar-split-primary',
        onClick: () => {
          splitButtonConfig.onClick();
        },
        hoverService,
      },
      dropdown: {
        label: splitButtonConfig.label,
        title: splitButtonConfig.title,
        content: createLxIcon('chevron-down'),
        mode: 'icon',
        buttonClassName: 'editor-draft-toolbar-btn editor-draft-toolbar-split-dropdown',
        menuData: DRAFT_TOOLBAR_SPLIT_MENU_DATA,
        menu: splitButtonConfig.menu.map((item, index) => ({
          id: `${splitButtonConfig.label}-${index}`,
          label: item.label,
          title: item.title,
          checked: item.checked,
          disabled: item.disabled,
          onClick: () => {
            item.onClick();
          },
        })),
        hoverService,
      },
    } satisfies ActionBarItem;
  }

  private createToolbarButton(buttonConfig: WritingEditorToolbarButtonConfig) {
    const iconSlot = createElement('span', 'editor-draft-toolbar-btn-icon');
    const usesCustomContent = !buttonConfig.icon;

    if (buttonConfig.icon) {
      iconSlot.append(createLxIcon(buttonConfig.icon));
    } else if (buttonConfig.glyph) {
      const glyph = createElement('span', 'editor-draft-toolbar-btn-glyph');
      glyph.textContent = buttonConfig.glyph;
      iconSlot.append(glyph);
    }

    return {
      id: buttonConfig.label,
      label: buttonConfig.label,
      hover: buttonConfig.label,
      content: iconSlot,
      mode: usesCustomContent ? 'custom' : 'icon',
      active: Boolean(buttonConfig.isActive),
      disabled: Boolean(buttonConfig.disabled),
      buttonClassName: 'editor-draft-toolbar-btn',
      buttonAttributes: buttonConfig.isToggle
        ? { 'aria-pressed': String(Boolean(buttonConfig.isActive)) }
        : undefined,
      hoverService,
      onClick: () => {
        buttonConfig.onClick();
      },
    } satisfies ActionBarItem;
  }

  private disposeToolbarViews() {
    for (const toolbarView of this.toolbarViews) {
      toolbarView.dispose();
    }
    this.toolbarViews = [];
  }

  private readonly handleActionbarMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (!event.target.closest('.actionbar-action')) {
      return;
    }

    // Keep the ProseMirror selection alive while toolbar commands run.
    event.preventDefault();
  };

  private attachActionbarMouseDown(element: HTMLElement) {
    element.addEventListener('mousedown', this.handleActionbarMouseDown);
  }

  private readonly handleWindowResize = () => {
    this.scheduleOverflowSync();
  };
}

export function createDraftEditorToolbar(props: DraftEditorToolbarProps) {
  return new DraftEditorToolbar(props);
}

export default DraftEditorToolbar;
