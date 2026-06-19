import type { NativeModalState } from 'ls/base/parts/sandbox/common/desktopTypes';
import { EventEmitter } from 'ls/base/common/event';
import { LifecycleStore } from 'ls/base/common/lifecycle';
import { detectInitialLocale, getLocaleMessages } from 'language/i18n';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';
import {
  connectWorkbenchWindowControls,
  getWindowStateSnapshot,
  performWorkbenchWindowControl,
  subscribeWindowState,
} from 'ls/workbench/browser/window';
import { hasWindowControlsRuntime } from 'ls/base/common/platform';
import { createChildWindowShellView } from 'ls/workbench/browser/parts/window/childWindowShell';
import { resolveTitlebarCloseLabel } from 'ls/workbench/browser/parts/titlebar/titlebarActions';
import 'ls/workbench/browser/media/articleDetailsModalContent.css';

type ArticleDetailsModalWindowState = Extract<
  NativeModalState,
  { kind: 'article-details' }
>;

type DetailRow = {
  label: string;
  value: string;
  wide?: boolean;
  revealPath?: string | null;
};

type ArticleDetailsModalSnapshot = {
  isLoading: boolean;
  modalState: ArticleDetailsModalWindowState | null;
  isWindowMaximized: boolean;
};

const fallbackUi = getLocaleMessages(detectInitialLocale());

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

function createButton(
  label: string,
  onClick: () => void,
  className = 'settings-native-button btn-base btn-secondary btn-md settings-native-button-secondary',
) {
  const button = createElement('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function normalizeLabel(label: string) {
  const trimmed = label.trimEnd();
  const lastCharacter = trimmed.charAt(trimmed.length - 1);

  if (lastCharacter === ':' || lastCharacter === String.fromCharCode(0xff1a)) {
    return trimmed.slice(0, -1).trimEnd();
  }

  return trimmed;
}

function detailValue(value: string | null | undefined, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function formatDateTime(value: string, locale: 'zh' | 'en') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN');
}

function createDetailRows(modalState: ArticleDetailsModalWindowState): DetailRow[] {
  const { article, labels, locale } = modalState;
  const rows: DetailRow[] = [
    {
      label: 'DOI',
      value: detailValue(article.doi, labels.unknown),
    },
    {
      label: normalizeLabel(labels.articleType),
      value: detailValue(article.articleType, labels.unknown),
    },
    {
      label: normalizeLabel(labels.authors),
      value: article.authors.length > 0 ? article.authors.join(', ') : labels.unknown,
    },
    {
      label: normalizeLabel(labels.publishedAt),
      value: detailValue(article.publishedAt, labels.unknown),
    },
    {
      label: normalizeLabel(labels.source),
      value: detailValue(article.sourceUrl, labels.unknown),
      wide: true,
    },
    {
      label: normalizeLabel(labels.fetchedAt),
      value: formatDateTime(article.fetchedAt, locale),
    },
  ];

  const archiveHtmlPath = detailValue(article.archiveHtmlPath, '');
  if (archiveHtmlPath) {
    rows.push({
      label: normalizeLabel(labels.archiveHtmlPath),
      value: archiveHtmlPath,
      wide: true,
      revealPath: archiveHtmlPath,
    });
  }

  const archiveTextPath = detailValue(article.archiveTextPath, '');
  if (archiveTextPath) {
    rows.push({
      label: normalizeLabel(labels.archiveTextPath),
      value: archiveTextPath,
      wide: true,
      revealPath: archiveTextPath,
    });
  }

  const archivePdfPath = detailValue(article.archivePdfPath, '');
  if (archivePdfPath) {
    rows.push({
      label: normalizeLabel(labels.archivePdfPath),
      value: archivePdfPath,
      wide: true,
      revealPath: archivePdfPath,
    });
  }

  return rows;
}

class ArticleDetailsModalController {
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private readonly disposables = new LifecycleStore();
  private snapshot: ArticleDetailsModalSnapshot = {
    isLoading: true,
    modalState: null,
    isWindowMaximized: getWindowStateSnapshot().isMaximized,
  };
  private disposed = false;
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.disposables.add(
      connectWorkbenchWindowControls(hasWindowControlsRuntime()),
    );
    this.disposables.add(subscribeWindowState(() => {
      this.setSnapshot({
        isWindowMaximized: getWindowStateSnapshot().isMaximized,
      });
    }));
    void this.initializeModalState();
  }

  getSnapshot = () => this.snapshot;

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
    this.onDidChangeEmitter.dispose();
  }

  private setSnapshot(partial: Partial<ArticleDetailsModalSnapshot>) {
    if (this.disposed) {
      return;
    }

    const nextSnapshot = { ...this.snapshot, ...partial };
    if (
      nextSnapshot.isLoading === this.snapshot.isLoading &&
      nextSnapshot.modalState === this.snapshot.modalState &&
      nextSnapshot.isWindowMaximized === this.snapshot.isWindowMaximized
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.onDidChangeEmitter.fire();
  }

  private applyModalState(state: NativeModalState | null) {
    if (this.disposed) {
      return;
    }

    if (state?.kind === 'article-details') {
      this.setSnapshot({
        modalState: state,
        isLoading: false,
      });
      this.applyDocumentMetadata(state);
      return;
    }

    this.setSnapshot({ isLoading: false, modalState: null });
  }

  private async initializeModalState() {
    if (typeof window === 'undefined') {
      this.setSnapshot({ isLoading: false });
      return;
    }

    const modalApi = getNativeHostService().modal;
    if (!modalApi?.getState) {
      this.setSnapshot({ isLoading: false });
      return;
    }

    if (typeof modalApi.onStateChange === 'function') {
      this.disposables.add(
        modalApi.onStateChange((state) => this.applyModalState(state)),
      );
    }

    try {
      const state = await modalApi.getState();
      this.applyModalState(state);
    } catch {
      this.setSnapshot({ isLoading: false });
    }
  }

  private applyDocumentMetadata(state: ArticleDetailsModalWindowState) {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
    document.title = detailValue(state.article.title, state.labels.untitled);
  }
}

export class ArticleDetailsModalWindowView {
  private readonly controller = new ArticleDetailsModalController();
  private readonly element = createElement('main', 'child-window-shell-page');
  private readonly shellView = createChildWindowShellView({
    title: '',
    titleId: 'article-details-title',
    classNames: {
      root: 'child-window-shell-surface',
      header: 'child-window-shell-titlebar',
      heading: 'child-window-shell-titlebar-heading',
      title: 'child-window-shell-titlebar-title',
      controls: 'child-window-shell-titlebar-controls',
      content: 'child-window-shell-content-body',
      footer: 'article-details-footer',
    },
    onWindowControl: performWorkbenchWindowControl,
    content: [],
  });
  private readonly unsubscribe = this.controller.onDidChange(() => this.render());

  constructor() {
    this.render();
  }

  getElement() {
    return this.element;
  }

  dispose() {
    this.unsubscribe();
    this.controller.dispose();
    this.shellView.dispose();
    this.element.replaceChildren();
  }

  private renderPlaceholder(message: string, actionLabel?: string) {
    const surface = createElement(
      'section',
      'child-window-shell-surface child-window-shell-surface-loading',
    );
    surface.append(createElement('p', 'article-details-placeholder', message));
    if (actionLabel) {
      surface.append(
        createButton(actionLabel, () => performWorkbenchWindowControl('close')),
      );
    }
    this.element.replaceChildren(surface);
  }

  private renderDetailGrid(detailRows: DetailRow[]) {
    const labels = this.controller.getSnapshot().modalState?.labels ?? null;
    const grid = createElement('dl', 'article-details-grid');
    for (const row of detailRows) {
      const wrapper = createElement(
        'div',
        `article-details-row${row.wide ? ' article-details-row-wide' : ''}`,
      );
      const valueElement = createElement('dd', 'article-details-row-value');
      valueElement.append(createElement('span', 'article-details-row-text', row.value));
      if (row.revealPath && labels) {
        valueElement.append(
          createButton(
            labels.revealPath,
            () => {
              void getNativeHostService().invoke('open_path', {
                path: row.revealPath ?? '',
              });
            },
            'article-details-reveal-button btn-base btn-secondary btn-sm',
          ),
        );
      }
      wrapper.append(createElement('dt', '', row.label), valueElement);
      grid.append(wrapper);
    }
    return grid;
  }

  private renderTextSection(sectionId: string, title: string, value: string) {
    const section = createElement('section', 'article-details-section');
    section.setAttribute('aria-labelledby', sectionId);
    section.append(
      createElement('h2', '', title),
      createElement('p', '', value),
    );
    (section.firstElementChild as HTMLElement).id = sectionId;
    return section;
  }

  private render() {
    const { isLoading, modalState, isWindowMaximized } =
      this.controller.getSnapshot();

    if (isLoading) {
      this.renderPlaceholder(fallbackUi.articleDetailsLoading);
      return;
    }

    if (!modalState) {
      this.renderPlaceholder(
        fallbackUi.articleDetailsUnavailable,
        resolveTitlebarCloseLabel(fallbackUi),
      );
      return;
    }

    const { article, labels } = modalState;
    const title = detailValue(article.title, labels.untitled);
    const abstractValue = detailValue(article.abstractText, labels.unknown);
    const descriptionValue = detailValue(article.descriptionText, labels.unknown);
    const detailRows = createDetailRows(modalState);

    this.shellView.setProps({
      title,
      titleId: 'article-details-title',
      classNames: {
        root: 'child-window-shell-surface',
        header: 'child-window-shell-titlebar',
        heading: 'child-window-shell-titlebar-heading',
        title: 'child-window-shell-titlebar-title',
        controls: 'child-window-shell-titlebar-controls',
        content: 'child-window-shell-content-body',
        footer: 'article-details-footer',
      },
      controlLabels: {
        controlsAriaLabel: labels.controlsAriaLabel,
        minimizeLabel: labels.minimize,
        maximizeLabel: labels.maximize,
        restoreLabel: labels.restore,
        closeLabel: labels.close,
      },
      isWindowMaximized,
      onWindowControl: performWorkbenchWindowControl,
      footer: createButton(labels.close, () => performWorkbenchWindowControl('close')),
      content: [
        this.renderDetailGrid(detailRows),
        this.renderTextSection(
          'article-details-abstract-title',
          normalizeLabel(labels.abstract),
          abstractValue,
        ),
        this.renderTextSection(
          'article-details-description-title',
          normalizeLabel(labels.description),
          descriptionValue,
        ),
      ],
    });

    this.element.replaceChildren(this.shellView.getElement());
  }
}

export function createArticleDetailsModalWindowView() {
  return new ArticleDetailsModalWindowView();
}
