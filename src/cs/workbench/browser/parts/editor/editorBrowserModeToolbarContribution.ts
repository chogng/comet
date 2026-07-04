import type { ActionBarItem } from 'cs/base/browser/ui/actionbar/actionbar';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { getEditorContentDisplayUrl } from 'cs/workbench/browser/parts/editor/editorUrlPresentation';
import type {
  EditorModeToolbarContribution,
  EditorModeToolbarContributionContext,
} from 'cs/workbench/browser/parts/editor/editorModeToolbarContribution';

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

const EDITOR_BROWSER_TOOLBAR_MORE_MENU_DATA = 'editor-browser-toolbar-more';

export class EditorBrowserModeToolbarContribution
implements EditorModeToolbarContribution {
  readonly mode = 'browser' as const;

  private context: EditorModeToolbarContributionContext;
  private readonly element = createElement(
    'div',
    'editor-mode-toolbar editor-browser-toolbar',
  );
  private readonly toolbarRow = createElement('div', 'editor-browser-toolbar-row');
  private readonly leadingHost = createElement('div', 'editor-browser-toolbar-leading');
  private readonly addressHost = createElement('div', 'editor-browser-toolbar-address-host');
  private readonly trailingHost = createElement('div', 'editor-browser-toolbar-trailing');
  private readonly leadingActionsView = createActionBarView({
    className: 'editor-browser-toolbar-actions',
    ariaRole: 'group',
  });
  private readonly trailingActionsView = createActionBarView({
    className: 'editor-browser-toolbar-actions',
    ariaRole: 'group',
  });
  private readonly addressInput = new InputBox(this.addressHost, undefined, {
    className: 'editor-browser-toolbar-address-input',
    value: '',
    placeholder: '',
  });
  private isAddressInputEdited = false;

  constructor(context: EditorModeToolbarContributionContext) {
    this.context = context;
    this.leadingHost.append(this.leadingActionsView.getElement());
    this.trailingHost.append(this.trailingActionsView.getElement());
    this.addressInput.inputElement.setAttribute('spellcheck', 'false');
    this.addressInput.inputElement.addEventListener('keydown', this.handleAddressInputKeyDown);
    this.addressInput.inputElement.addEventListener('blur', this.handleAddressInputBlur);
    this.addressInput.onDidChange((value) => {
      this.isAddressInputEdited = true;
      this.context.onAddressInputChange(value);
    });
    this.toolbarRow.append(this.leadingHost, this.addressHost, this.trailingHost);
    this.element.append(this.toolbarRow);
    this.render();
  }

  getElement() {
    return this.element;
  }

  setContext(context: EditorModeToolbarContributionContext) {
    this.context = context;
    if (context.mode !== this.mode) {
      this.getLibraryPanelView()?.close();
    }
    this.render();
  }

  focusPrimaryInput() {
    this.addressInput.focus();
    this.addressInput.select();
  }

  dispose() {
    this.getLibraryPanelView()?.setOnDidChangeOpenState(undefined);
    this.getLibraryPanelView()?.setOnDidChangeState(undefined);
    this.addressInput.inputElement.removeEventListener('keydown', this.handleAddressInputKeyDown);
    this.addressInput.inputElement.removeEventListener('blur', this.handleAddressInputBlur);
    this.addressInput.dispose();
    this.leadingActionsView.dispose();
    this.trailingActionsView.dispose();
    this.element.replaceChildren();
  }

  private render() {
    this.bindLibraryPanelView();
    this.updateLeadingActions();
    this.trailingActionsView.setProps({
      className: 'editor-browser-toolbar-actions',
      ariaRole: 'group',
      items: this.createTrailingItems(),
    });

    this.syncAddressInputFromContext();
    this.addressInput.inputElement.setAttribute(
      'aria-label',
      this.context.labels.toolbarAddressBar,
    );
    this.addressInput.setPlaceHolder(this.context.labels.toolbarAddressPlaceholder);
  }

  private bindLibraryPanelView() {
    const panel = this.getLibraryPanelView();
    if (!panel) {
      return;
    }

    panel.setOnDidChangeOpenState(this.handleLibraryPanelOpenStateChange);
    panel.setOnDidChangeState(this.handleLibraryPanelStateChange);
  }

  private updateLeadingActions() {
    this.leadingActionsView.setProps({
      className: 'editor-browser-toolbar-actions',
      ariaRole: 'group',
      items: this.createLeadingItems(),
    });
  }

  private getLibraryPanelView() {
    return this.context.browserLibraryPanel;
  }

  private getLibraryButtonAttributes() {
    return this.getLibraryPanelView()?.getToggleButtonAttributes() ?? {
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    };
  }

  private readonly handleAddressInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      this.isAddressInputEdited = false;
      this.context.onNavigateToUrl(this.addressInput.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.isAddressInputEdited = false;
      this.syncAddressInputFromContext(true);
      this.addressInput.select();
    }
  };

  private readonly handleAddressInputBlur = () => {
    this.isAddressInputEdited = false;
    this.syncAddressInputFromContext(true);
  };

  private readonly handleLibraryPanelOpenStateChange = () => {
    this.updateLeadingActions();
  };

  private readonly handleLibraryPanelStateChange = () => {
    this.updateLeadingActions();
  };

  private syncAddressInputFromContext(force = false) {
    const displayBrowserUrl = getEditorContentDisplayUrl(this.context.browserUrl);
    const canSyncValue =
      force ||
      !this.addressInput.hasFocus() ||
      !this.isAddressInputEdited;

    if (canSyncValue && this.addressInput.value !== displayBrowserUrl) {
      this.addressInput.value = displayBrowserUrl;
    }
  }

  private readonly handleLibraryButtonClick = () => {
    const panel = this.getLibraryPanelView();
    if (!panel) {
      return;
    }

    panel.toggleOpen();
    this.updateLeadingActions();
  };

  private readonly handleFavoriteButtonClick = () => {
    const panel = this.getLibraryPanelView();
    if (!panel) {
      return;
    }

    const changed = panel.toggleCurrentBrowserUrlFavorite();
    if (!changed) {
      return;
    }

    this.updateLeadingActions();
  };

  private createLeadingItems(): ActionBarItem[] {
    const panel = this.getLibraryPanelView();
    const isCurrentUrlFavorited =
      panel?.isBrowserUrlFavorited(this.context.browserUrl) ?? false;

    return [
      {
        label: this.context.labels.toolbarSources,
        title: this.context.labels.toolbarSources,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('list-unordered'),
        active: panel?.getIsOpen() ?? false,
        buttonAttributes: this.getLibraryButtonAttributes(),
        onClick: this.handleLibraryButtonClick,
      },
      {
        label: this.context.labels.toolbarBack,
        title: this.context.labels.toolbarBack,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('arrow-left'),
        disabled: !this.context.browserUrl,
        onClick: this.context.onNavigateBack,
      },
      {
        label: this.context.labels.toolbarForward,
        title: this.context.labels.toolbarForward,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('arrow-right'),
        disabled: false,
        onClick: this.context.onNavigateForward,
      },
      {
        label: this.context.labels.toolbarRefresh,
        title: this.context.labels.toolbarRefresh,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('refresh'),
        disabled: !this.context.browserUrl,
        onClick: this.context.onNavigateRefresh,
      },
      {
        label: this.context.labels.toolbarFavorite,
        title: this.context.labels.toolbarFavorite,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon(
          isCurrentUrlFavorited ? 'favorite-filled' : 'favorite',
        ),
        disabled: !(panel?.canToggleCurrentBrowserUrlFavorite() ?? false),
        buttonAttributes: {
          'aria-pressed': String(isCurrentUrlFavorited),
        },
        onClick: this.handleFavoriteButtonClick,
      },
    ];
  }

  private createTrailingItems(): ActionBarItem[] {
    return [
      {
        label: this.context.labels.toolbarExportDocx,
        title: this.context.labels.toolbarExportDocx,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('docx'),
        disabled: !this.context.electronRuntime,
        onClick: () => {
          void this.context.onExportDocx();
        },
      },
      {
        label: this.context.labels.toolbarArchivePage,
        title: this.context.labels.toolbarArchivePage,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('download-2'),
        disabled: !this.context.browserUrl || !this.context.electronRuntime,
        onClick: () => {
          void this.context.onArchiveCurrentPage();
        },
      },
      createDropdownMenuActionViewItem({
        label: this.context.labels.toolbarMore,
        title: this.context.labels.toolbarMore,
        mode: 'icon',
        buttonClassName: 'editor-browser-toolbar-btn',
        content: createLxIcon('more'),
        overlayAlignment: 'end',
        menuData: EDITOR_BROWSER_TOOLBAR_MORE_MENU_DATA,
        menu: [
          {
            label: this.context.labels.toolbarHardReload,
            onClick: () => this.context.onHardReload(),
            disabled: !this.context.browserUrl,
          },
          {
            label: this.context.labels.toolbarCopyCurrentUrl,
            onClick: () => {
              void this.context.onCopyCurrentUrl();
            },
            disabled: !this.context.browserUrl,
          },
          {
            label: this.context.labels.toolbarClearBrowsingHistory,
            onClick: () => {
              this.getLibraryPanelView()?.clearRecentLibraryEntries();
              this.context.onClearBrowsingHistory();
            },
            disabled: !this.context.browserUrl,
          },
          {
            label: this.context.labels.toolbarClearCookies,
            onClick: () => {
              void this.context.onClearCookies();
            },
            disabled: !this.context.electronRuntime,
          },
          {
            label: this.context.labels.toolbarClearCache,
            onClick: () => {
              void this.context.onClearCache();
            },
            disabled: !this.context.electronRuntime,
          },
        ],
      }),
    ];
  }
}

export function createEditorBrowserModeToolbarContribution(
  context: EditorModeToolbarContributionContext,
) {
  return new EditorBrowserModeToolbarContribution(context);
}
