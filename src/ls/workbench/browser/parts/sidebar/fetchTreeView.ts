import type { ActionBarItem } from 'ls/base/browser/ui/actionbar/actionbar';
import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import { applyHover } from 'ls/base/browser/ui/hover/hover';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicons/lxiconsSemantic';
import { DataTree } from 'ls/base/browser/ui/tree/dataTree';
import type { SimpleTreeRenderContext } from 'ls/base/browser/ui/tree/simpleTree';
import { Disposable } from 'ls/base/common/lifecycle';
import type { Locale } from 'language/i18n';
import {
  getPdfDownloadStatus,
  subscribePdfDownloadStatus,
} from 'ls/workbench/browser/pdfDownloadStatus';
import type {
  SidebarArticle,
  SidebarSelectionModePhase,
} from 'ls/workbench/browser/parts/sidebar/fetchPanePart';
import {
  FetchTreeDataSource,
  getFetchTreeNodeLabel,
  type FetchTreeInput,
  type FetchTreeLabels,
  type FetchTreeNode,
} from 'ls/workbench/browser/parts/sidebar/fetchTreeModel';

export type FetchTreeViewProps = {
  articles: SidebarArticle[];
  locale: Locale;
  labels: FetchTreeLabels;
  selectedArticleKeys: ReadonlySet<string>;
  isSelectionModeEnabled: boolean;
  selectionModePhase: SidebarSelectionModePhase;
  isFetchLoading: boolean;
  onDownloadPdf: (article: SidebarArticle) => Promise<void>;
  onOpenArticleDetails: (article: SidebarArticle) => void | Promise<void>;
  onFetch: () => void;
  onToggleSelectionMode: () => void;
  onToggleArticleSelected: (article: SidebarArticle) => void;
};

const DOWNLOAD_PDF_LABEL = 'Download PDF';
const VIEW_DETAILS_LABEL = 'View details';
const DOWNLOADED_PDF_LABEL = 'PDF downloaded';
const MORE_ACTIONS_LABEL = 'More actions';
const ARTICLE_TREE_MORE_MENU_DATA = 'sidebar-article-tree-more';

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

function formatPublishedDate(
  value: string | null,
  locale: Locale,
  fallback: string,
) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return fallback;
  }

  const dateOnlyMatched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatched) {
    const year = Number.parseInt(dateOnlyMatched[1], 10);
    const month = Number.parseInt(dateOnlyMatched[2], 10);
    const day = Number.parseInt(dateOnlyMatched[3], 10);
    const localDate = new Date(year, month - 1, day);

    if (!Number.isNaN(localDate.getTime())) {
      return localDate.toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN');
    }
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN');
}

function createMetaText(
  article: SidebarArticle,
  locale: Locale,
  unknownLabel: string,
) {
  const articleType =
    typeof article.articleType === 'string' ? article.articleType.trim() : '';
  const publishedDate = formatPublishedDate(
    article.publishedAt,
    locale,
    unknownLabel,
  );

  return `${articleType || unknownLabel} | ${publishedDate}`;
}

function getArticleSelectionKey(article: SidebarArticle) {
  return `${article.sourceUrl}::${article.fetchedAt}`;
}

export class FetchTreeView extends Disposable {
  private props: FetchTreeViewProps;
  private readonly dataSource = new FetchTreeDataSource();
  private readonly tree: DataTree<FetchTreeInput, FetchTreeNode>;
  private readonly folderActionBars = new Map<string, ReturnType<typeof createActionBarView>>();
  private readonly articleActionBars = new Map<string, ReturnType<typeof createActionBarView>>();
  private disposed = false;

  constructor(props: FetchTreeViewProps) {
    super();
    this.props = props;
    this.tree = this._register(new DataTree<FetchTreeInput, FetchTreeNode>(
      {
        getRoot: (input) => this.dataSource.getRoot(input),
        hasChildren: (node) => this.dataSource.hasChildren(node),
        getChildren: (node) => this.dataSource.getChildren(node),
      },
      {
        renderElement: (node, context) =>
          this.renderElement(node, context),
      },
      {
        getId: (node) => node.id,
        isRoot: (node) => node.kind === 'root',
        hideRoot: true,
        defaultExpandedIds: ['root'],
        shouldAutoExpand: (node) => node.kind === 'folder',
        getLabel: (node) => getFetchTreeNodeLabel(node, this.props.labels),
        ariaLabel: props.labels.fetchTitle,
        onDidOpen: (node) => {
          if (node.kind === 'article') {
            this.openArticleDetails(node.article);
          }
        },
      },
    ));
    this._register(subscribePdfDownloadStatus(() => {
      this.tree.rerender();
    }));
    this.render();
  }

  getElement() {
    return this.tree.getElement();
  }

  setProps(props: FetchTreeViewProps) {
    if (this.disposed) {
      return;
    }

    this.props = props;
    this.tree.setAriaLabel(props.labels.fetchTitle);
    this.render();
  }

  override dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const actionBar of this.folderActionBars.values()) {
      actionBar.dispose();
    }
    this.folderActionBars.clear();
    for (const actionBar of this.articleActionBars.values()) {
      actionBar.dispose();
    }
    this.articleActionBars.clear();
    super.dispose();
  }

  private render() {
    for (const actionBar of this.folderActionBars.values()) {
      actionBar.dispose();
    }
    this.folderActionBars.clear();
    for (const actionBar of this.articleActionBars.values()) {
      actionBar.dispose();
    }
    this.articleActionBars.clear();
    this.tree.setInput({
      articles: this.props.articles,
      labels: this.props.labels,
    });
  }

  private renderElement(
    node: FetchTreeNode,
    context: SimpleTreeRenderContext,
  ) {
    if (node.kind === 'folder') {
      return this.renderFolderRow(node, context);
    }

    if (node.kind === 'article') {
      return this.renderArticleRow(node, context);
    }

    return createElement('div', 'fetch-tree-row');
  }

  private renderFolderRow(
    node: Extract<FetchTreeNode, { kind: 'folder' }>,
    context: SimpleTreeRenderContext,
  ) {
    const row = createElement(
      'div',
      'fetch-tree-row fetch-tree-folder-row',
    );
    row.style.paddingLeft = `${context.depth * 16}px`;

    const button = createElement(
      'button',
      'fetch-tree-folder-toggle btn-base btn-ghost btn-md',
    );
    button.type = 'button';
    button.setAttribute('aria-expanded', String(context.isExpanded));
    button.addEventListener('click', () => {
      context.toggleExpanded();
    });

    const label = createElement('span', 'fetch-tree-folder-label');
    label.textContent = node.name;
    applyHover(label, node.name);

    const count = createElement('span', 'fetch-tree-folder-count');
    count.textContent = String(node.articles.length);

    button.append(
      createLxIcon(
        context.isExpanded
          ? lxIconSemanticMap.library.folderExpanded
          : lxIconSemanticMap.library.folderCollapsed,
        'fetch-tree-folder-chevron',
      ),
      label,
    );

    const actionBar = this.getFolderActionBar(node.id);
    actionBar.setProps({
      className: 'fetch-tree-folder-actions sidebar-tab-actionbar fetch-pane-actionbar',
      ariaRole: 'group',
      items: this.createFolderActionItems(),
    });

    row.append(button, actionBar.getElement(), count);
    return row;
  }

  private renderArticleRow(
    node: Extract<FetchTreeNode, { kind: 'article' }>,
    context: SimpleTreeRenderContext,
  ) {
    const { article } = node;
    const title = article.title || this.props.labels.untitled;
    const metaText = createMetaText(
      article,
      this.props.locale,
      this.props.labels.unknown,
    );
    const isSelected = this.props.selectedArticleKeys.has(
      getArticleSelectionKey(article),
    );

    const row = createElement(
      'div',
      [
        'fetch-tree-row',
        'fetch-tree-article-row',
        this.props.isSelectionModeEnabled ? 'is-selection-mode' : '',
        isSelected ? 'is-selected' : '',
      ].filter(Boolean).join(' '),
    );
    row.style.paddingLeft = `${context.depth * 16}px`;
    row.addEventListener('dblclick', () => {
      this.openArticleDetails(article);
    });
    row.addEventListener('click', () => {
      if (this.props.isSelectionModeEnabled) {
        this.props.onToggleArticleSelected(article);
      }
    });

    const main = createElement('div', 'fetch-tree-article-main');
    const titleElement = createElement('span', 'fetch-tree-article-title');
    titleElement.textContent = title;
    applyHover(titleElement, title);

    const metaElement = createElement('span', 'fetch-tree-article-meta');
    metaElement.textContent = metaText;
    applyHover(metaElement, metaText);
    main.append(titleElement, metaElement);

    const actionBar = this.getArticleActionBar(node.id);
    actionBar.setProps({
      className: 'fetch-pane-article-card-toolbar-actions',
      ariaRole: 'group',
      items: this.createArticleActionItems(article, title),
    });

    row.append(main, actionBar.getElement());
    return row;
  }

  private getArticleActionBar(nodeId: string) {
    let actionBar = this.articleActionBars.get(nodeId);
    if (!actionBar) {
      actionBar = createActionBarView({
        className: 'fetch-pane-article-card-toolbar-actions',
        ariaRole: 'group',
      });
      this.articleActionBars.set(nodeId, actionBar);
    }

    return actionBar;
  }

  private getFolderActionBar(nodeId: string) {
    let actionBar = this.folderActionBars.get(nodeId);
    if (!actionBar) {
      actionBar = createActionBarView({
        className: 'fetch-tree-folder-actions sidebar-tab-actionbar fetch-pane-actionbar',
        ariaRole: 'group',
      });
      this.folderActionBars.set(nodeId, actionBar);
    }

    return actionBar;
  }

  private createFolderActionItems(): ActionBarItem[] {
    const selectionButtonLabel =
      this.props.selectionModePhase === 'off'
        ? this.props.labels.selectionModeEnterMulti
        : this.props.selectionModePhase === 'multi'
          ? this.props.labels.selectionModeSelectAll
          : this.props.labels.selectionModeExit;
    const fetchButtonLabel = this.props.isFetchLoading
      ? this.props.labels.fetchLatestBusy
      : this.props.labels.fetchLatest;

    return [
      {
        label: selectionButtonLabel,
        title: selectionButtonLabel,
        mode: 'icon',
        active: this.props.isSelectionModeEnabled,
        checked: this.props.isSelectionModeEnabled,
        disabled:
          !this.props.articles.length &&
          !this.props.isSelectionModeEnabled,
        buttonClassName: 'fetch-pane-select-action',
        content: createLxIcon(lxIconSemanticMap.sidebar.selectionMode),
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          this.props.onToggleSelectionMode();
        },
      },
      {
        label: fetchButtonLabel,
        title: fetchButtonLabel,
        mode: 'icon',
        disabled: this.props.isFetchLoading,
        buttonClassName: 'sidebar-fetch-btn fetch-pane-trigger-btn',
        content: createLxIcon(
          this.props.isFetchLoading ? 'sync' : lxIconSemanticMap.fetch.batchDownload,
        ),
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          this.props.onFetch();
        },
      },
    ];
  }

  private createArticleActionItems(
    article: SidebarArticle,
    title: string,
  ): ActionBarItem[] {
    const downloadStatus = getPdfDownloadStatus(article.sourceUrl);
    const isDownloading = downloadStatus.isDownloading;
    const hasDownloaded = downloadStatus.hasSucceeded;

    return [
      {
        label: DOWNLOAD_PDF_LABEL,
        content: isDownloading
          ? createLxIcon('sync')
          : hasDownloaded
            ? createLxIcon(lxIconSemanticMap.articleCard.downloaded)
            : createLxIcon(lxIconSemanticMap.articleCard.download),
        disabled: isDownloading,
        title: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
        buttonClassName: [
          'fetch-pane-article-card-icon-btn',
          hasDownloaded ? 'is-downloaded' : '',
        ].filter(Boolean).join(' '),
        hover: {
          content: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
          subtitle: title,
          actions: [
            {
              label: VIEW_DETAILS_LABEL,
              run: () => {
                this.openArticleDetails(article);
              },
            },
          ],
        },
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void this.startPdfDownload(article);
        },
      },
      createDropdownMenuActionViewItem({
        label: MORE_ACTIONS_LABEL,
        title: MORE_ACTIONS_LABEL,
        content: createLxIcon('more'),
        buttonClassName: 'fetch-pane-article-card-icon-btn',
        overlayAlignment: 'end',
        menuData: ARTICLE_TREE_MORE_MENU_DATA,
        menu: [
          {
            label: VIEW_DETAILS_LABEL,
            onClick: () => {
              this.openArticleDetails(article);
            },
          },
          ...(article.sourceUrl
            ? [
                {
                  label: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
                  disabled: isDownloading || hasDownloaded,
                  onClick: () => {
                    void this.startPdfDownload(article);
                  },
                },
              ]
            : []),
        ],
        hover: {
          content: MORE_ACTIONS_LABEL,
          subtitle: title,
          actions:
            article.sourceUrl && !isDownloading
              ? [
                  {
                    label: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
                    disabled: hasDownloaded,
                    run: () => {
                      void this.startPdfDownload(article);
                    },
                  },
                ]
              : [],
        },
      }),
    ];
  }

  private startPdfDownload(article: SidebarArticle) {
    if (!article.sourceUrl) {
      return Promise.resolve();
    }

    return this.props.onDownloadPdf(article).catch(() => {
      // Shared download handler owns user-facing error feedback.
    });
  }

  private openArticleDetails(article: SidebarArticle) {
    void this.props.onOpenArticleDetails(article);
  }
}
