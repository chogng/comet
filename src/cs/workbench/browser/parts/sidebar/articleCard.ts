import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import type { Locale } from 'language/i18n';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import {
  getPdfDownloadStatus,
  subscribePdfDownloadStatus,
} from 'cs/workbench/browser/pdfDownloadStatus';
import type { SidebarArticle } from 'cs/workbench/browser/parts/sidebar/fetchPanePart';
import { $ } from 'cs/base/browser/dom';

type ArticleCardLabels = {
  untitled: string;
  unknown: string;
};

export type ArticleCardProps = {
  article: SidebarArticle;
  locale: Locale;
  labels: ArticleCardLabels;
  onDownloadPdf: (article: SidebarArticle) => Promise<void>;
  onOpenArticleDetails: (article: SidebarArticle) => void | Promise<void>;
  isSelectionModeEnabled: boolean;
  isSelected: boolean;
  onToggleSelected: (article: SidebarArticle) => void;
};

const DOWNLOAD_PDF_LABEL = 'Download PDF';
const VIEW_DETAILS_LABEL = 'View details';
const DOWNLOADED_PDF_LABEL = 'PDF downloaded';
const MORE_ACTIONS_LABEL = 'More actions';
const ARTICLE_CARD_MORE_MENU_DATA = 'comet-sidebar-article-card-more';
const ARCHIVE_BADGE_TITLES = {
  html: 'Archived HTML available',
  txt: 'Extracted text available',
  pdf: 'Archived PDF available',
} as const;
const hoverService = getHoverService();function formatPublishedDate(
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

export class ArticleCard extends Disposable {
  private props: ArticleCardProps;
  private readonly element = $<HTMLElementTagNameMap['li']>('li');
  private readonly mainElement = $<HTMLElementTagNameMap['div']>('div.comet-fetch-pane-article-card-main');
  private readonly titleElement = $<HTMLElementTagNameMap['h3']>('h3.comet-fetch-pane-article-card-title');
  private readonly metaElement = $<HTMLElementTagNameMap['span']>('span.comet-fetch-pane-article-card-meta');
  private readonly archiveBadgesElement = $<HTMLElementTagNameMap['div']>('div.comet-fetch-pane-article-card-archive-badges');
  private readonly toolbarView = createActionBarView({
    className: 'comet-fetch-pane-article-card-toolbar-actions',
    ariaRole: 'group',
  });
  private disposed = false;

  constructor(props: ArticleCardProps) {
    super();
    this.props = props;
    this.element.append(this.mainElement, this.toolbarView.getElement());
    this.mainElement.append(
      this.titleElement,
      this.metaElement,
      this.archiveBadgesElement,
    );
    this._register(this.toolbarView);
    this._register(addDisposableListener(this.element, 'click', this.handleCardClick));
    this._register(addDisposableListener(this.element, 'keydown', this.handleCardKeyDown));
    this._register(subscribePdfDownloadStatus(this.render));
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: ArticleCardProps) {
    if (this.disposed) {
      return;
    }

    this.props = props;
    this.render();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.element.replaceChildren();
  }

  private readonly render = () => {
    if (this.disposed) {
      return;
    }

const { article, locale, labels, isSelectionModeEnabled, isSelected } =
      this.props;
    const title = article.title || labels.untitled;
    const metaText = createMetaText(article, locale, labels.unknown);
    const downloadStatus = getPdfDownloadStatus(article.sourceUrl);
    const isDownloading = downloadStatus.isDownloading;
    const hasDownloaded = downloadStatus.hasSucceeded;

    this.element.className = [
      'comet-fetch-pane-article-card',
      isSelectionModeEnabled ? 'comet-is-selection-mode' : '',
      isSelected ? 'comet-is-selected' : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (isSelectionModeEnabled) {
      this.element.setAttribute('role', 'button');
      this.element.tabIndex = 0;
      this.element.setAttribute('aria-pressed', String(isSelected));
    } else {
      this.element.removeAttribute('role');
      this.element.removeAttribute('tabindex');
      this.element.removeAttribute('aria-pressed');
    }

    this.titleElement.textContent = title;
    hoverService.applyHover(this.titleElement, title);
    this.metaElement.textContent = metaText;
    this.renderArchiveBadges();

    this.toolbarView.setProps({
      className: 'comet-fetch-pane-article-card-toolbar-actions',
      ariaRole: 'group',
      items: [
        {
          label: DOWNLOAD_PDF_LABEL,
          content: isDownloading
            ? createLxIcon('sync')
            : hasDownloaded
              ? createLxIcon(lxIconSemanticMap.articleCard.downloaded)
              : createLxIcon(lxIconSemanticMap.articleCard.download),
          disabled: isDownloading,
          title: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
          hover: {
            content: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
            subtitle: title,
            actions: [
              {
                label: VIEW_DETAILS_LABEL,
                run: () => {
                  this.openArticleDetails();
                },
              },
            ],
          },
          buttonClassName: [
            'comet-fetch-pane-article-card-icon-btn',
            hasDownloaded ? 'comet-is-downloaded' : '',
          ]
            .filter(Boolean)
            .join(' '),
          onClick: (event) => {
            event.stopPropagation();
            void this.startPdfDownload();
          },
        },
        createDropdownMenuActionViewItem({
          label: MORE_ACTIONS_LABEL,
          title: MORE_ACTIONS_LABEL,
          content: createLxIcon('more'),
          buttonClassName: 'comet-fetch-pane-article-card-icon-btn',
          overlayAlignment: 'end',
          menuData: ARTICLE_CARD_MORE_MENU_DATA,
          menu: [
            {
              label: VIEW_DETAILS_LABEL,
              onClick: () => {
                this.openArticleDetails();
              },
            },
            ...(article.sourceUrl
              ? [
                  {
                    label: hasDownloaded ? DOWNLOADED_PDF_LABEL : DOWNLOAD_PDF_LABEL,
                    disabled: isDownloading || hasDownloaded,
                    onClick: () => {
                      void this.startPdfDownload();
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
                        void this.startPdfDownload();
                      },
                    },
                  ]
                : [],
          },
        }),
      ],
    });
  };

  private renderArchiveBadges() {
    const badges: Array<{ label: string; title: string }> = [];
    const { article } = this.props;

    if (article.archiveHtmlPath) {
      badges.push({ label: 'HTML', title: ARCHIVE_BADGE_TITLES.html });
    }
    if (article.archiveTextPath) {
      badges.push({ label: 'TXT', title: ARCHIVE_BADGE_TITLES.txt });
    }
    if (article.archivePdfPath) {
      badges.push({ label: 'PDF', title: ARCHIVE_BADGE_TITLES.pdf });
    }

    this.archiveBadgesElement.replaceChildren(
      ...badges.map((badge) => {
        const badgeElement = $<HTMLElementTagNameMap['span']>('span.comet-fetch-pane-article-card-archive-badge');
        badgeElement.textContent = badge.label;
        badgeElement.title = badge.title;
        return badgeElement;
      }),
    );
    this.archiveBadgesElement.hidden = badges.length === 0;
  }

  private readonly handleCardClick = () => {
    if (!this.props.isSelectionModeEnabled) {
      return;
    }

    this.props.onToggleSelected(this.props.article);
  };

  private readonly handleCardKeyDown = (event: Event) => {
    if (!this.props.isSelectionModeEnabled) {
      return;
    }

const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
      return;
    }

    keyboardEvent.preventDefault();
    this.props.onToggleSelected(this.props.article);
  };

  private startPdfDownload() {
    if (!this.props.article.sourceUrl) {
      return Promise.resolve();
    }

    return this.props.onDownloadPdf(this.props.article).catch(() => {
      // Shared download handler owns user-facing error feedback.
    });
  }

  private openArticleDetails() {
    void this.props.onOpenArticleDetails(this.props.article);
  }
}

export function createArticleCard(props: ArticleCardProps) {
  return new ArticleCard(props);
}

export default ArticleCard;
